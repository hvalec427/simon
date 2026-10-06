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

// ── TUI ─────────────────────────────────────────────────────────────────────

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

  function hasDeviceBar(): boolean {
    return targets.length > 1;
  }

  function contentHeight(): number {
    return Math.max(1, (process.stdout.rows ?? 24) - 2 - (hasDeviceBar() ? 1 : 0));
  }

  function deviceBar(): string {
    return (
      ' Devices: ' +
      targets
        .map((t, i) => {
          const label = ` ${i + 1}:${t.label} `;
          return t.key === who ? chalk.inverse(label) : chalk.dim(label);
        })
        .join('')
    );
  }

  function visible(): LogEntry[] {
    return filterEntries(buffers[tab], filter);
  }

  function matchIndices(vis: LogEntry[]): number[] {
    if (!search) return [];
    const t = search.toLowerCase();
    const out: number[] = [];
    vis.forEach((e, i) => {
      if (e.text.toLowerCase().includes(t)) out.push(i);
    });
    return out;
  }

  function tabBar(): string {
    return TABS.map(t => {
      const label = ` ${t === 'logs' ? 'Logs' : 'Network'} (${buffers[t].length}) `;
      return t === tab ? chalk.inverse(label) : chalk.dim(label);
    }).join(' ');
  }

  function render(): void {
    const cols = process.stdout.columns ?? 80;
    const h = contentHeight();
    const v = view[tab];
    const vis = visible();

    const maxStart = Math.max(0, vis.length - h);
    const start = v.follow ? maxStart : Math.min(Math.max(0, v.scroll), maxStart);
    const window = vis.slice(start, start + h);

    const restart = clearOnRestart ? 'restart:clear' : 'restart:keep';
    const head = ` ${who || '…'} · ${status} · ${restart}${filter ? ` · filter:"${filter}"` : ''}    ${tabBar()}`;
    const foot =
      mode === 'normal'
        ? ` [ ] tabs${hasDeviceBar() ? '  1-9 device' : ''}  /search  f filter  n/N next  c clear  k restart  r reconnect  ↑↓ scroll  q quit`
        : `${mode}: ${input}${chalk.inverse(' ')}`;

    let out = '\x1b[H\x1b[2J';
    out += chalk.inverse(pad(head, cols)) + '\n';
    if (hasDeviceBar()) out += pad(deviceBar(), cols) + '\n';

    if (tab === 'network' && networkSupported === false) {
      out += chalk.yellow(' Network isn’t exposed over CDP by this React Native version.');
      for (let i = 1; i < h; i++) out += '\n';
    } else {
      for (let i = 0; i < h; i++) {
        const e = window[i];
        const line = e ? levelColor(e)(highlight(e.text.slice(0, cols), search)) : '';
        out += line + (i < h - 1 ? '\n' : '');
      }
    }
    out += '\n' + chalk.dim(pad(foot, cols));
    process.stdout.write(out);
  }

  function quit(): void {
    client.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  function switchTab(dir: 1 | -1): void {
    const idx = TABS.indexOf(tab);
    tab = TABS[(idx + dir + TABS.length) % TABS.length];
  }

  function jump(dir: 1 | -1): void {
    const vis = visible();
    const hits = matchIndices(vis);
    if (!hits.length) return;
    const h = contentHeight();
    const v = view[tab];
    const current = v.follow ? Math.max(0, vis.length - h) : v.scroll;
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

    const h = contentHeight();
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
    } else if (key.name === 'down') {
      v.scroll += 1;
    } else if (key.name === 'pageup') {
      v.follow = false;
      v.scroll = Math.max(0, v.scroll - h);
    } else if (key.name === 'pagedown') {
      v.scroll += h;
    } else if (str === 'g') {
      v.follow = false;
      v.scroll = 0;
    } else if (str === 'G') {
      v.follow = true;
    }
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
