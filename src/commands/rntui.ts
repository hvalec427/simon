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
    /* not JSON — show raw */
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

export function frameHeight(rows: number, deviceBar: boolean): number {
  return Math.max(1, rows - 2 - (deviceBar ? 1 : 0));
}

// The TUI paints its own theme so it's legible on any terminal background.
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

// Collapse newlines/tabs so one entry is exactly one screen row (embedded
// newlines would otherwise add rows and scroll the header off-screen).
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
  netSel: number;
  detail: boolean;
  detailScroll: number;
  scroll: number;
  follow: boolean;
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

  const tabBar = TABS.map(t => {
    const count = t === 'logs' ? s.buffers.logs.length : s.netRecords.length;
    const label = `${t === 'logs' ? 'Logs' : 'Network'} (${count})`;
    return t === s.tab ? `[${label}]` : ` ${label} `;
  }).join(' ');

  const head = ` ${s.who || '…'} · ${s.status}${s.filter ? ` · filter:"${s.filter}"` : ''}   ${tabBar}`;
  const onRestart = `p: ${s.clearOnRestart ? 'clears' : 'keeps'} logs on app restart`;

  let foot: string;
  if (s.mode !== 'normal') foot = `${s.mode}: ${s.input}▏`;
  else if (s.tab === 'network' && s.detail) foot = ' esc back  ↑↓/jk scroll  q quit';
  else if (s.tab === 'network')
    foot = ` [ ] tabs${hasDeviceBar ? '  1-9 device' : ''}  enter details  / search  f filter  c clear  ↑↓/jk select  q quit`;
  else
    foot = ` [ ] tabs${hasDeviceBar ? '  1-9 device' : ''}  / search  f filter${s.search ? '  n/N next' : ''}  c clear  ${onRestart}  r reconnect  ↑↓/jk scroll  q quit`;

  const lines: string[] = [bar(pad(head, cols))];
  if (hasDeviceBar) {
    const db =
      ' Devices: ' +
      s.targets.map((t, i) => (t.key === s.who ? `[${i + 1}:${t.label}]` : ` ${i + 1}:${t.label} `)).join(' ');
    lines.push(bar(pad(db, cols)));
  }

  const body: string[] = [];
  if (s.tab === 'network') {
    if (s.networkSupported === false && s.netRecords.length === 0) {
      body.push(chalk.yellowBright(pad(' Network isn’t exposed over CDP by this React Native version.', cols)));
    } else if (s.detail) {
      const rec = filterRecords(s.netRecords, s.filter)[s.netSel];
      const dl = rec ? netDetailLines(rec) : ['(no request selected)'];
      const start = clamp(s.detailScroll, 0, Math.max(0, dl.length - h));
      for (let i = 0; i < h; i++) {
        const l = dl[start + i];
        body.push(l === undefined ? '' : highlight(oneLine(l).slice(0, cols), s.search));
      }
    } else {
      const recs = filterRecords(s.netRecords, s.filter);
      const sel = clamp(s.netSel, 0, Math.max(0, recs.length - 1));
      const start = clamp(sel - Math.floor(h / 2), 0, Math.max(0, recs.length - h));
      for (let i = 0; i < h; i++) {
        const rec = recs[start + i];
        if (!rec) {
          body.push('');
          continue;
        }
        const sum = netSummary(rec);
        const line = pad(oneLine(sum.text).slice(0, cols), cols);
        const colored = sum.error ? chalk.redBright(line) : chalk.whiteBright(line);
        body.push(start + i === sel ? chalk.inverse(line) : colored);
      }
    }
  } else {
    const vis = filterEntries(s.buffers[s.tab], s.filter);
    const maxStart = Math.max(0, vis.length - h);
    const start = s.follow ? maxStart : Math.min(Math.max(0, s.scroll), maxStart);
    const window = vis.slice(start, start + h);
    for (let i = 0; i < h; i++) {
      const e = window[i];
      body.push(e ? levelColor(e)(highlight(pad(oneLine(e.text).slice(0, cols), cols), s.search)) : '');
    }
  }

  for (const b of body) lines.push(panel(b.length < cols ? pad(b, cols) : b));
  lines.push(bar(pad(foot, cols)));

  return '\x1b[H\x1b[2J' + lines.join('\n');
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

// ── TUI runtime ─────────────────────────────────────────────────────────────

