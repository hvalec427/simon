import readline from 'readline';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { LogEntry, NetRecord, RnClient, Status, TargetInfo } from '../utils/rnclient.js';

function pbcopy(text: string): boolean {
  try {
    const r = spawnSync('pbcopy', { input: text });
    return r.status === 0;
  } catch {
    return false;
  }
}

const MAX_LINES = 5000;
const MAX_NET = 1000;
const PERF_HISTORY = 60;
const TABS = ['logs', 'network', 'perf'] as const;
type Tab = (typeof TABS)[number];

export interface PerfState {
  fps: number | null;
  heapUsed: number | null;
  heapTotal: number | null;
  history: number[];
}

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

export function filterEntries(entries: LogEntry[], filter: string): LogEntry[] {
  if (!filter) return entries;
  const f = filter.toLowerCase();
  return entries.filter(e => e.text.toLowerCase().includes(f));
}

export function filterRecords(records: NetRecord[], filter: string): NetRecord[] {
  if (!filter) return records;
  const f = filter.toLowerCase();
  // Match the whole row: status code, method, url, duration and GraphQL op name
  // (netSummary already composes all of these).
  return records.filter(r => netSummary(r).text.toLowerCase().includes(f));
}

// Extract a GraphQL operation name from a request body (operationName, else the
// name in the query/mutation/subscription, else "anonymous"). Handles batches.
export function graphqlOperation(rec: NetRecord): string | undefined {
  if (!rec.reqBody) return undefined;
  let body: any;
  try {
    body = JSON.parse(rec.reqBody);
  } catch {
    return undefined;
  }
  const pick = (o: any): string | undefined => {
    if (!o || typeof o !== 'object') return undefined;
    if (o.operationName) return String(o.operationName);
    if (typeof o.query === 'string') {
      const m = o.query.match(/\b(query|mutation|subscription)\s+(\w+)/);
      return m ? m[2] : 'anonymous';
    }
    return undefined;
  };
  if (Array.isArray(body)) {
    const ops = body.map(pick).filter(Boolean);
    return ops.length ? ops.join(', ') : undefined;
  }
  return pick(body);
}

