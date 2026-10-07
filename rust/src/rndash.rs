//! `simon rn` — the tiled React Native dashboard. One window: a Processes pane
//! (Metro + build runs, each in a PTY), a Devices & Actions pane (boot
//! sims/emulators), and the embedded `RnView` (JS logs / network / perf). The
//! Metro PTY gets raw-key passthrough so `r`/`d`/`j` and friends work exactly as
//! in a normal terminal; the same actions are also reachable as global shortcuts.

use crate::devices::{get_all_installed, get_all_running, InstalledDevice, RunningDevice};
use crate::proc::PtyProcess;
use crate::rnclient::{ConnCmd, RnClient};
use crate::rnconfig::ProjectConfig;
use crate::rnview::RnView;
use crate::{android, ios};
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

#[derive(PartialEq, Clone, Copy)]
enum Pane {
    Processes,
    Devices,
    Logs,
}

enum DashMsg {
    Devices(Vec<DeviceRow>),
    Flash(String),
}

/// How to boot a device from the pane — physical devices are already connected,
/// so they have no boot target.
#[derive(Clone)]
enum BootTarget {
    IosSim(String),
    Avd(String),
}

/// How to open a URL on a running device (for the configured app link).
#[derive(Clone)]
enum OpenTarget {
    IosSim(String),      // simulator udid
    IosPhysical(String), // device udid
    AndroidSerial(String),
}

/// A row in the Devices pane: a simulator/emulator (bootable) or a connected
/// physical device (just listed). `open` is set once the device is running.
#[derive(Clone)]
struct DeviceRow {
    label: String,
    running: bool,
    boot: Option<BootTarget>,
    open: Option<OpenTarget>,
}

pub struct DashApp {
    project: ProjectConfig,
    procs: Vec<PtyProcess>,
    proc_sel: usize,
    metro_idx: Option<usize>,
    client: RnClient,
    rnview: RnView,
    focus: Pane,
    input_mode: bool,
    devices: Vec<DeviceRow>,
    dev_sel: usize,
    rx: Receiver<DashMsg>,
    tx: Sender<DashMsg>,
    flash: Option<(String, Instant)>,
    proc_area: Option<Rect>,
    quit: bool,
}

pub fn run(project: ProjectConfig) -> Result<()> {
    let mut app = DashApp::new(project);
    let mut terminal = ratatui::init();
    let res = app.main_loop(&mut terminal);
    ratatui::restore();
    res
}