export function runRnTui(port: number, nameFilter?: string): void {
  const buffers: Record<Tab, LogEntry[]> = { logs: [], network: [] };
  let netRecords: NetRecord[] = [];
  let netSel = 0;
  let detail = false;
  let detailScroll = 0;
  const view: Record<Tab, { scroll: number; follow: boolean }> = {
    logs: { scroll: 0, follow: true },
    network: { scroll: 0, follow: true },
  };
  let tab: Tab = 'logs';
  let filter = '';
  let search = '';
  let mode: 'normal' | 'filter' | 'search' = 'normal';
  let input = '';
  let clearOnRestart = false;
  let status: Status = 'connecting';
  let who = '';
  let networkSupported: boolean | undefined;
  let wasDisconnected = false;
  let targets: TargetInfo[] = [];

  const client = new RnClient(port, nameFilter);
  client.on('log', (e: LogEntry) => {
    buffers.logs.push(e);
    if (buffers.logs.length > MAX_LINES) buffers.logs.shift();
    render();
  });
  client.on('net', (rec: NetRecord) => {
    const i = netRecords.findIndex(r => r.id === rec.id);
    if (i >= 0) netRecords[i] = rec;
    else {
      netRecords.push(rec);
      if (netRecords.length > MAX_NET) netRecords.shift();
    }
    networkSupported = true;
    render();
  });
  client.on('status', (s: Status, w?: string) => {
    if (s === 'disconnected') wasDisconnected = true;
    if (s === 'connected') {
      if (wasDisconnected && clearOnRestart) {
        buffers.logs.length = 0;
        buffers.network.length = 0;
        netRecords = [];
      }
      wasDisconnected = false;
    }
    status = s;
    if (w) who = w;
    render();
  });
  client.on('network', (ok: boolean) => {
    networkSupported = ok;
    render();
  });
  client.on('targets', (list: TargetInfo[]) => {
    targets = list;
    render();
  });

  function height(): number {
    return frameHeight(process.stdout.rows ?? 24, targets.length > 1);
  }

  function render(): void {
    const v = view[tab];
    process.stdout.write(
      renderFrame({
        cols: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
        tab,
        buffers,
        netRecords,
        netSel,
        detail,
        detailScroll,
        scroll: v.scroll,
        follow: v.follow,
        filter,
        search,
        mode,
        input,
        clearOnRestart,
        status,
        who,
        networkSupported,
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

  function jump(dir: 1 | -1): void {
    const vis = filterEntries(buffers.logs, filter);
    if (!search) return;
    const t = search.toLowerCase();
    const hits = vis.flatMap((e, i) => (e.text.toLowerCase().includes(t) ? [i] : []));
    if (!hits.length) return;
    const v = view.logs;
    const current = v.follow ? Math.max(0, vis.length - height()) : v.scroll;
    let next = dir === 1 ? hits.find(i => i > current) : [...hits].reverse().find(i => i < current);
    if (next === undefined) next = dir === 1 ? hits[0] : hits[hits.length - 1];
    v.follow = false;
    v.scroll = next;
  }

  function onKey(str: string | undefined, key: { name?: string; ctrl?: boolean }): void {
    // text entry for filter/search
    if (mode !== 'normal') {
      if (key.name === 'return') {
        mode = 'normal';
        if (search && tab === 'logs') jump(1);
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

    // network detail view
    if (tab === 'network' && detail) {
      if (key.name === 'escape' || str === 'q') detail = false;
      else if (key.name === 'up' || str === 'k') detailScroll = Math.max(0, detailScroll - 1);
      else if (key.name === 'down' || str === 'j') detailScroll += 1;
      else if (key.name === 'pageup') detailScroll = Math.max(0, detailScroll - height());
      else if (key.name === 'pagedown') detailScroll += height();
      else if (str === 'g') detailScroll = 0;
      render();
      return;
    }

    const h = height();
    // shared keys
    if (str === '[') switchTab(-1);
    else if (str === ']') switchTab(1);
    else if (str === '/') {
      mode = 'search';
      input = search;
    } else if (str === 'f') {
      mode = 'filter';
      input = filter;
    } else if (str === 'c') {
      buffers.logs.length = 0;
      buffers.network.length = 0;
      netRecords = [];
    } else if (str && /^[1-9]$/.test(str)) {
      const idx = Number(str) - 1;
      if (idx < targets.length) {
        buffers.logs.length = 0;
        buffers.network.length = 0;
        netRecords = [];
        client.select(idx);
      }
    } else if (str === 'r') client.reconnectNow();
    else if (tab === 'network') {
      // network list navigation
      const recs = filterRecords(netRecords, filter);
      if (key.name === 'return') {
        if (recs.length) {
          detail = true;
          detailScroll = 0;
        }
      } else if (key.name === 'up' || str === 'k') netSel = Math.max(0, netSel - 1);
      else if (key.name === 'down' || str === 'j') netSel = Math.min(recs.length - 1, netSel + 1);
      else if (key.name === 'pageup') netSel = Math.max(0, netSel - h);
      else if (key.name === 'pagedown') netSel = Math.min(recs.length - 1, netSel + h);
      else if (str === 'g') netSel = 0;
      else if (str === 'G') netSel = Math.max(0, recs.length - 1);
    } else {
      // logs scrolling
      const v = view.logs;
      if (str === 'p') clearOnRestart = !clearOnRestart;
      else if (str === 'n') jump(1);
      else if (str === 'N') jump(-1);
      else if (key.name === 'up' || str === 'k') {
        v.follow = false;
        v.scroll = Math.max(0, v.scroll - 1);
      } else if (key.name === 'down' || str === 'j') v.scroll += 1;
      else if (key.name === 'pageup') {
        v.follow = false;
        v.scroll = Math.max(0, v.scroll - h);
      } else if (key.name === 'pagedown') v.scroll += h;
      else if (str === 'g') {
        v.follow = false;
        v.scroll = 0;
      } else if (str === 'G') v.follow = true;
    }
    render();
  }

  function switchTab(dir: 1 | -1): void {
    tab = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
    detail = false;
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