function fmtDuration(ms?: number): string {
  if (ms === undefined) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function netSummary(rec: NetRecord): { text: string; error: boolean; pending: boolean } {
  const pending = rec.status === undefined;
  const op = graphqlOperation(rec);
  const dur = fmtDuration(rec.durationMs);
  return {
    text: `${pending ? '···' : rec.status}  ${rec.method} ${rec.url}${dur ? `  ${dur}` : ''}${op ? `  ${op}` : ''}`,
    error: typeof rec.status === 'number' && rec.status >= 400,
    pending,
  };
}

// Network list with text + status-class + method filters applied.
export function netView(records: NetRecord[], filter: string, errorsOnly: boolean, method: string): NetRecord[] {
  let out = filterRecords(records, filter);
  if (errorsOnly) out = out.filter(r => typeof r.status === 'number' && r.status >= 400);
  if (method !== 'ALL') out = out.filter(r => r.method.toUpperCase() === method);
  return out;
}

// Single-quote for the shell so nothing inside is expanded — crucial for
// GraphQL bodies full of $variables, which double quotes would let the shell eat.
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// A copy-pasteable curl command for a captured request.
export function toCurl(rec: NetRecord): string {
  const parts = [`curl -X ${rec.method} ${shQuote(rec.url)}`];
  for (const [k, v] of Object.entries(rec.reqHeaders ?? {})) parts.push(`-H ${shQuote(`${k}: ${v}`)}`);
  if (rec.reqBody) parts.push(`--data ${shQuote(rec.reqBody)}`);
  return parts.join(' \\\n  ');
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
  const op = graphqlOperation(rec);
  return [
    `${rec.method} ${rec.url}`,
    `Status: ${rec.status ?? '(pending)'}${rec.durationMs !== undefined ? `  ·  ${fmtDuration(rec.durationMs)}` : ''}${rec.mimeType ? `  ·  ${rec.mimeType}` : ''}`,
    ...(op ? [`GraphQL: ${op}`] : []),
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

// The wrapped lines shown in the detail/preview view — shared by the renderer
// and the runtime's scroll/search so they agree on line positions.
export function detailViewLines(s: FrameState, item: LogEntry | NetRecord, cols: number): string[] {
  const raw = s.detailLoading
    ? ['Fetching object…']
    : s.detailLines && s.detailLines.length
    ? s.detailLines
    : s.tab === 'logs'
    ? logDetailLines(item as LogEntry)
    : netDetailLines(item as NetRecord);
  // Wrap long lines so everything is reachable by scrolling (nothing cut off).
  return raw.flatMap(l => wrap(oneLine(l), cols));
}

const SPARK = '▁▂▃▄▅▆▇█';

function fpsColor(fps: number): (s: string) => string {
  return fps >= 50 ? chalk.greenBright : fps >= 30 ? chalk.yellowBright : chalk.redBright;
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function sparkline(values: number[], max = 60): string {
  return values.map(v => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round((v / max) * (SPARK.length - 1))))]).join('');
}

// The Performance tab body: JS-thread FPS + a history sparkline + JS heap usage.
export function perfLines(perf: PerfState | null | undefined, cols: number, h: number): string[] {
  const out: string[] = ['', '  JS thread'];
  const fps = perf?.fps ?? null;
  if (fps == null) {
    out.push('    FPS  ' + chalk.gray('— (measuring…)'));
  } else {
    const width = Math.min(30, Math.max(10, cols - 20));
    const filled = Math.round((Math.min(fps, 60) / 60) * width);
    const barStr = '█'.repeat(filled) + '░'.repeat(width - filled);
    out.push(`    FPS  ${fpsColor(fps)(String(fps).padStart(2))} / 60   ${fpsColor(fps)(barStr)}`);
  }
  if (perf?.history.length) out.push(`    last ${perf.history.length}s  ${sparkline(perf.history)}`);
  out.push('', '  Memory (JS heap)');
  out.push(
    perf?.heapUsed == null
      ? '    ' + chalk.gray('not reported by this runtime')
      : `    used ${mb(perf.heapUsed)}${perf.heapTotal ? chalk.gray(` / ${mb(perf.heapTotal)}`) : ''}`,
  );
  out.push('', chalk.gray('  JS-thread FPS = how fast JS services frames (≤60). Native/UI FPS isn’t exposed over CDP.'));
  while (out.length < h) out.push('');
  return out.slice(0, h);
}

export function frameHeight(rows: number, deviceBar: boolean): number {
  return Math.max(1, rows - 2 - (deviceBar ? 1 : 0));
}

type Style = (s: string) => string;
// The active match (where n/N / the selection sits) vs every other match.
const hlCurrent = chalk.bgYellowBright.black;
const hlOther = chalk.bgCyanBright.black;

// Paint a line by styling non-match and match runs independently, then
// concatenating — avoids nested-chalk reset bugs so a base style (e.g. a
// selection bar) survives across highlighted matches.
export function paint(text: string, term: string, base: Style, match: Style): string {
  if (!term) return base(text);
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(t, i);
    if (hit === -1) {
      out += base(text.slice(i));
      break;
    }
    if (hit > i) out += base(text.slice(i, hit));
    out += match(text.slice(hit, hit + term.length));
    i = hit + term.length;
  }
  return out;
}