impl DashApp {
    fn new(project: ProjectConfig) -> DashApp {
        let (tx, rx) = std::sync::mpsc::channel();
        let client = RnClient::start(project.metro_port());
        // Background device poller — simctl/adb are slow, so keep them off the UI thread.
        let dev_tx = tx.clone();
        std::thread::spawn(move || loop {
            let running_devices = get_all_running(None);
            // Resolve a running emulator's adb serial from its AVD name.
            let android_serial = |avd: &str| {
                running_devices.iter().find_map(|d| match d {
                    RunningDevice::AndroidEmulator { name, serial } if name == avd => Some(serial.clone()),
                    _ => None,
                })
            };
            // Installed sims/emulators (bootable; openable once running) …
            let mut rows: Vec<DeviceRow> = Vec::new();
            for d in get_all_installed(None) {
                let label = d.label();
                let running = d.running();
                let (boot, open) = match &d {
                    InstalledDevice::IosSim { udid, .. } => (
                        Some(BootTarget::IosSim(udid.clone())),
                        running.then(|| OpenTarget::IosSim(udid.clone())),
                    ),
                    InstalledDevice::AndroidAvd { name, .. } => (
                        Some(BootTarget::Avd(name.clone())),
                        if running { android_serial(name).map(OpenTarget::AndroidSerial) } else { None },
                    ),
                };
                rows.push(DeviceRow { label, running, boot, open });
            }
            // … plus any connected physical devices (already running, not bootable).
            for d in &running_devices {
                match d {
                    RunningDevice::IosPhysical { udid, .. } => {
                        rows.push(DeviceRow { label: d.label(), running: true, boot: None, open: Some(OpenTarget::IosPhysical(udid.clone())) });
                    }
                    RunningDevice::AndroidPhysical { serial, .. } => {
                        rows.push(DeviceRow { label: d.label(), running: true, boot: None, open: Some(OpenTarget::AndroidSerial(serial.clone())) });
                    }
                    _ => {}
                }
            }
            if dev_tx.send(DashMsg::Devices(rows)).is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(2500));
        });
        DashApp {
            project,
            procs: Vec::new(),
            proc_sel: 0,
            metro_idx: None,
            client,
            rnview: RnView::new(None),
            focus: Pane::Processes,
            input_mode: false,
            devices: Vec::new(),
            dev_sel: 0,
            rx,
            tx,
            flash: None,
            proc_area: None,
            quit: false,
        }
    }

    fn root(&self) -> PathBuf {
        PathBuf::from(&self.project.root)
    }

    fn set_flash(&mut self, msg: impl Into<String>) {
        self.flash = Some((msg.into(), Instant::now()));
    }

    fn pty_size(&self) -> (u16, u16) {
        self.proc_area.map(|r| (r.height.max(1), r.width.max(1))).unwrap_or((24, 80))
    }

    fn spawn_proc(&mut self, label: &str, command: &str) -> Option<usize> {
        let (rows, cols) = self.pty_size();
        match PtyProcess::spawn(label, command, &self.root(), &self.project.command_env(), rows, cols) {
            Ok(p) => {
                self.procs.push(p);
                Some(self.procs.len() - 1)
            }
            Err(e) => {
                self.set_flash(format!("failed to start {label}: {e}"));
                None
            }
        }
    }

    fn start_metro(&mut self) {
        let cmd = self.project.metro_command();
        // Restart in place if Metro is already a tab.
        if let Some(i) = self.metro_idx {
            if let Some(old) = self.procs.get_mut(i) {
                old.kill();
            }
            let (rows, cols) = self.pty_size();
            match PtyProcess::spawn("Metro", &cmd, &self.root(), &self.project.command_env(), rows, cols) {
                Ok(p) => {
                    self.procs[i] = p;
                    self.proc_sel = i;
                    self.set_flash("restarted Metro");
                }
                Err(e) => self.set_flash(format!("failed to restart Metro: {e}")),
            }
            return;
        }
        if let Some(i) = self.spawn_proc("Metro", &cmd) {
            self.metro_idx = Some(i);
            self.proc_sel = i;
            self.set_flash(format!("started Metro (:{})", self.project.metro_port()));
        }
    }

    fn run_platform(&mut self, android: bool) {
        // Device choice is live — boot what you want from the Devices pane; this
        // just runs the configured build command.
        let (label, cmd) = if android {
            ("Android", self.project.android_command())
        } else {
            ("iOS", self.project.ios_command())
        };
        if let Some(i) = self.spawn_proc(label, &cmd) {
            self.proc_sel = i;
            self.focus = Pane::Processes;
            self.set_flash(format!("running: {cmd}"));
        }
    }

    /// Boot the selected simulator/emulator via simon's existing device code.
    fn boot_selected(&mut self) {
        let dev = match self.devices.get(self.dev_sel) {
            Some(d) => d.clone(),
            None => return,
        };
        if dev.running {
            self.set_flash(format!("{} is already running", dev.label));
            return;
        }
        let target = match dev.boot {
            Some(t) => t,
            None => {
                self.set_flash("that's a physical device — it's already connected");
                return;
            }
        };
        let tx = self.tx.clone();
        let label = dev.label.clone();
        self.set_flash(format!("launching {label}…"));
        std::thread::spawn(move || {
            let res = match target {
                BootTarget::IosSim(udid) => ios::boot_simulator(&udid),
                BootTarget::Avd(name) => android::launch_avd(&name),
            };
            let msg = match res {
                Ok(()) => format!("launched {label}"),
                Err(e) => format!("failed to launch {label}: {e}"),
            };
            let _ = tx.send(DashMsg::Flash(msg));
        });
    }

    /// Open the configured app link on the selected device (if it's running).
    fn open_selected(&mut self) {
        let url = match self.project.open_link() {
            Some(u) => u.to_string(),
            None => {
                self.set_flash("set \"openLink\" in rn.json to use this");
                return;
            }
        };
        let dev = match self.devices.get(self.dev_sel) {
            Some(d) => d.clone(),
            None => return,
        };
        let target = match dev.open {
            Some(t) => t,
            None => {
                self.set_flash(format!("{} isn't running — boot it first (b)", dev.label));
                return;
            }
        };
        let tx = self.tx.clone();
        let label = dev.label.clone();
        let ios_bundle = self.project.ios_bundle_id().map(String::from);
        let android_pkg = self.project.android_bundle_id().map(String::from);
        self.set_flash(format!("opening on {label}…"));
        std::thread::spawn(move || {
            let res = match target {
                // simctl openurl routes by scheme; it has no bundle targeting.
                OpenTarget::IosSim(udid) => ios::open_url_on_simulator(&udid, &url),
                OpenTarget::IosPhysical(udid) => ios::open_url_on_physical_ios(&udid, &url, ios_bundle.as_deref(), false),
                OpenTarget::AndroidSerial(serial) => android::open_url_with_package(&serial, &url, android_pkg.as_deref()),
            };
            let msg = match res {
                Ok(()) => format!("opened on {label}"),
                Err(e) => format!("open failed on {label}: {e}"),
            };
            let _ = tx.send(DashMsg::Flash(msg));
        });
    }

    /// Send a single Metro interactive key (`r`/`d`/`j`…) to the Metro PTY, with a
    /// CDP reload fallback when Metro isn't running under us.
    fn metro_key(&mut self, byte: u8, what: &str) {
        if let Some(i) = self.metro_idx {
            if let Some(p) = self.procs.get_mut(i) {
                if p.is_alive() {
                    p.write_input(&[byte]);
                    self.set_flash(format!("metro: {what}"));
                    return;
                }
            }
        }
        if byte == b'r' {
            if let Some(k) = self.rnview.active_target() {
                self.client.send(&k, ConnCmd::Reload);
                self.set_flash("reload (via CDP)");
                return;
            }
        }
        self.set_flash("Metro isn't running — press m to start it");
    }

    fn cycle_focus(&mut self, back: bool) {
        self.input_mode = false;
        self.focus = match (self.focus, back) {
            (Pane::Processes, false) => Pane::Devices,
            (Pane::Devices, false) => Pane::Logs,
            (Pane::Logs, false) => Pane::Processes,
            (Pane::Processes, true) => Pane::Logs,
            (Pane::Devices, true) => Pane::Processes,
            (Pane::Logs, true) => Pane::Devices,
        };
    }

    fn main_loop(&mut self, terminal: &mut ratatui::DefaultTerminal) -> Result<()> {
        loop {
            while let Ok(ev) = self.client.rx.try_recv() {
                self.rnview.on_event(ev);
            }
            while let Ok(m) = self.rx.try_recv() {
                match m {
                    DashMsg::Devices(v) => {
                        self.devices = v;
                        if self.dev_sel >= self.devices.len() {
                            self.dev_sel = self.devices.len().saturating_sub(1);
                        }
                    }
                    DashMsg::Flash(s) => self.set_flash(s),
                }
            }
            if let Some((_, t)) = &self.flash {
                if t.elapsed() > Duration::from_secs(4) {
                    self.flash = None;
                }
            }

            terminal.draw(|f| render(self, f))?;

            // Keep every PTY sized to the pane (no-op when unchanged).
            if let Some(r) = self.proc_area {
                for p in self.procs.iter_mut() {
                    p.resize(r.height, r.width);
                }
            }

            if event::poll(Duration::from_millis(100))? {
                if let Event::Key(k) = event::read()? {
                    if k.kind == KeyEventKind::Press {
                        self.on_key(k);
                    }
                }
            }
            if self.quit {
                return Ok(());
            }
        }
    }

    fn on_key(&mut self, key: KeyEvent) {
        // Ctrl-C always quits the dashboard.
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.quit = true;
            return;
        }

        // Processes input mode: forward raw keys to the active PTY; Esc exits.
        if self.input_mode {
            if key.code == KeyCode::Esc {
                self.input_mode = false;
                return;
            }
            if let Some(bytes) = key_to_bytes(key) {
                if let Some(p) = self.procs.get_mut(self.proc_sel) {
                    p.write_input(&bytes);
                }
            }
            return;
        }

        // Logs pane owns almost every key; the dashboard keeps only focus + quit.
        // While the viewer is mid search/filter entry, it must capture Tab too.
        if self.focus == Pane::Logs {
            let capturing = self.rnview.is_capturing_input();
            match key.code {
                KeyCode::Tab if !capturing => self.cycle_focus(false),
                KeyCode::BackTab if !capturing => self.cycle_focus(true),
                _ => {
                    if self.rnview.on_key(key, &self.client) {
                        self.quit = true;
                    }
                }
            }
            return;
        }

        // Processes / Devices panes.
        match key.code {
            KeyCode::Char('q') => self.quit = true,
            KeyCode::Tab => self.cycle_focus(false),
            KeyCode::BackTab => self.cycle_focus(true),
            KeyCode::Char('m') => self.start_metro(),
            KeyCode::Char('i') => self.run_platform(false),
            KeyCode::Char('a') => self.run_platform(true),
            KeyCode::Char('R') => self.metro_key(b'r', "reload"),
            KeyCode::Char('D') => self.metro_key(b'd', "dev menu"),
            KeyCode::Char('J') => self.metro_key(b'j', "debugger"),
            KeyCode::Char('[') if self.focus == Pane::Processes => {
                if !self.procs.is_empty() {
                    self.proc_sel = (self.proc_sel + self.procs.len() - 1) % self.procs.len();
                }
            }
            KeyCode::Char(']') if self.focus == Pane::Processes => {
                if !self.procs.is_empty() {
                    self.proc_sel = (self.proc_sel + 1) % self.procs.len();
                }
            }
            KeyCode::Enter if self.focus == Pane::Processes => {
                if self.procs.get(self.proc_sel).map(|p| p.is_alive()).unwrap_or(false) {
                    self.input_mode = true;
                } else {
                    self.set_flash("no running process in this tab");
                }
            }
            KeyCode::Up | KeyCode::Char('k') if self.focus == Pane::Devices => {
                self.dev_sel = self.dev_sel.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Char('j') if self.focus == Pane::Devices => {
                if !self.devices.is_empty() {
                    self.dev_sel = (self.dev_sel + 1).min(self.devices.len() - 1);
                }
            }
            KeyCode::Char('b') if self.focus == Pane::Devices => self.boot_selected(),
            KeyCode::Char('o') if self.focus == Pane::Devices => self.open_selected(),
            _ => {}
        }
    }
}

