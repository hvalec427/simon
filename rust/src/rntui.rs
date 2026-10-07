//! Interactive `logs --rn` viewer (ratatui). Logs / Network / Perf tabs, a
//! side-by-side detail pane, search, filters, copy/curl, multi-device switching.
//! ratatui double-buffers and diffs frames, so there is no flicker.

use crate::rnclient::{format_js, ConnCmd, LogEntry, NetRecord, PerfSample, RnClient, RnEvent, Status, TargetInfo};
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::prelude::*;
use ratatui::widgets::Paragraph;
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::time::Duration;

const MAX_LINES: usize = 5000;
const MAX_NET: usize = 1000;
const PERF_HISTORY: usize = 60;
const METHODS: [&str; 8] = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// ── pure helpers ─────────────────────────────────────────────────────────────

pub fn graphql_operation(rec: &NetRecord) -> Option<String> {
    let body = rec.req_body.as_ref()?;
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    fn pick(o: &serde_json::Value) -> Option<String> {
        if let Some(n) = o.get("operationName").and_then(|n| n.as_str()) {
            return Some(n.to_string());
        }
        if let Some(q) = o.get("query").and_then(|q| q.as_str()) {
            // first `query|mutation|subscription <Name>`
            for kw in ["query", "mutation", "subscription"] {
                if let Some(idx) = q.find(kw) {
                    let rest = q[idx + kw.len()..].trim_start();
                    let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                    if !name.is_empty() {
                        return Some(name);
                    }
                }
            }
            return Some("anonymous".into());
        }
        None
    }
    if let Some(arr) = v.as_array() {
        let ops: Vec<String> = arr.iter().filter_map(pick).collect();
        return if ops.is_empty() { None } else { Some(ops.join(", ")) };
    }
    pick(&v)
}

fn fmt_duration(ms: Option<f64>) -> String {
    match ms {
        None => String::new(),
        Some(ms) if ms >= 1000.0 => format!("{:.1}s", ms / 1000.0),
        Some(ms) => format!("{}ms", ms.round() as i64),
    }
}

pub fn net_summary(rec: &NetRecord) -> String {
    let status = rec.status.map(|s| s.to_string()).unwrap_or_else(|| "···".into());
    let dur = fmt_duration(rec.duration_ms);
    let op = graphql_operation(rec);
    let mut s = format!("{status}  {} {}", rec.method, rec.url);
    if !dur.is_empty() {
        s.push_str(&format!("  {dur}"));
    }
    if let Some(op) = op {
        s.push_str(&format!("  {op}"));
    }
    s
}

fn net_error(rec: &NetRecord) -> bool {
    rec.status.map(|s| s >= 400).unwrap_or(false)
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn to_curl(rec: &NetRecord) -> String {
    let method = rec.method.to_uppercase();
    let head = method == "HEAD";
    let mut parts = vec![if head { format!("curl -I {}", sh_quote(&rec.url)) } else { format!("curl -X {method} {}", sh_quote(&rec.url)) }];
    for (k, v) in &rec.req_headers {
        parts.push(format!("-H {}", sh_quote(&format!("{k}: {v}"))));
    }
    if let (Some(b), false) = (&rec.req_body, head) {
        parts.push(format!("--data {}", sh_quote(b)));
    }
    parts.join(" \\\n  ")
}

fn one_line(s: &str) -> String {
    s.replace(['\r', '\n', '\t'], " ")
}

fn pretty_or_raw(body: &str) -> Vec<String> {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_else(|_| body.to_string()).lines().map(|l| format!("  {l}")).collect(),
        Err(_) => body.lines().map(|l| format!("  {l}")).collect(),
    }
}

fn log_detail_lines(e: &LogEntry) -> Vec<String> {
    if let Some(tree) = &e.expanded {
        let mut out = vec![e.text.clone(), String::new()];
        out.extend(tree.clone());
        return out;
    }
    match serde_json::from_str::<serde_json::Value>(&e.text) {
        Ok(v) => format_js(&v, "").lines().map(String::from).collect(),
        Err(_) => e.text.lines().map(String::from).collect(),
    }
}

