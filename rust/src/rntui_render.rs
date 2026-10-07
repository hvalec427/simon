// Rendering + key handling for the RN TUI. Included into rntui.rs.

fn bar_style() -> Style {
    Style::default().bg(Color::Rgb(59, 66, 82)).fg(Color::White)
}

fn level_color(level: &str) -> Style {
    match level {
        "error" | "assert" => Style::default().fg(Color::Red),
        "warning" | "warn" => Style::default().fg(Color::Yellow),
        "info" => Style::default().fg(Color::Cyan),
        "debug" | "verbose" => Style::default().fg(Color::DarkGray),
        "net" => Style::default().fg(Color::White),
        _ => Style::default().fg(Color::White),
    }
}

fn pad(s: &str, width: usize) -> String {
    let n = s.chars().count();
    if n > width {
        s.chars().take(width).collect()
    } else {
        format!("{s}{}", " ".repeat(width - n))
    }
}

/// Build a styled line, highlighting search matches (current row → yellow,
/// others → cyan).
fn row_line(text: &str, width: usize, base: Style, search: &str, current: bool) -> Line<'static> {
    let padded = pad(&one_line(text), width);
    if search.is_empty() {
        return Line::from(Span::styled(padded, base));
    }
    let hl = if current {
        Style::default().bg(Color::LightYellow).fg(Color::Black)
    } else {
        Style::default().bg(Color::LightCyan).fg(Color::Black)
    };
    let lower = padded.to_lowercase();
    let needle = search.to_lowercase();
    let mut spans: Vec<Span> = Vec::new();
    let mut i = 0;
    let bytes: Vec<char> = padded.chars().collect();
    let lchars: Vec<char> = lower.chars().collect();
    let nchars: Vec<char> = needle.chars().collect();
    while i < bytes.len() {
        if !nchars.is_empty() && i + nchars.len() <= lchars.len() && lchars[i..i + nchars.len()] == nchars[..] {
            let m: String = bytes[i..i + nchars.len()].iter().collect();
            spans.push(Span::styled(m, hl));
            i += nchars.len();
        } else {
            // accumulate a run of non-match
            let start = i;
            i += 1;
            while i < bytes.len() && !(i + nchars.len() <= lchars.len() && !nchars.is_empty() && lchars[i..i + nchars.len()] == nchars[..]) {
                i += 1;
            }
            let run: String = bytes[start..i].iter().collect();
            spans.push(Span::styled(run, base));
        }
    }
    Line::from(spans)
}

fn perf_lines(app: &App, h: usize) -> Vec<Line<'static>> {
    let d = app.active.as_ref().and_then(|k| app.devices.get(k));
    let mut out: Vec<Line> = vec![Line::raw(""), Line::raw("  JS thread")];
    match d.and_then(|d| d.perf.fps) {
        None => out.push(Line::styled("    FPS  — (measuring…)", Style::default().fg(Color::DarkGray))),
        Some(fps) => {
            let width = 30usize;
            let filled = ((fps.min(60) as f64 / 60.0) * width as f64).round() as usize;
            let bar = format!("{}{}", "█".repeat(filled), "░".repeat(width.saturating_sub(filled)));
            let color = if fps >= 50 { Color::Green } else if fps >= 30 { Color::Yellow } else { Color::Red };
            out.push(Line::styled(format!("    FPS  {fps:>2} / 60   {bar}"), Style::default().fg(color)));
        }
    }
    if let Some(d) = d {
        if !d.perf.history.is_empty() {
            let spark = "▁▂▃▄▅▆▇█";
            let chars: Vec<char> = spark.chars().collect();
            let s: String = d.perf.history.iter().map(|v| chars[((*v as f64 / 60.0) * 7.0).round().clamp(0.0, 7.0) as usize]).collect();
            out.push(Line::raw(format!("    last {}s  {s}", d.perf.history.len())));
        }
        out.push(Line::raw(""));
        out.push(Line::raw("  Memory (JS heap)"));
        match d.perf.heap_used {
            Some(u) => {
                let used = format!("{:.1} MB", u as f64 / 1048576.0);
                let total = d.perf.heap_total.map(|t| format!(" / {:.1} MB", t as f64 / 1048576.0)).unwrap_or_default();
                out.push(Line::raw(format!("    used {used}{total}")));
            }
            None => out.push(Line::styled("    not reported by this runtime", Style::default().fg(Color::DarkGray))),
        }
    }
    out.push(Line::raw(""));
    out.push(Line::styled("  JS-thread FPS = how fast JS services frames (≤60). Native/UI FPS isn’t exposed over CDP.", Style::default().fg(Color::DarkGray)));
    while out.len() < h {
        out.push(Line::raw(""));
    }
    out.truncate(h);
    out
}

