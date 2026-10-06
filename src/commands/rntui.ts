import readline from 'readline';
import chalk from 'chalk';
import { LogEntry, RnClient, Status, TargetInfo } from '../utils/rnclient.js';

const MAX_LINES = 5000;
const TABS = ['logs', 'network'] as const;
type Tab = (typeof TABS)[number];

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

export function filterEntries(entries: LogEntry[], filter: string): LogEntry[] {
  if (!filter) return entries;
  const f = filter.toLowerCase();
  return entries.filter(e => e.text.toLowerCase().includes(f));
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

export function frameHeight(rows: number, deviceBar: boolean): number {
  return Math.max(1, rows - 2 - (deviceBar ? 1 : 0));
}

function levelColor(e: LogEntry): (s: string) => string {
  if (e.kind === 'network') return e.level === 'error' ? chalk.red : chalk.gray;
  switch (e.level) {
    case 'error':
    case 'assert':
      return chalk.red;
    case 'warning':
    case 'warn':
      return chalk.yellow;
    case 'info':
      return chalk.cyan;
    case 'debug':
    case 'verbose':
      return chalk.gray;
    default:
      return (s: string) => s;
  }
}

function pad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

export interface FrameState {
  cols: number;
  rows: number;
  tab: Tab;
  buffers: Record<Tab, LogEntry[]>;
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

// Build the full screen frame as a string (pure → snapshot-testable).
export function renderFrame(s: FrameState): string {
  const hasDeviceBar = s.targets.length > 1;
  const h = frameHeight(s.rows, hasDeviceBar);
  const vis = filterEntries(s.buffers[s.tab], s.filter);

  const maxStart = Math.max(0, vis.length - h);
  const start = s.follow ? maxStart : Math.min(Math.max(0, s.scroll), maxStart);
  const window = vis.slice(start, start + h);

  const tabBar = TABS.map(t => {
    const label = ` ${t === 'logs' ? 'Logs' : 'Network'} (${s.buffers[t].length}) `;
    return t === s.tab ? chalk.inverse(label) : chalk.dim(label);
  }).join(' ');

  const restart = s.clearOnRestart ? 'restart:clear' : 'restart:keep';
  const head = ` ${s.who || '…'} · ${s.status} · ${restart}${s.filter ? ` · filter:"${s.filter}"` : ''}    ${tabBar}`;
  const foot =
    s.mode === 'normal'
      ? ` [ ] tabs${hasDeviceBar ? '  1-9 device' : ''}  /search  f filter  n/N next  c clear  k restart  r reconnect  ↑↓ scroll  q quit`
      : `${s.mode}: ${s.input}${chalk.inverse(' ')}`;

  let out = '\x1b[H\x1b[2J';
  out += chalk.inverse(pad(head, s.cols)) + '\n';
  if (hasDeviceBar) {
    const bar =
      ' Devices: ' +
      s.targets
        .map((t, i) => {
          const label = ` ${i + 1}:${t.label} `;
          return t.key === s.who ? chalk.inverse(label) : chalk.dim(label);
        })
        .join('');
    out += pad(bar, s.cols) + '\n';
  }

  if (s.tab === 'network' && s.networkSupported === false) {
    out += chalk.yellow(' Network isn’t exposed over CDP by this React Native version.');
    for (let i = 1; i < h; i++) out += '\n';
  } else {
    for (let i = 0; i < h; i++) {
      const e = window[i];
      out += (e ? levelColor(e)(highlight(e.text.slice(0, s.cols), s.search)) : '') + (i < h - 1 ? '\n' : '');
    }
  }
  out += '\n' + chalk.dim(pad(foot, s.cols));
  return out;
}

// ── TUI runtime ─────────────────────────────────────────────────────────────

export function runRnTui(port: number, nameFilter?: string): void {
  const buffers: Record<Tab, LogEntry[]> = { logs: [], network: [] };
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
    const key: Tab = e.kind === 'network' ? 'network' : 'logs';
    buffers[key].push(e);
    if (buffers[key].length > MAX_LINES) buffers[key].shift();
    render();
  });
  client.on('status', (s: Status, w?: string) => {
    if (s === 'disconnected') wasDisconnected = true;
    if (s === 'connected') {
      if (wasDisconnected && clearOnRestart) {
        buffers.logs.length = 0;
        buffers.network.length = 0;
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
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  function switchTab(dir: 1 | -1): void {
    tab = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
  }

  function jump(dir: 1 | -1): void {
    const vis = filterEntries(buffers[tab], filter);
    if (!search) return;
    const t = search.toLowerCase();
    const hits = vis.flatMap((e, i) => (e.text.toLowerCase().includes(t) ? [i] : []));
    if (!hits.length) return;
    const v = view[tab];
    const current = v.follow ? Math.max(0, vis.length - height()) : v.scroll;
    let next = dir === 1 ? hits.find(i => i > current) : [...hits].reverse().find(i => i < current);
    if (next === undefined) next = dir === 1 ? hits[0] : hits[hits.length - 1];
    v.follow = false;
    v.scroll = next;
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

    const h = height();
    const v = view[tab];
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();
    else if (str === '[') switchTab(-1);
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
    } else if (str === 'k') clearOnRestart = !clearOnRestart;
    else if (str && /^[1-9]$/.test(str)) {
      const idx = Number(str) - 1;
      if (idx < targets.length) {
        buffers.logs.length = 0;
        buffers.network.length = 0;
        client.select(idx);
      }
    } else if (str === 'r') client.reconnectNow();
    else if (str === 'n') jump(1);
    else if (str === 'N') jump(-1);
    else if (key.name === 'up') {
      v.follow = false;
      v.scroll = Math.max(0, v.scroll - 1);
    } else if (key.name === 'down') v.scroll += 1;
    else if (key.name === 'pageup') {
      v.follow = false;
      v.scroll = Math.max(0, v.scroll - h);
    } else if (key.name === 'pagedown') v.scroll += h;
    else if (str === 'g') {
      v.follow = false;
      v.scroll = 0;
    } else if (str === 'G') v.follow = true;
    render();
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l');
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKey);
  process.on('SIGINT', quit);
  process.stdout.on('resize', render);

  client.start();
  render();
}