// Back-compat helper: highlight matches on otherwise-unstyled text.
export function highlight(text: string, term: string): string {
  return paint(text, term, s => s, hlOther);
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

// Wrap a plain line into width-sized chunks so long values aren't cut off in
// the (scrollable) detail view.
function wrap(s: string, width: number): string[] {
  if (s.length <= width) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width));
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export interface FrameState {
  cols: number;
  rows: number;
  tab: Tab;
  buffers: { logs: LogEntry[]; network: LogEntry[] };
  netRecords: NetRecord[];
  sel: number;
  follow: boolean;
  detail: boolean;
  maximized?: boolean; // preview pane fills the width (list hidden)
  detailScroll: number;
  detailHit?: number; // index of the active match line in the detail view
  detailLines?: string[] | null; // fetched deep-object tree (logs); overrides the default
  detailLoading?: boolean;
  filter: string;
  search: string;
  mode: 'normal' | 'filter' | 'search';
  input: string;
  clearOnRestart: boolean;
  status: Status;
  who: string;
  networkSupported?: boolean;
  targets: TargetInfo[];
  errorsOnly: boolean;
  method: string; // 'ALL' | 'GET' | 'POST' | ...
  flash?: string; // transient one-shot status (e.g. "copied")
  perf?: PerfState | null; // Performance tab data for the active device
}

