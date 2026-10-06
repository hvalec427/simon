import readline from 'readline';
import chalk from 'chalk';
import { LogEntry, NetRecord, RnClient, Status, TargetInfo } from '../utils/rnclient.js';

const MAX_LINES = 5000;
const MAX_NET = 1000;
const TABS = ['logs', 'network'] as const;
type Tab = (typeof TABS)[number];

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

export function filterEntries(entries: LogEntry[], filter: string): LogEntry[] {
  if (!filter) return entries;
  const f = filter.toLowerCase();
  return entries.filter(e => e.text.toLowerCase().includes(f));
}

export function filterRecords(records: NetRecord[], filter: string): NetRecord[] {
  if (!filter) return records;
  const f = filter.toLowerCase();
  return records.filter(r => `${r.method} ${r.url}`.toLowerCase().includes(f));
}

export function netSummary(rec: NetRecord): { text: string; error: boolean; pending: boolean } {
  const pending = rec.status === undefined;
  return {
    text: `${pending ? '···' : rec.status}  ${rec.method} ${rec.url}`,
    error: typeof rec.status === 'number' && rec.status >= 400,
    pending,
  };
}

function headerLines(h?: Record<string, string>): string[] {
  if (!h || !Object.keys(h).length) return ['  (none)'];
  return Object.entries(h).map(([k, v]) => `  ${k}: ${v}`);
}

function bodyLines(b?: string): string[] {
  if (b === undefined) return ['  (not captured)'];
  if (b === '') return ['  (empty)'];
  let text = b;
  try {
    text = JSON.stringify(JSON.parse(b), null, 2);
  } catch {
    /* not JSON — raw */
  }
  return text.split('\n').map(l => `  ${l}`);
}

export function netDetailLines(rec: NetRecord): string[] {
  return [
    `${rec.method} ${rec.url}`,
    `Status: ${rec.status ?? '(pending)'}${rec.mimeType ? `  ·  ${rec.mimeType}` : ''}`,
    '',
    '── Request headers ──',
    ...headerLines(rec.reqHeaders),
    '',
    '── Request body ──',
    ...bodyLines(rec.reqBody),
    '',
    '── Response headers ──',
    ...headerLines(rec.resHeaders),
    '',
    '── Response body ──',
    ...bodyLines(rec.resBody),
  ];
}

// Expand a log entry: pretty-print JSON if it is one, else show its lines as-is.
export function logDetailLines(e: LogEntry): string[] {
  let text = e.text;
  try {
    text = JSON.stringify(JSON.parse(e.text), null, 2);
  } catch {
    /* not JSON — raw (may be multi-line) */
  }
  return text.split('\n');
}

export function frameHeight(rows: number, deviceBar: boolean): number {
  return Math.max(1, rows - 2 - (deviceBar ? 1 : 0));
}

export function highlight(text: string, term: string): string {
  if (!term) return text;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(t, i);
    if (hit === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, hit) + chalk.inverse(text.slice(hit, hit + term.length));
    i = hit + term.length;
  }
  return out;
}

const PANEL_BG = '#1e1e2e';
const BAR_BG = '#3b4252';
const panel = (s: string) => chalk.bgHex(PANEL_BG)(s);
const bar = (s: string) => chalk.bgHex(BAR_BG).whiteBright(s);

function levelColor(e: LogEntry): (s: string) => string {
  if (e.kind === 'network') return e.level === 'error' ? chalk.redBright : chalk.cyanBright;
  switch (e.level) {
    case 'error':
    case 'assert':
      return chalk.redBright;
    case 'warning':
    case 'warn':
      return chalk.yellowBright;
    case 'info':
      return chalk.cyanBright;
    case 'debug':
    case 'verbose':
      return chalk.gray;
    default:
      return chalk.whiteBright;
  }
}