fn render(app: &App, frame: &mut Frame) {
    let area = frame.area();
    let cols = area.width as usize;
    let rows = area.height as usize;
    if rows < 3 {
        return;
    }
    let has_bar = app.targets.len() > 1;
    let h = rows.saturating_sub(2 + if has_bar { 1 } else { 0 }).max(1);
    let is_logs = app.tab == Tab::Logs;

    let d = app.active.as_ref().and_then(|k| app.devices.get(k));
    let who = app.active.clone().unwrap_or_else(|| "…".into());
    let status = match d.map(|d| &d.status) {
        Some(Status::Connected) => "connected",
        Some(Status::Connecting) => "connecting",
        Some(Status::Disconnected) => "disconnected",
        None => "…",
    };
    let logs_n = d.map(|d| d.logs.len()).unwrap_or(0);
    let net_n = d.map(|d| d.net.len()).unwrap_or(0);
    let tabbar = {
        let lbl = |t: Tab, s: String| if app.tab == t { format!("[{s}]") } else { format!(" {s} ") };
        format!("{} {} {}", lbl(Tab::Logs, format!("Logs ({logs_n})")), lbl(Tab::Network, format!("Network ({net_n})")), lbl(Tab::Perf, "Perf".into()))
    };
    let restart = if app.clear_on_restart { "clears logs on restart" } else { "keeps logs on restart" };
    let mut net_filters = String::new();
    if !is_logs && (app.errors_only || app.method_idx != 0) {
        let mut parts = Vec::new();
        if app.errors_only {
            parts.push("errors".to_string());
        }
        if app.method_idx != 0 {
            parts.push(METHODS[app.method_idx].to_string());
        }
        net_filters = format!(" · {}", parts.join("+"));
    }
    let filter_str = if app.filter.is_empty() { String::new() } else { format!(" · filter:\"{}\"", app.filter) };
    let head = format!(" {who} · {status}{filter_str}{net_filters} · {restart}   {tabbar}");

    let foot = footer(app, is_logs);

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::styled(pad(&head, cols), bar_style()));
    if has_bar {
        let db = format!(" Devices: {}", app.targets.iter().enumerate().map(|(i, t)| if Some(&t.key) == app.active.as_ref() { format!("[{}:{}]", i + 1, t.label) } else { format!(" {}:{} ", i + 1, t.label) }).collect::<Vec<_>>().join(" "));
        lines.push(Line::styled(pad(&db, cols), bar_style()));
    }

    let body = render_body(app, cols, h, is_logs, d);
    lines.extend(body);
    while lines.len() < rows - 1 {
        lines.push(Line::raw(""));
    }
    lines.truncate(rows - 1);
    lines.push(Line::styled(pad(&foot, cols), bar_style()));

    frame.render_widget(Paragraph::new(Text::from(lines)), area);
}