/// Translate a key event into the bytes a terminal would send to the child.
fn key_to_bytes(key: KeyEvent) -> Option<Vec<u8>> {
    let bytes = match key.code {
        KeyCode::Char(c) => {
            if key.modifiers.contains(KeyModifiers::CONTROL) && c.is_ascii_alphabetic() {
                vec![(c.to_ascii_lowercase() as u8) & 0x1f]
            } else {
                c.to_string().into_bytes()
            }
        }
        KeyCode::Enter => vec![b'\r'],
        KeyCode::Tab => vec![b'\t'],
        KeyCode::Backspace => vec![0x7f],
        KeyCode::Up => b"\x1b[A".to_vec(),
        KeyCode::Down => b"\x1b[B".to_vec(),
        KeyCode::Right => b"\x1b[C".to_vec(),
        KeyCode::Left => b"\x1b[D".to_vec(),
        KeyCode::Home => b"\x1b[H".to_vec(),
        KeyCode::End => b"\x1b[F".to_vec(),
        KeyCode::Delete => b"\x1b[3~".to_vec(),
        _ => return None,
    };
    Some(bytes)
}

// ── rendering ────────────────────────────────────────────────────────────────

fn render(app: &mut DashApp, frame: &mut Frame) {
    let area = frame.area();
    let outer = Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).split(area);
    let body = outer[0];
    let status_area = outer[1];

    let halves = Layout::vertical([Constraint::Percentage(45), Constraint::Percentage(55)]).split(body);
    let top = Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).split(halves[0]);
    let proc_outer = top[0];
    let dev_outer = top[1];
    let logs_outer = halves[1];

    render_processes(app, frame, proc_outer);
    render_devices(app, frame, dev_outer);
    render_logs(app, frame, logs_outer);
    render_status(app, frame, status_area);
}