export function renderFrame(s: FrameState): string {
  const cols = s.cols;
  const hasDeviceBar = s.targets.length > 1;
  const h = frameHeight(s.rows, hasDeviceBar);
  const isLogs = s.tab === 'logs';

  const tabBar = TABS.map(t => {
    const label =
      t === 'logs' ? `Logs (${s.buffers.logs.length})` : t === 'network' ? `Network (${s.netRecords.length})` : 'Perf';
    return t === s.tab ? `[${label}]` : ` ${label} `;
  }).join(' ');

  const restart = `${s.clearOnRestart ? 'clears' : 'keeps'} logs on restart`;
  const netFilters =
    !isLogs && (s.errorsOnly || s.method !== 'ALL')
      ? ` · ${[s.errorsOnly ? 'errors' : '', s.method !== 'ALL' ? s.method : ''].filter(Boolean).join('+')}`
      : '';
  const head = ` ${s.who || '…'} · ${s.status}${s.filter ? ` · filter:"${s.filter}"` : ''}${netFilters} · ${restart}   ${tabBar}`;

  let foot: string;
  if (s.mode !== 'normal') foot = `${s.mode}: ${s.input}▏`;
  else if (s.flash) foot = ` ${s.flash}`;
  else if (s.tab === 'perf')
    foot = ` [ ] tabs${hasDeviceBar ? ' · 1-9 dev' : ''} · live JS-thread FPS + heap · R reload · r reconnect · q quit`;
  else if (s.detail && s.maximized)
    foot =
      ` ⏎ close · z split · jk/JK scroll · g/G · / search${s.search ? ' · n/N' : ''}` +
      ` · y copy${isLogs ? '' : ' · c curl'} · q quit`;
  else if (s.detail)
    foot = ` ⏎ close · z max · jk list · JK scroll · / search${s.search ? ' · n/N' : ''} · y copy · c clear · q quit`;
  else
    foot =
      ` [ ] tabs${hasDeviceBar ? ' · 1-9 dev' : ''} · / search${s.search ? ' · n/N' : ''} · f filter · ⏎ preview · z max · y copy` +
      (isLogs ? '' : ` · e errors:${s.errorsOnly ? 'on' : 'off'} · m method:${s.method}`) +
      ` · space/a scroll:${s.follow ? 'on' : 'off'} · g/G · c clear · R reload · r reconnect · p restart · q quit`;

  const lines: string[] = [bar(pad(head, cols))];
  if (hasDeviceBar) {
    const db =
      ' Devices: ' +
      s.targets.map((t, i) => (t.key === s.who ? `[${i + 1}:${t.label}]` : ` ${i + 1}:${t.label} `)).join(' ');
    lines.push(bar(pad(db, cols)));
  }

  const body: string[] = [];
  const items: (LogEntry | NetRecord)[] = isLogs
    ? filterEntries(s.buffers.logs, s.filter)
    : netView(s.netRecords, s.filter, s.errorsOnly, s.method);
  const len = items.length;
  const effSel = s.follow ? len - 1 : clamp(s.sel, 0, Math.max(0, len - 1));

  // A list row, highlighted so matches always show. The selected row is the
  // active match (current style) only when we're searching the list itself —
  // i.e. the preview is closed; otherwise the active match lives in the pane.
  const listRow = (item: LogEntry | NetRecord, width: number, selected: boolean): string => {
    const rawText = isLogs ? (item as LogEntry).text : netSummary(item as NetRecord).text;
    const t = pad(oneLine(rawText).slice(0, width), width);
    const base: Style = selected
      ? chalk.inverse
      : isLogs
      ? levelColor(item as LogEntry)
      : netSummary(item as NetRecord).error
      ? chalk.redBright
      : chalk.whiteBright;
    const matchStyle: Style = selected && !s.detail ? hlCurrent : hlOther;
    return paint(t, s.search, base, matchStyle);
  };

  // A detail-pane line; the active match line gets the current style.
  const detailLine = (dl: string[], absIdx: number, width: number): string => {
    const dline = dl[absIdx];
    if (dline === undefined) return pad('', width);
    const txt = pad(oneLine(dline).slice(0, width), width);
    return paint(txt, s.search, x => x, absIdx === s.detailHit ? hlCurrent : hlOther);
  };

  if (s.tab === 'perf') {
    for (const l of perfLines(s.perf, cols, h)) body.push(l);
  } else if (s.tab === 'network' && s.networkSupported === false && s.netRecords.length === 0) {
    body.push(chalk.yellowBright(' Network isn’t exposed over CDP by this React Native version.'));
    while (body.length < h) body.push('');
  } else if (s.detail && s.maximized && len > 0) {
    // Maximized: the preview fills the full width (list hidden).
    const dl = detailViewLines(s, items[effSel], cols);
    const dStart = clamp(s.detailScroll, 0, Math.max(0, dl.length - h));
    for (let i = 0; i < h; i++) body.push(detailLine(dl, dStart + i, cols));
  } else if (s.detail && len > 0) {
    // Side-by-side: list on the left, detail pane on the right.
    const sep = chalk.gray('│');
    const leftW = Math.max(16, Math.floor(cols * 0.45));
    const rightW = Math.max(1, cols - leftW - 1);
    const listStart = clamp(effSel - Math.floor(h / 2), 0, Math.max(0, len - h));
    const dl = detailViewLines(s, items[effSel], rightW);
    const dStart = clamp(s.detailScroll, 0, Math.max(0, dl.length - h));
    for (let i = 0; i < h; i++) {
      const idx = listStart + i;
      const item = items[idx];
      const left = item ? listRow(item, leftW, idx === effSel) : pad('', leftW);
      body.push(left + sep + detailLine(dl, dStart + i, rightW));
    }
  } else {
    const start = s.follow ? Math.max(0, len - h) : clamp(effSel - Math.floor(h / 2), 0, Math.max(0, len - h));
    for (let i = 0; i < h; i++) {
      const idx = start + i;
      const item = items[idx];
      body.push(item ? listRow(item, cols, idx === effSel) : '');
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
  perf?: PerfState;
}

export function runRnTui(port: number, nameFilter?: string): void {
  const devices = new Map<string, Device>();
  let activeKey: string | undefined;
  const sel: Record<Tab, number> = { logs: 0, network: 0, perf: 0 };
  let follow = true;
  let detail = false;
  let maximized = false;
  let openedByMaximize = false; // pane was opened by `z` from the list (closes fully on un-maximize)
  let detailScroll = 0;
  let detailHit = -1; // last search-matched detail line (for n/N + context offset)
  let detailLines: string[] | null = null;
  let detailLoading = false;
  let detailToken = 0; // invalidates in-flight object fetches when the view changes
  let tab: Tab = 'logs';
  let filter = '';
  let search = '';
  let mode: 'normal' | 'filter' | 'search' = 'normal';
  let input = '';
  let searchBeforeEdit = ''; // active search to restore if a new `/` entry is cancelled
  let clearOnRestart = false;
  let targets: TargetInfo[] = [];
  let errorsOnly = false;
  let method = 'ALL';
  let flash: string | undefined;
  const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
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
  const items = (): (LogEntry | NetRecord)[] =>
    tab === 'logs'
      ? filterEntries(active().logs, filter)
      : tab === 'network'
      ? netView(active().net, filter, errorsOnly, method)
      : [];
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
        maximized,
        detailScroll,
        detailHit,
        detailLines,
        detailLoading,
        filter,
        search,
        mode,
        input,
        clearOnRestart,
        status: d.status,
        who: activeKey ?? '',
        networkSupported: d.networkSupported,
        targets,
        errorsOnly,
        method,
        flash,
        perf: d.perf,
      }),
    );
  }

  // Poll performance for the active device while the Perf tab is visible.
  let sampling = false;
  async function sampleNow(): Promise<void> {
    if (sampling || tab !== 'perf' || !activeKey) return;
    sampling = true;
    try {
      const s = await client.perfSample(activeKey);
      if (s) {
        const d = dev(activeKey);
        const history = d.perf?.history ?? [];
        if (s.fps != null) {
          history.push(s.fps);
          while (history.length > PERF_HISTORY) history.shift();
        }
        d.perf = { fps: s.fps, heapUsed: s.heapUsed, heapTotal: s.heapTotal, history };
        if (tab === 'perf') render();
      }
    } finally {
      sampling = false;
    }
  }

  const perfTimer = setInterval(sampleNow, 1000);

  function quit(): void {
    clearInterval(perfTimer);
    client.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?7h\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  function closeDetail(): void {
    detail = false;
    maximized = false;
    openedByMaximize = false;
    detailLines = null;
    detailLoading = false;
    detailHit = -1;
    detailToken++; // cancel any in-flight fetch
  }

  // (Re)load the detail pane for the current selection — reset scroll/search and
  // lazily fetch the deep object tree for a log with object args.
  function refreshDetail(): void {
    detailScroll = 0;
    detailHit = -1;
    detailLines = null;
    detailLoading = false;
    detailToken++;
    const list = items();
    if (!list.length) return;
    const effSel = follow ? list.length - 1 : Math.min(sel[tab], list.length - 1);
    const it = list[effSel];
    if (tab === 'logs' && activeKey && (it as LogEntry)?.argObjectIds?.length) {
      detailLoading = true;
      const token = detailToken;
      const text = (it as LogEntry).text;
      client
        .getObjectTree(activeKey, (it as LogEntry).argObjectIds!)
        .then(tree => {
          if (token === detailToken) {
            detailLines = [text, '', ...tree];
            detailLoading = false;
            render();
          }
        })
        .catch(() => {
          if (token === detailToken) {
            detailLoading = false;
            render();
          }
        });
    }
  }

  function openDetail(): void {
    if (count() === 0) return;
    detail = true;
    refreshDetail();
  }

  function switchTab(dir: 1 | -1): void {
    tab = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
    closeDetail();
  }

  // Width of the detail pane as renderFrame draws it (full width when maximized,
  // otherwise the right ~55% of the split). Kept in sync so match/scroll indices
  // line up with what's on screen.
  function detailWidth(): number {
    const cols = process.stdout.columns ?? 80;
    if (maximized) return cols;
    const leftW = Math.max(16, Math.floor(cols * 0.45));
    return Math.max(1, cols - leftW - 1);
  }

  // Wrapped detail lines for the current selection (matches what renderFrame draws).
  function detailLinesNow(): string[] {
    const list = items();
    if (!list.length) return [];
    const effSel = follow ? list.length - 1 : Math.min(sel[tab], list.length - 1);
    return detailViewLines({ tab, detailLines, detailLoading } as FrameState, list[effSel], detailWidth());
  }

  const CONTEXT = 3; // lines of context to keep above a jumped-to match

  // Scroll to the next/previous detail line matching the search term, keeping a
  // few lines of context above it.
  function jumpDetail(dir: 1 | -1): void {
    if (!search) return;
    const dl = detailLinesNow();
    const t = search.toLowerCase();
    const hits = dl.flatMap((l, i) => (l.toLowerCase().includes(t) ? [i] : []));
    if (!hits.length) return;
    const base = detailHit >= 0 ? detailHit : detailScroll;
    let next = dir === 1 ? hits.find(i => i > base) : [...hits].reverse().find(i => i < base);
    if (next === undefined) next = dir === 1 ? hits[0] : hits[hits.length - 1];
    detailHit = next;
    detailScroll = Math.max(0, next - CONTEXT);
  }

  const matchIndexes = (): number[] => {
    const t = search.toLowerCase();
    // Match the exact text shown in the row (incl. status/duration/op) so n/N
    // reaches every highlighted match.
    return items().flatMap((it, i) => {
      const text = tab === 'logs' ? (it as LogEntry).text : netSummary(it as NetRecord).text;
      return text.toLowerCase().includes(t) ? [i] : [];
    });
  };

  function jump(dir: 1 | -1): void {
    if (!search) return;
    const hits = matchIndexes();
    if (!hits.length) return;
    const base = follow ? count() - 1 : sel[tab];
    let next = dir === 1 ? hits.find(i => i > base) : [...hits].reverse().find(i => i < base);
    if (next === undefined) next = dir === 1 ? hits[0] : hits[hits.length - 1];
    follow = false;
    sel[tab] = next;
  }

  // Live-follow the first match as the search term is typed — only when the
  // preview is closed (search targets the list). With the preview open, search
  // targets the pane, so typing just updates highlights; use n/N to step.
  function jumpFirst(): void {
    if (!search || detail) return;
    const hits = matchIndexes();
    if (!hits.length) return;
    const base = follow ? 0 : sel[tab];
    follow = false;
    sel[tab] = hits.find(i => i >= base) ?? hits[0];
  }

  // Copy the selected row: a log (its text, plus the deep object tree if any)
  // or a network request (full detail — headers + bodies).
  function copySelection(): void {
    const list = items();
    if (!list.length) return;
    const effSel = follow ? list.length - 1 : Math.min(sel[tab], list.length - 1);
    const it = list[effSel];
    if (tab === 'logs') {
      const e = it as LogEntry;
      if (activeKey && e.argObjectIds?.length) {
        client
          .getObjectTree(activeKey, e.argObjectIds)
          .then(tree => setFlash(copyText([e.text, '', ...tree].join('\n'))))
          .catch(() => setFlash('copy failed'));
        setFlash('copying…');
      } else {
        setFlash(copyText(logDetailLines(e).join('\n')));
      }
    } else {
      setFlash(copyText(netDetailLines(it as NetRecord).join('\n')));
    }
  }

  function copyCurl(): void {
    if (tab !== 'network') return;
    const list = items();
    if (!list.length) return;
    const effSel = follow ? list.length - 1 : Math.min(sel[tab], list.length - 1);
    setFlash(copyText(toCurl(list[effSel] as NetRecord), 'copied curl'));
  }

  function copyText(text: string, label = 'copied'): string {
    return pbcopy(text) ? `${label} (${text.length} chars)` : 'copy failed (pbcopy unavailable)';
  }

  function setFlash(msg: string): void {
    flash = msg;
    render();
  }

  function onKey(str: string | undefined, key: { name?: string; ctrl?: boolean }): void {
    if (mode !== 'normal') {
      if (key.name === 'return') {
        mode = 'normal';
        if (search) (detail ? jumpDetail : jump)(1);
      } else if (key.name === 'escape') {
        if (mode === 'search') search = searchBeforeEdit; // cancel: keep the previously active search
        mode = 'normal';
      } else if (key.name === 'backspace' || (str && !key.ctrl)) {
        input = key.name === 'backspace' ? input.slice(0, -1) : input + str;
        if (mode === 'filter') {
          filter = input;
          if (detail) refreshDetail();
        } else {
          search = input;
          jumpFirst(); // list-only; no-op while the preview (split/max) is open
        }
      }
      render();
      return;
    }

    flash = undefined; // any normal-mode key dismisses a transient status

    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();

    const h = height();
    const n = count();
    const prevSel = sel[tab];
    const prevFollow = follow;
    const prevKey = activeKey;
    const prevFilter = filter;
    const prevErrors = errorsOnly;
    const prevMethod = method;
    // Maximized = "preview mode": every movement/copy key drives the pane.
    // Otherwise (list-only or split) = "list mode": keys drive the list.
    const previewMode = detail && maximized;
    const detailMax = () => Math.max(0, detailLinesNow().length - h);
    const scrollDetail = (d: number) => {
      detailScroll = clamp(detailScroll + d, 0, detailMax());
      detailHit = -1;
    };

    // ── keys shared by both modes ───────────────────────────────────────────
    if (str === '[') switchTab(-1);
    else if (str === ']') switchTab(1);
    else if (str === 'f') {
      mode = 'filter';
      input = filter;
    } else if (str === '/') {
      mode = 'search';
      input = ''; // always start empty — don't prefill the last query
      searchBeforeEdit = search; // the current search stays active until a new one is typed
      if (detail) {
        detailScroll = 0; // preview search (split or maximized) starts at the pane top
        detailHit = -1;
      }
    } else if (str === 'n') detail ? jumpDetail(1) : jump(1);
    else if (str === 'N') detail ? jumpDetail(-1) : jump(-1);
    else if (str === 'z') {
      // Toggle a full-width (maximized) preview.
      if (!detail) {
        openDetail();
        maximized = true;
        openedByMaximize = true; // opened from the list → un-maximizing closes it
      } else if (maximized) {
        maximized = false;
        if (openedByMaximize) closeDetail(); // never opened a split, so return to the list
      } else {
        maximized = true; // was a split → just grow it
      }
    } else if (str === 'p') clearOnRestart = !clearOnRestart;
    else if (str === 'y') return copySelection();
    else if (str === 'e' && tab === 'network') errorsOnly = !errorsOnly;
    else if (str === 'm' && tab === 'network') method = METHODS[(METHODS.indexOf(method) + 1) % METHODS.length];
    else if (str === 'a' || key.name === 'space') {
      follow = !follow;
      if (follow) sel[tab] = Math.max(0, n - 1);
    } else if (str && /^[1-9]$/.test(str)) {
      const idx = Number(str) - 1;
      // Instant view switch — the other device stays connected in the background.
      if (idx < targets.length) activeKey = targets[idx].key;
    } else if (str === 'r') client.reconnectNow();
    else if (str === 'R') {
      if (activeKey) client.reloadApp(activeKey);
    } else if (key.name === 'return') {
      detail ? closeDetail() : openDetail();
    } else if (previewMode) {
      // ── preview mode: keys drive the maximized pane ───────────────────────
      if (str === 'c') return tab === 'network' ? copyCurl() : copySelection();
      else if (key.name === 'up' || str === 'k' || str === 'K') scrollDetail(-1);
      else if (key.name === 'down' || str === 'j' || str === 'J') scrollDetail(1);
      else if (key.name === 'pageup') scrollDetail(-h);
      else if (key.name === 'pagedown') scrollDetail(h);
      else if (str === 'g') {
        detailScroll = 0;
        detailHit = -1;
      } else if (str === 'G') {
        detailScroll = detailMax();
        detailHit = -1;
      }
    } else {
      // ── list mode (list-only or split): keys drive the list ───────────────
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
      if (str === 'c') {
        active().logs.length = 0;
        active().net.length = 0;
        if (activeKey) client.discardConsole(activeKey); // so a reconnect won't replay
      } else if (str === 'J') scrollDetail(1); // scroll the split pane (if open)
      else if (str === 'K') scrollDetail(-1);
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
    }

    // When the split pane is open, keep it in sync with whatever the list shows.
    if (
      detail &&
      (sel[tab] !== prevSel ||
        follow !== prevFollow ||
        activeKey !== prevKey ||
        filter !== prevFilter ||
        errorsOnly !== prevErrors ||
        method !== prevMethod)
    ) {
      refreshDetail();
    }
    render();
    if (tab === 'perf') void sampleNow(); // sample promptly on entering perf / switching device
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