fn render_body(app: &App, cols: usize, h: usize, is_logs: bool, d: Option<&Device>) -> Vec<Line<'static>> {
    if app.tab == Tab::Perf {
        return perf_lines(app, h);
    }
    let rows = app.rows();
    let len = rows.len();
    if app.tab == Tab::Network && d.map(|d| !d.network_supported && d.net.is_empty()).unwrap_or(false) {
        let mut out = vec![Line::styled(" Network isn’t exposed over CDP by this React Native version.", Style::default().fg(Color::Yellow))];
        while out.len() < h {
            out.push(Line::raw(""));
        }
        return out;
    }
    let eff_sel = if app.follow { len.saturating_sub(1) } else { app.sel[app.tab_idx()].min(len.saturating_sub(1)) };

    if app.detail && len > 0 {
        let dl: Vec<String> = app.detail_source().iter().flat_map(|l| wrap(l, if app.maximized { cols } else { cols.saturating_sub((cols as f64 * 0.45) as usize + 1) })).collect();
        let d_start = app.detail_scroll.min(dl.len().saturating_sub(h));
        if app.maximized {
            return (0..h).map(|i| match dl.get(d_start + i) { Some(l) => row_line(l, cols, Style::default(), &app.search, false), None => Line::raw("") }).collect();
        }
        // split: list | detail
        let left_w = ((cols as f64) * 0.45) as usize;
        let right_w = cols.saturating_sub(left_w + 1);
        let list_start = eff_sel.saturating_sub(h / 2).min(len.saturating_sub(h));
        return (0..h)
            .map(|i| {
                let idx = list_start + i;
                let mut spans: Vec<Span> = Vec::new();
                if let Some((text, err, level)) = rows.get(idx) {
                    let base = if idx == eff_sel { Style::default().add_modifier(Modifier::REVERSED) } else if *err { Style::default().fg(Color::Red) } else { level_color(level) };
                    let line = row_line(text, left_w, base, &app.search, false);
                    spans.extend(line.spans);
                } else {
                    spans.push(Span::raw(" ".repeat(left_w)));
                }
                spans.push(Span::styled("│", Style::default().fg(Color::DarkGray)));
                let dline = dl.get(d_start + i).cloned().unwrap_or_default();
                let dl_line = row_line(&dline, right_w, Style::default(), &app.search, false);
                spans.extend(dl_line.spans);
                Line::from(spans)
            })
            .collect();
    }

    // full list
    let start = if app.follow { len.saturating_sub(h) } else { eff_sel.saturating_sub(h / 2).min(len.saturating_sub(h)) };
    (0..h)
        .map(|i| {
            let idx = start + i;
            match rows.get(idx) {
                Some((text, err, level)) => {
                    let current = idx == eff_sel;
                    let base = if current {
                        Style::default().add_modifier(Modifier::REVERSED)
                    } else if *err {
                        Style::default().fg(Color::Red)
                    } else {
                        level_color(level)
                    };
                    row_line(text, cols, base, &app.search, current)
                }
                None => Line::raw(""),
            }
        })
        .collect()
}

fn footer(app: &App, is_logs: bool) -> String {
    match app.mode {
        Mode::Search => format!("search: {}▏", app.input),
        Mode::Filter => format!("filter: {}▏", app.input),
        Mode::Normal => {
            if let Some(f) = &app.flash {
                return format!(" {f}");
            }
            if app.tab == Tab::Perf {
                return " [ ] tabs · 1-9 dev · live JS FPS + heap · R reload · q quit".into();
            }
            if app.detail {
                let nn = if app.search.is_empty() { "" } else { " · n/N" };
                let z = if app.maximized { "z split" } else { "z max" };
                let copy = if is_logs { "" } else { " · c curl" };
                return format!(" ⏎ close · {z} · jk list · JK scroll · / search{nn} · y copy{copy} · q quit");
            }
            let nn = if app.search.is_empty() { "" } else { " · n/N" };
            let scroll = if app.follow { "on" } else { "off" };
            let netf = if is_logs { "" } else { " · e errors · m method" };
            format!(" [ ] tabs · 1-9 dev · / search{nn} · f filter · ⏎ preview · z max · y copy{netf} · space/a scroll:{scroll} · c clear · R reload · q quit")
        }
    }
}

// ── key handling ─────────────────────────────────────────────────────────────

fn match_indexes(app: &App) -> Vec<usize> {
    let n = app.search.to_lowercase();
    app.rows().iter().enumerate().filter(|(_, (t, _, _))| t.to_lowercase().contains(&n)).map(|(i, _)| i).collect()
}