fn focus_border(focused: bool) -> Style {
    if focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    }
}

fn render_processes(app: &mut DashApp, frame: &mut Frame, area: Rect) {
    let focused = app.focus == Pane::Processes;
    let tabs: String = if app.procs.is_empty() {
        "no processes".into()
    } else {
        app.procs
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let dead = if p.is_alive() { "" } else { " (exited)" };
                if i == app.proc_sel {
                    format!("[{}{}]", p.label, dead)
                } else {
                    format!(" {}{} ", p.label, dead)
                }
            })
            .collect::<Vec<_>>()
            .join("")
    };
    let title = if app.input_mode && focused {
        format!(" Processes  {tabs}  — INPUT (Esc to exit) ")
    } else {
        format!(" Processes  {tabs} ")
    };
    let block = Block::default().borders(Borders::ALL).border_style(focus_border(focused)).title(title);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    app.proc_area = Some(inner);

    match app.procs.get(app.proc_sel) {
        Some(p) => {
            let lines = pty_lines(&p.parser(), inner.width, inner.height);
            frame.render_widget(Paragraph::new(Text::from(lines)), inner);
        }
        None => {
            let hint = Paragraph::new("Press  m  to start Metro, or  i / a  to run iOS / Android.")
                .style(Style::default().fg(Color::DarkGray));
            frame.render_widget(hint, inner);
        }
    }
}

