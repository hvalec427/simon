import readline from 'readline';
import chalk from 'chalk';
import { LogEntry, RnClient, Status } from '../utils/rnclient.js';

const MAX_LINES = 5000;

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

export function filterEntries(entries: LogEntry[], filter: string, showNetwork: boolean): LogEntry[] {
  const f = filter.toLowerCase();
  return entries.filter(
    e => (showNetwork || e.kind !== 'network') && (!f || e.text.toLowerCase().includes(f)),
  );
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
  const entries: LogEntry[] = [];
  let filter = '';
  let search = '';
  let mode: 'normal' | 'filter' | 'search' = 'normal';
  let input = '';
  let follow = true;
  let scroll = 0;
  let showNetwork = true;
  let status: Status = 'connecting';
  let who = '';
  let networkSupported: boolean | undefined;

  const client = new RnClient(port, nameFilter);
  client.on('log', (e: LogEntry) => {
    entries.push(e);
    if (entries.length > MAX_LINES) entries.shift();
    render();
  });
  client.on('status', (s: Status, w?: string) => {
    status = s;
    if (w) who = w;
    render();
  });
  client.on('network', (ok: boolean) => {
    networkSupported = ok;
    render();
  });

  function contentHeight(): number {
    return Math.max(1, (process.stdout.rows ?? 24) - 2);
  }

  function visible(): LogEntry[] {
    return filterEntries(entries, filter, showNetwork);
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

  function render(): void {
    const cols = process.stdout.columns ?? 80;
    const h = contentHeight();
    const vis = visible();

    const maxStart = Math.max(0, vis.length - h);
    const start = follow ? maxStart : Math.min(Math.max(0, scroll), maxStart);
    const window = vis.slice(start, start + h);

    const net =
      networkSupported === false
        ? 'network: unsupported'
        : showNetwork
        ? 'console+network'
        : 'console only';
    const head = ` simon logs --rn · ${who || '…'} · ${status} · ${net} · ${vis.length} lines${
      filter ? ` · filter:"${filter}"` : ''
    }`;
    const foot =
      mode === 'normal'
        ? ' /search  f filter  n/N next/prev  t network  c clear  r reconnect  ↑↓ scroll  g/G top/bottom  q quit'
        : `${mode}: ${input}${chalk.inverse(' ')}`;

    let out = '\x1b[H\x1b[2J';
    out += chalk.inverse(pad(head, cols)) + '\n';
    for (let i = 0; i < h; i++) {
      const e = window[i];
      const line = e ? levelColor(e)(highlight(e.text.slice(0, cols), search)) : '';
      out += line + (i < h - 1 ? '\n' : '');
    }
    out += '\n' + chalk.dim(pad(foot, cols));
    process.stdout.write(out);
  }

  function quit(): void {
    client.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\x1b[?1049l'); // show cursor, leave alt screen
    process.exit(0);
  }

  function jump(dir: 1 | -1): void {
    const vis = visible();
    const hits = matchIndices(vis);
    if (!hits.length) return;
    const h = contentHeight();
    const current = follow ? Math.max(0, vis.length - h) : scroll;
    let next = dir === 1 ? hits.find(i => i > current) : [...hits].reverse().find(i => i < current);
    if (next === undefined) next = dir === 1 ? hits[0] : hits[hits.length - 1];
    follow = false;
    scroll = next;
  }

  function onKey(str: string | undefined, key: { name?: string; ctrl?: boolean; shift?: boolean }): void {
    if (mode !== 'normal') {
      if (key.name === 'return') {
        if (mode === 'filter') filter = input;
        else search = input;
        mode = 'normal';
        if (mode === 'normal' && search) jump(1);
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
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();
    else if (str === '/') {
      mode = 'search';
      input = search;
    } else if (str === 'f') {
      mode = 'filter';
      input = filter;
    } else if (str === 'c') entries.length = 0;
    else if (str === 't') showNetwork = !showNetwork;
    else if (str === 'r') client.reconnectNow();
    else if (str === 'n') jump(1);
    else if (str === 'N') jump(-1);
    else if (key.name === 'up') {
      follow = false;
      scroll = Math.max(0, scroll - 1);
    } else if (key.name === 'down') {
      scroll += 1;
    } else if (key.name === 'pageup') {
      follow = false;
      scroll = Math.max(0, scroll - h);
    } else if (key.name === 'pagedown') {
      scroll += h;
    } else if (str === 'g') {
      follow = false;
      scroll = 0;
    } else if (str === 'G') {
      follow = true;
    }
    render();
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l'); // alt screen, hide cursor
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKey);
  process.on('SIGINT', quit);
  process.stdout.on('resize', render);

  client.start();
  render();
}