fn jump(app: &mut App, dir: i32) {
    if app.search.is_empty() {
        return;
    }
    let hits = match_indexes(app);
    if hits.is_empty() {
        return;
    }
    let n = app.rows().len();
    let base = if app.follow { n.saturating_sub(1) } else { app.sel[app.tab_idx()] };
    let next = if dir == 1 { hits.iter().find(|&&i| i > base).copied().unwrap_or(hits[0]) } else { hits.iter().rev().find(|&&i| i < base).copied().unwrap_or(*hits.last().unwrap()) };
    app.follow = false;
    app.sel[app.tab_idx()] = next;
}

fn jump_first(app: &mut App) {
    if app.search.is_empty() || app.detail {
        return;
    }
    let hits = match_indexes(app);
    if hits.is_empty() {
        return;
    }
    let base = if app.follow { 0 } else { app.sel[app.tab_idx()] };
    app.follow = false;
    app.sel[app.tab_idx()] = hits.iter().find(|&&i| i >= base).copied().unwrap_or(hits[0]);
}

fn copy_selection(app: &mut App) {
    let lines = app.detail_source();
    if lines.is_empty() {
        return;
    }
    let text = lines.join("\n");
    app.flash = Some(if copy_to_clipboard(&text) { format!("copied ({} chars)", text.len()) } else { "copy failed".into() });
}

fn copy_curl(app: &mut App) {
    if app.tab != Tab::Network {
        return;
    }
    let d = match app.active.as_ref().and_then(|k| app.devices.get(k)) {
        Some(d) => d,
        None => return,
    };
    let method = METHODS[app.method_idx];
    let f = app.filter.to_lowercase();
    let list: Vec<&NetRecord> = d.net.iter().filter(|r| (f.is_empty() || net_summary(r).to_lowercase().contains(&f)) && (!app.errors_only || net_error(r)) && (method == "ALL" || r.method.to_uppercase() == method)).collect();
    let sel = app.sel[app.tab_idx()].min(list.len().saturating_sub(1));
    if let Some(rec) = list.get(sel) {
        let curl = to_curl(rec);
        app.flash = Some(if copy_to_clipboard(&curl) { "copied curl".into() } else { "copy failed".into() });
    }
}