fn net_detail_lines(rec: &NetRecord) -> Vec<String> {
    let mut out = Vec::new();
    out.push(format!("{} {}", rec.method, rec.url));
    let mut status = format!("Status: {}", rec.status.map(|s| s.to_string()).unwrap_or_else(|| "(pending)".into()));
    if let Some(d) = rec.duration_ms {
        status.push_str(&format!("  ·  {}", fmt_duration(Some(d))));
    }
    if let Some(m) = &rec.mime_type {
        status.push_str(&format!("  ·  {m}"));
    }
    out.push(status);
    if let Some(op) = graphql_operation(rec) {
        out.push(format!("GraphQL: {op}"));
    }
    let section = |out: &mut Vec<String>, title: &str, headers: &[(String, String)]| {
        out.push(String::new());
        out.push(format!("── {title} ──"));
        if headers.is_empty() {
            out.push("  (none)".into());
        } else {
            for (k, v) in headers {
                out.push(format!("  {k}: {v}"));
            }
        }
    };
    let body = |out: &mut Vec<String>, title: &str, b: &Option<String>| {
        out.push(String::new());
        out.push(format!("── {title} ──"));
        match b {
            None => out.push("  (not captured)".into()),
            Some(s) if s.is_empty() => out.push("  (empty)".into()),
            Some(s) => out.extend(pretty_or_raw(s)),
        }
    };
    section(&mut out, "Request headers", &rec.req_headers);
    body(&mut out, "Request body", &rec.req_body);
    section(&mut out, "Response headers", &rec.res_headers);
    body(&mut out, "Response body", &rec.res_body);
    out
}

fn wrap(s: &str, width: usize) -> Vec<String> {
    let s = one_line(s);
    if s.chars().count() <= width || width == 0 {
        return vec![s];
    }
    let chars: Vec<char> = s.chars().collect();
    chars.chunks(width).map(|c| c.iter().collect()).collect()
}

// ── per-device state ─────────────────────────────────────────────────────────

#[derive(Default)]
struct PerfState {
    fps: Option<i64>,
    heap_used: Option<i64>,
    heap_total: Option<i64>,
    history: Vec<i64>,
}

struct Device {
    logs: Vec<LogEntry>,
    net: Vec<NetRecord>,
    status: Status,
    network_supported: bool,
    was_disconnected: bool,
    perf: PerfState,
}