fn render_devices(app: &mut DashApp, frame: &mut Frame, area: Rect) {
    let focused = app.focus == Pane::Devices;
    let block = Block::default().borders(Borders::ALL).border_style(focus_border(focused)).title(" Devices & Actions ");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let metro_up = app.metro_idx.and_then(|i| app.procs.get(i)).map(|p| p.is_alive()).unwrap_or(false);
    let metro_line = if metro_up {
        Line::from(vec![
            Span::styled("Metro  ● ", Style::default().fg(Color::Green)),
            Span::raw(format!("running :{}", app.project.metro_port())),
        ])
    } else {
        Line::from(vec![Span::styled("Metro  ○ ", Style::default().fg(Color::DarkGray)), Span::raw("stopped  (m)")])
    };

    let mut lines: Vec<Line> = vec![metro_line, Line::raw("")];
    if app.devices.is_empty() {
        lines.push(Line::styled("  (no simulators/emulators found)", Style::default().fg(Color::DarkGray)));
    }
    for (i, d) in app.devices.iter().enumerate() {
        let marker = if d.running {
            Span::styled("● ", Style::default().fg(Color::Green))
        } else {
            Span::styled("○ ", Style::default().fg(Color::DarkGray))
        };
        let name_style = if focused && i == app.dev_sel {
            Style::default().add_modifier(Modifier::REVERSED)
        } else {
            Style::default()
        };
        lines.push(Line::from(vec![Span::raw(" "), marker, Span::styled(d.label.clone(), name_style)]));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn render_logs(app: &mut DashApp, frame: &mut Frame, area: Rect) {
    let focused = app.focus == Pane::Logs;
    let block = Block::default().borders(Borders::ALL).border_style(focus_border(focused)).title(" JS Logs / Network / Perf ");
    let inner = block.inner(area);
    frame.render_widget(block, area);
    app.rnview.render(frame, inner);
}

fn render_status(app: &DashApp, frame: &mut Frame, area: Rect) {
    let style = Style::default().bg(Color::Rgb(59, 66, 82)).fg(Color::White);
    let text = if let Some((f, _)) = &app.flash {
        format!(" {f}")
    } else if app.input_mode {
        " INPUT — keys go to the process · Esc to exit".into()
    } else {
        match app.focus {
            Pane::Processes => " ⇥ focus · [ ] tab · ⏎ input · m metro · i iOS · a Android · R reload · D dev-menu · q quit".into(),
            Pane::Devices => " ⇥ focus · ↑↓ select · b boot · o open app · i iOS · a Android · m metro · q quit".into(),
            Pane::Logs => " ⇥ focus · log keys active ([ ] tabs · / search · ⏎ detail) · q quit".into(),
        }
    };
    let w = area.width as usize;
    let padded = {
        let n = text.chars().count();
        if n >= w {
            text.chars().take(w).collect::<String>()
        } else {
            format!("{text}{}", " ".repeat(w - n))
        }
    };
    frame.render_widget(Paragraph::new(padded).style(style), area);
}

fn pty_lines(parser: &std::sync::Arc<std::sync::Mutex<vt100::Parser>>, width: u16, height: u16) -> Vec<Line<'static>> {
    let guard = match parser.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let screen = guard.screen();
    let (srows, scols) = screen.size();
    let h = height.min(srows);
    let w = width.min(scols);
    let mut lines: Vec<Line> = Vec::with_capacity(height as usize);
    for row in 0..h {
        let mut spans: Vec<Span> = Vec::new();
        let mut run = String::new();
        let mut run_style = Style::default();
        for col in 0..w {
            let (glyph, style) = match screen.cell(row, col) {
                Some(cell) => {
                    let g = cell.contents();
                    (if g.is_empty() { " ".to_string() } else { g }, cell_style(cell))
                }
                None => (" ".to_string(), Style::default()),
            };
            if style != run_style && !run.is_empty() {
                spans.push(Span::styled(std::mem::take(&mut run), run_style));
            }
            run_style = style;
            run.push_str(&glyph);
        }
        if !run.is_empty() {
            spans.push(Span::styled(run, run_style));
        }
        lines.push(Line::from(spans));
    }
    while lines.len() < height as usize {
        lines.push(Line::raw(""));
    }
    lines
}

fn cell_style(cell: &vt100::Cell) -> Style {
    let mut s = Style::default();
    if let Some(fg) = conv_color(cell.fgcolor()) {
        s = s.fg(fg);
    }
    if let Some(bg) = conv_color(cell.bgcolor()) {
        s = s.bg(bg);
    }
    if cell.bold() {
        s = s.add_modifier(Modifier::BOLD);
    }
    if cell.italic() {
        s = s.add_modifier(Modifier::ITALIC);
    }
    if cell.underline() {
        s = s.add_modifier(Modifier::UNDERLINED);
    }
    if cell.inverse() {
        s = s.add_modifier(Modifier::REVERSED);
    }
    s
}

fn conv_color(c: vt100::Color) -> Option<Color> {
    match c {
        vt100::Color::Default => None,
        vt100::Color::Idx(i) => Some(Color::Indexed(i)),
        vt100::Color::Rgb(r, g, b) => Some(Color::Rgb(r, g, b)),
    }
}