function pad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export interface FrameState {
  cols: number;
  rows: number;
  tab: Tab;
  buffers: Record<Tab, LogEntry[]>;
  netRecords: NetRecord[];
  sel: number;
  follow: boolean;
  detail: boolean;
  detailScroll: number;
  filter: string;
  search: string;
  mode: 'normal' | 'filter' | 'search';
  input: string;
  clearOnRestart: boolean;
  status: Status;
  who: string;
  networkSupported?: boolean;
  targets: TargetInfo[];
}

export function renderFrame(s: FrameState): string {
  const cols = s.cols;
  const hasDeviceBar = s.targets.length > 1;
  const h = frameHeight(s.rows, hasDeviceBar);
  const isLogs = s.tab === 'logs';

  const tabBar = TABS.map(t => {
    const count = t === 'logs' ? s.buffers.logs.length : s.netRecords.length;
    const label = `${t === 'logs' ? 'Logs' : 'Network'} (${count})`;
    return t === s.tab ? `[${label}]` : ` ${label} `;
  }).join(' ');

  const restart = `${s.clearOnRestart ? 'clears' : 'keeps'} logs on restart`;
  const head = ` ${s.who || '…'} · ${s.status}${s.filter ? ` · filter:"${s.filter}"` : ''} · ${restart}   ${tabBar}`;

  let foot: string;
  if (s.mode !== 'normal') foot = `${s.mode}: ${s.input}▏`;
  else if (s.detail) foot = ' ⏎/esc close · ↑↓/jk g scroll · q quit';
  else
    foot =
      ` [ ] tabs${hasDeviceBar ? ' · 1-9 dev' : ''} · / search · f filter${s.search ? ' · n/N' : ''} · ⏎ expand` +
      ` · a autoscroll:${s.follow ? 'on' : 'off'} · g/G scroll · c clear · R reload · r reconnect · p restart · q quit`;

  const lines: string[] = [bar(pad(head, cols))];
  if (hasDeviceBar) {
    const db =
      ' Devices: ' +
      s.targets.map((t, i) => (t.key === s.who ? `[${i + 1}:${t.label}]` : ` ${i + 1}:${t.label} `)).join(' ');
    lines.push(bar(pad(db, cols)));
  }

  const body: string[] = [];
  const items: (LogEntry | NetRecord)[] = isLogs ? filterEntries(s.buffers.logs, s.filter) : filterRecords(s.netRecords, s.filter);
  const len = items.length;
  const effSel = s.follow ? len - 1 : clamp(s.sel, 0, Math.max(0, len - 1));

  if (s.tab === 'network' && s.networkSupported === false && s.netRecords.length === 0) {
    body.push(chalk.yellowBright(' Network isn’t exposed over CDP by this React Native version.'));
    while (body.length < h) body.push('');
  } else if (s.detail && len > 0) {
    const dl = isLogs ? logDetailLines(items[effSel] as LogEntry) : netDetailLines(items[effSel] as NetRecord);
    const start = clamp(s.detailScroll, 0, Math.max(0, dl.length - h));
    for (let i = 0; i < h; i++) {
      const l = dl[start + i];
      body.push(l === undefined ? '' : highlight(oneLine(l).slice(0, cols), s.search));
    }
  } else {
    const start = s.follow ? Math.max(0, len - h) : clamp(effSel - Math.floor(h / 2), 0, Math.max(0, len - h));
    for (let i = 0; i < h; i++) {
      const idx = start + i;
      const item = items[idx];
      if (!item) {
        body.push('');
        continue;
      }
      const rawText = isLogs ? (item as LogEntry).text : netSummary(item as NetRecord).text;
      const text = pad(oneLine(rawText).slice(0, cols), cols);
      if (idx === effSel) {
        body.push(chalk.inverse(text));
      } else if (isLogs) {
        body.push(levelColor(item as LogEntry)(highlight(text, s.search)));
      } else {
        body.push(netSummary(item as NetRecord).error ? chalk.redBright(text) : chalk.whiteBright(text));
      }
    }
  }

  for (const b of body) lines.push(panel(b.length < cols ? pad(b, cols) : b));
  lines.push(bar(pad(foot, cols)));

  return '\x1b[H\x1b[2J' + lines.join('\n');
}