impl Default for Device {
    fn default() -> Self {
        Device { logs: Vec::new(), net: Vec::new(), status: Status::Connecting, network_supported: true, was_disconnected: false, perf: PerfState::default() }
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Tab {
    Logs,
    Network,
    Perf,
}

#[derive(PartialEq)]
enum Mode {
    Normal,
    Search,
    Filter,
}

struct App {
    devices: HashMap<String, Device>,
    targets: Vec<TargetInfo>,
    active: Option<String>,
    name_filter: Option<String>,
    tab: Tab,
    sel: [usize; 3],
    follow: bool,
    detail: bool,
    maximized: bool,
    opened_by_max: bool,
    detail_scroll: usize,
    detail_hit: Option<usize>, // active match line in the pane (for n/N + current highlight)
    detail_width: usize,       // pane width as last rendered (so n/N wrap matches)
    view_h: usize,             // body height as last rendered
    search: String,
    filter: String,
    mode: Mode,
    input: String,
    clear_on_restart: bool,
    errors_only: bool,
    method_idx: usize,
    flash: Option<String>,
}

impl App {
    fn new(name: Option<&str>) -> App {
        App {
            devices: HashMap::new(),
            targets: Vec::new(),
            active: None,
            name_filter: name.map(|s| s.to_lowercase()),
            tab: Tab::Logs,
            sel: [0, 0, 0],
            follow: true,
            detail: false,
            maximized: false,
            opened_by_max: false,
            detail_scroll: 0,
            detail_hit: None,
            detail_width: 80,
            view_h: 20,
            search: String::new(),
            filter: String::new(),
            mode: Mode::Normal,
            input: String::new(),
            clear_on_restart: false,
            errors_only: false,
            method_idx: 0,
            flash: None,
        }
    }

    fn tab_idx(&self) -> usize {
        match self.tab {
            Tab::Logs => 0,
            Tab::Network => 1,
            Tab::Perf => 2,
        }
    }

    fn dev(&mut self, key: &str) -> &mut Device {
        self.devices.entry(key.to_string()).or_default()
    }

    fn on_event(&mut self, ev: RnEvent) {
        match ev {
            RnEvent::Targets(list) => {
                for t in &list {
                    self.devices.entry(t.key.clone()).or_default();
                }
                if self.active.is_none() && !list.is_empty() {
                    let matched = self.name_filter.as_ref().and_then(|n| list.iter().find(|t| t.key.to_lowercase().contains(n)));
                    self.active = Some(matched.map(|t| t.key.clone()).unwrap_or_else(|| list[0].key.clone()));
                }
                self.targets = list;
            }
            RnEvent::Status(key, s) => {
                let clear = self.clear_on_restart;
                let d = self.dev(&key);
                if s == Status::Disconnected {
                    d.was_disconnected = true;
                }
                if s == Status::Connected {
                    if d.was_disconnected && clear {
                        d.logs.clear();
                        d.net.clear();
                    }
                    d.was_disconnected = false;
                }
                d.status = s;
            }
            RnEvent::Log(key, e) => {
                let d = self.dev(&key);
                d.logs.push(e);
                if d.logs.len() > MAX_LINES {
                    d.logs.remove(0);
                }
            }
            RnEvent::Net(key, rec) => {
                let d = self.dev(&key);
                if let Some(existing) = d.net.iter_mut().find(|r| r.id == rec.id) {
                    *existing = rec;
                } else {
                    d.net.push(rec);
                    if d.net.len() > MAX_NET {
                        d.net.remove(0);
                    }
                }
                d.network_supported = true;
            }
            RnEvent::Network(key, ok) => {
                self.dev(&key).network_supported = ok;
            }
            RnEvent::ContextCleared(key) => {
                let clear = self.clear_on_restart;
                let d = self.dev(&key);
                if clear {
                    d.logs.clear();
                    d.net.clear();
                }
            }
            RnEvent::Perf(key, s) => {
                let d = self.dev(&key);
                if let Some(f) = s.fps {
                    d.perf.history.push(f);
                    if d.perf.history.len() > PERF_HISTORY {
                        d.perf.history.remove(0);
                    }
                }
                d.perf = PerfState { fps: s.fps, heap_used: s.heap_used, heap_total: s.heap_total, history: d.perf.history.clone() };
            }
        }
    }

    // Visible items for the current tab/device as display strings + error flag.
    fn rows(&self) -> Vec<(String, bool, String)> {
        let d = match self.active.as_ref().and_then(|k| self.devices.get(k)) {
            Some(d) => d,
            None => return Vec::new(),
        };
        let f = self.filter.to_lowercase();
        match self.tab {
            Tab::Logs => d
                .logs
                .iter()
                .filter(|e| f.is_empty() || e.text.to_lowercase().contains(&f))
                .map(|e| (one_line(&e.text), e.level == "error" || e.level == "assert", e.level.clone()))
                .collect(),
            Tab::Network => {
                let method = METHODS[self.method_idx];
                d.net
                    .iter()
                    .filter(|r| {
                        let text = net_summary(r).to_lowercase();
                        (f.is_empty() || text.contains(&f))
                            && (!self.errors_only || net_error(r))
                            && (method == "ALL" || r.method.to_uppercase() == method)
                    })
                    .map(|r| (net_summary(r), net_error(r), "net".into()))
                    .collect()
            }
            Tab::Perf => Vec::new(),
        }
    }

    fn detail_wrapped(&self) -> Vec<String> {
        self.detail_source().iter().flat_map(|l| wrap(l, self.detail_width.max(1))).collect()
    }

    fn detail_source(&self) -> Vec<String> {
        let d = match self.active.as_ref().and_then(|k| self.devices.get(k)) {
            Some(d) => d,
            None => return Vec::new(),
        };
        let sel = self.sel[self.tab_idx()];
        match self.tab {
            Tab::Logs => {
                let list: Vec<&LogEntry> = d.logs.iter().filter(|e| self.filter.is_empty() || e.text.to_lowercase().contains(&self.filter.to_lowercase())).collect();
                list.get(sel).map(|e| log_detail_lines(e)).unwrap_or_default()
            }
            Tab::Network => {
                let method = METHODS[self.method_idx];
                let f = self.filter.to_lowercase();
                let list: Vec<&NetRecord> = d
                    .net
                    .iter()
                    .filter(|r| (f.is_empty() || net_summary(r).to_lowercase().contains(&f)) && (!self.errors_only || net_error(r)) && (method == "ALL" || r.method.to_uppercase() == method))
                    .collect();
                list.get(sel).map(|r| net_detail_lines(r)).unwrap_or_default()
            }
            Tab::Perf => Vec::new(),
        }
    }
}

// (rendering + key handling continue in rntui_render.rs via include)
include!("rntui_render.rs");

pub fn run(port: u16, name: Option<&str>) -> Result<()> {
    let client = RnClient::start(port);
    let mut app = App::new(name);
    let mut terminal = ratatui::init();
    let res = main_loop(&mut app, &mut terminal, &client);
    ratatui::restore();
    res
}

fn main_loop(app: &mut App, terminal: &mut ratatui::DefaultTerminal, client: &RnClient) -> Result<()> {
    loop {
        while let Ok(ev) = client.rx.try_recv() {
            app.on_event(ev);
        }
        terminal.draw(|f| render(&mut *app, f))?;
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(k) = event::read()? {
                if k.kind == KeyEventKind::Press && on_key(app, k, client) {
                    return Ok(());
                }
            }
        }
    }
}

fn copy_to_clipboard(text: &str) -> bool {
    if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        return child.wait().map(|s| s.success()).unwrap_or(false);
    }
    false
}