/// Returns true to quit.
fn on_key(app: &mut App, key: KeyEvent, client: &RnClient) -> bool {
    if app.mode != Mode::Normal {
        match key.code {
            KeyCode::Enter => {
                let was_search = app.mode == Mode::Search;
                app.mode = Mode::Normal;
                if was_search && !app.search.is_empty() && !app.detail {
                    jump(app, 1);
                }
            }
            KeyCode::Esc => {
                app.mode = Mode::Normal;
            }
            KeyCode::Backspace => {
                app.input.pop();
                if app.mode == Mode::Filter {
                    app.filter = app.input.clone();
                } else {
                    app.search = app.input.clone();
                    jump_first(app);
                }
            }
            KeyCode::Char(c) => {
                app.input.push(c);
                if app.mode == Mode::Filter {
                    app.filter = app.input.clone();
                } else {
                    app.search = app.input.clone();
                    jump_first(app);
                }
            }
            _ => {}
        }
        return false;
    }

    app.flash = None;
    let n = app.rows().len();
    let ti = app.tab_idx();
    let h = 20usize; // page size approximation for PgUp/PgDn
    let key_active = app.active.clone();

    match key.code {
        KeyCode::Char('q') => return true,
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => return true,
        KeyCode::Char('[') => {
            app.tab = match app.tab { Tab::Logs => Tab::Perf, Tab::Network => Tab::Logs, Tab::Perf => Tab::Network };
            app.detail = false;
            app.maximized = false;
        }
        KeyCode::Char(']') => {
            app.tab = match app.tab { Tab::Logs => Tab::Network, Tab::Network => Tab::Perf, Tab::Perf => Tab::Logs };
            app.detail = false;
            app.maximized = false;
        }
        KeyCode::Char('/') => {
            app.mode = Mode::Search;
            app.input.clear();
            if app.detail {
                app.detail_scroll = 0;
            }
        }
        KeyCode::Char('f') => {
            app.mode = Mode::Filter;
            app.input = app.filter.clone();
        }
        KeyCode::Char('c') => {
            if app.detail && app.tab == Tab::Network {
                copy_curl(app);
            } else if app.detail {
                copy_selection(app);
            } else if let Some(k) = &key_active {
                let d = app.dev(k);
                d.logs.clear();
                d.net.clear();
                client.send(k, ConnCmd::DiscardConsole);
            }
        }
        KeyCode::Char('z') => {
            if !app.detail {
                app.detail = true;
                app.detail_scroll = 0;
                app.maximized = true;
                app.opened_by_max = true;
            } else if app.maximized {
                app.maximized = false;
                if app.opened_by_max {
                    app.detail = false;
                    app.opened_by_max = false;
                }
            } else {
                app.maximized = true;
            }
        }
        KeyCode::Char('p') => app.clear_on_restart = !app.clear_on_restart,
        KeyCode::Char('y') => copy_selection(app),
        KeyCode::Char('C') => copy_curl(app),
        KeyCode::Char('e') if app.tab == Tab::Network => app.errors_only = !app.errors_only,
        KeyCode::Char('m') if app.tab == Tab::Network => app.method_idx = (app.method_idx + 1) % METHODS.len(),
        KeyCode::Char('a') | KeyCode::Char(' ') => {
            app.follow = !app.follow;
            if app.follow {
                app.sel[ti] = n.saturating_sub(1);
            }
        }
        KeyCode::Char(ch @ '1'..='9') => {
            let idx = ch as usize - '1' as usize;
            if idx < app.targets.len() {
                app.active = Some(app.targets[idx].key.clone());
                app.detail = false;
                app.maximized = false;
            }
        }
        KeyCode::Char('R') => {
            if let Some(k) = &key_active {
                client.send(k, ConnCmd::Reload);
            }
        }
        KeyCode::Enter | KeyCode::Esc => {
            if app.detail {
                app.detail = false;
                app.maximized = false;
                app.opened_by_max = false;
            } else if n > 0 {
                app.detail = true;
                app.detail_scroll = 0;
            }
        }
        KeyCode::Char('J') => {
            if app.detail {
                app.detail_scroll += 1;
            }
        }
        KeyCode::Char('K') => {
            if app.detail {
                app.detail_scroll = app.detail_scroll.saturating_sub(1);
            }
        }
        KeyCode::Char('n') => {
            if app.detail {
                app.detail_scroll += 1;
            } else {
                jump(app, 1);
            }
        }
        KeyCode::Char('N') => {
            if app.detail {
                app.detail_scroll = app.detail_scroll.saturating_sub(1);
            } else {
                jump(app, -1);
            }
        }
        KeyCode::Up | KeyCode::Char('k') => {
            if app.detail && app.maximized {
                app.detail_scroll = app.detail_scroll.saturating_sub(1);
            } else {
                app.follow = false;
                app.sel[ti] = app.sel[ti].saturating_sub(1);
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if app.detail && app.maximized {
                app.detail_scroll += 1;
            } else {
                let next = (app.sel[ti] + 1).min(n.saturating_sub(1));
                if next >= n.saturating_sub(1) {
                    app.follow = true;
                }
                app.sel[ti] = next;
            }
        }
        KeyCode::PageUp => {
            app.follow = false;
            app.sel[ti] = app.sel[ti].saturating_sub(h);
        }
        KeyCode::PageDown => {
            app.sel[ti] = (app.sel[ti] + h).min(n.saturating_sub(1));
        }
        KeyCode::Char('g') => {
            app.follow = false;
            app.sel[ti] = 0;
        }
        KeyCode::Char('G') => {
            app.follow = true;
            app.sel[ti] = n.saturating_sub(1);
        }
        _ => {}
    }
    false
}