// ── TUI runtime ─────────────────────────────────────────────────────────────

interface Device {
  logs: LogEntry[];
  net: NetRecord[];
  status: Status;
  networkSupported?: boolean;
  wasDisconnected: boolean;
}

export function runRnTui(port: number, nameFilter?: string): void {
  const devices = new Map<string, Device>();
  let activeKey: string | undefined;
  const sel: Record<Tab, number> = { logs: 0, network: 0 };
  let follow = true;
  let detail = false;
  let detailScroll = 0;
  let tab: Tab = 'logs';
  let filter = '';
  let search = '';
  let mode: 'normal' | 'filter' | 'search' = 'normal';
  let input = '';
  let clearOnRestart = false;
  let targets: TargetInfo[] = [];
  const EMPTY: Device = { logs: [], net: [], status: 'connecting', wasDisconnected: false };

  function dev(key: string): Device {
    let d = devices.get(key);
    if (!d) {
      d = { logs: [], net: [], status: 'connecting', wasDisconnected: false };
      devices.set(key, d);
    }
    return d;
  }
  const active = () => (activeKey ? dev(activeKey) : EMPTY);

  const client = new RnClient(port);
  client.on('log', (key: string, e: LogEntry) => {
    const d = dev(key);
    d.logs.push(e);
    if (d.logs.length > MAX_LINES) d.logs.shift();
    if (key === activeKey) render();
  });
  client.on('net', (key: string, rec: NetRecord) => {
    const d = dev(key);
    const i = d.net.findIndex(r => r.id === rec.id);
    if (i >= 0) d.net[i] = rec;
    else {
      d.net.push(rec);
      if (d.net.length > MAX_NET) d.net.shift();
    }
    d.networkSupported = true;
    if (key === activeKey) render();
  });
  client.on('status', (key: string, s: Status) => {
    const d = dev(key);
    if (s === 'disconnected') d.wasDisconnected = true;
    if (s === 'connected') {
      if (d.wasDisconnected && clearOnRestart) {
        d.logs.length = 0;
        d.net.length = 0;
      }
      d.wasDisconnected = false;
    }
    d.status = s;
    if (key === activeKey) render();
  });
  client.on('network', (key: string, ok: boolean) => {
    dev(key).networkSupported = ok;
    if (key === activeKey) render();
  });
  client.on('contextcleared', (key: string) => {
    const d = dev(key);
    if (clearOnRestart) {
      d.logs.length = 0;
      d.net.length = 0;
    }
    if (key === activeKey) render();
  });
  client.on('targets', (list: TargetInfo[]) => {
    targets = list;
    for (const t of list) dev(t.key);
    if (!activeKey && list.length) {
      const match = nameFilter && list.find(t => t.key.toLowerCase().includes(nameFilter.toLowerCase()));
      activeKey = (match && match.key) || list[0].key;
    }
    render();
  });

  const height = () => frameHeight(process.stdout.rows ?? 24, targets.length > 1);
  const items = () => (tab === 'logs' ? filterEntries(active().logs, filter) : filterRecords(active().net, filter));
  const count = () => items().length;

  function render(): void {
    const d = active();
    process.stdout.write(
      renderFrame({
        cols: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
        tab,
        buffers: { logs: d.logs, network: [] },
        netRecords: d.net,
        sel: sel[tab],
        follow,
        detail,
        detailScroll,
        filter,
        search,
        mode,
        input,
        clearOnRestart,
        status: d.status,
        who: activeKey ?? '',
        networkSupported: d.networkSupported,
        targets,
      }),
    );
  }

  function quit(): void {
    client.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?7h\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  function switchTab(dir: 1 | -1): void {
    tab = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
    detail = false;
  }

  function jump(dir: 1 | -1): void {
    if (!search) return;
    const t = search.toLowerCase();
    const list = items();
    const hits = list.flatMap((it, i) => {
      const text = tab === 'logs' ? (it as LogEntry).text : `${(it as NetRecord).method} ${(it as NetRecord).url}`;
      return text.toLowerCase().includes(t) ? [i] : [];
    });
    if (!hits.length) return;
    const base = follow ? list.length - 1 : sel[tab];
    let next = dir === 1 ? hits.find(i => i > base) : [...hits].reverse().find(i => i < base);
    if (next === undefined) next = dir === 1 ? hits[0] : hits[hits.length - 1];
    follow = false;
    sel[tab] = next;
  }

  function onKey(str: string | undefined, key: { name?: string; ctrl?: boolean }): void {
    if (mode !== 'normal') {
      if (key.name === 'return') {
        mode = 'normal';
        if (search) jump(1);
      } else if (key.name === 'escape') {
        if (mode === 'search') search = '';
        mode = 'normal';
      } else if (key.name === 'backspace') {
        input = input.slice(0, -1);
        if (mode === 'filter') filter = input;
        else search = input;
      } else if (str && !key.ctrl) {
        input += str;
        if (mode === 'filter') filter = input;
        else search = input;
      }
      render();
      return;
    }

    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();

    if (detail) {
      if (key.name === 'return' || key.name === 'escape') detail = false;
      else if (key.name === 'up' || str === 'k') detailScroll = Math.max(0, detailScroll - 1);
      else if (key.name === 'down' || str === 'j') detailScroll += 1;
      else if (key.name === 'pageup') detailScroll = Math.max(0, detailScroll - height());
      else if (key.name === 'pagedown') detailScroll += height();
      else if (str === 'g') detailScroll = 0;
      render();
      return;
    }

    const h = height();
    const n = count();
    const base = follow ? n - 1 : sel[tab];
    const toLast = () => {
      follow = true;
      sel[tab] = Math.max(0, n - 1);
    };
    const toIndex = (i: number) => {
      const next = clamp(i, 0, Math.max(0, n - 1));
      if (next >= n - 1) toLast();
      else {
        follow = false;
        sel[tab] = next;
      }
    };

    if (str === '[') switchTab(-1);
    else if (str === ']') switchTab(1);
    else if (str === '/') {
      mode = 'search';
      input = search;
    } else if (str === 'f') {
      mode = 'filter';
      input = filter;
    } else if (str === 'c') {
      active().logs.length = 0;
      active().net.length = 0;
      if (activeKey) client.discardConsole(activeKey); // so a reconnect won't replay
    } else if (str === 'p') clearOnRestart = !clearOnRestart;
    else if (str === 'a') {
      follow = !follow;
      if (follow) sel[tab] = Math.max(0, n - 1);
    } else if (str && /^[1-9]$/.test(str)) {
      const idx = Number(str) - 1;
      if (idx < targets.length) {
        // Instant view switch — the other device stays connected in the background.
        activeKey = targets[idx].key;
        detail = false;
      }
    } else if (str === 'r') client.reconnectNow();
    else if (str === 'R') {
      if (activeKey) client.reloadApp(activeKey);
    } else if (key.name === 'return') {
      if (n > 0) {
        detail = true;
        detailScroll = 0;
      }
    } else if (str === 'n') jump(1);
    else if (str === 'N') jump(-1);
    else if (key.name === 'up' || str === 'k') {
      follow = false;
      sel[tab] = clamp(base - 1, 0, Math.max(0, n - 1));
    } else if (key.name === 'down' || str === 'j') toIndex(base + 1);
    else if (key.name === 'pageup') {
      follow = false;
      sel[tab] = clamp(base - h, 0, Math.max(0, n - 1));
    } else if (key.name === 'pagedown') toIndex(base + h);
    else if (str === 'g') {
      follow = false;
      sel[tab] = 0;
    } else if (str === 'G') toLast();
    render();
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l');
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKey);
  process.on('SIGINT', quit);
  process.stdout.on('resize', render);

  client.start();
  render();
}
