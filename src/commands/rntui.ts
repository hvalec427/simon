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

// A copy-pasteable curl command for a captured request.
export function toCurl(rec: NetRecord): string {
  const parts = [`curl -X ${rec.method} ${JSON.stringify(rec.url)}`];
  for (const [k, v] of Object.entries(rec.reqHeaders ?? {})) parts.push(`-H ${JSON.stringify(`${k}: ${v}`)}`);
  if (rec.reqBody) parts.push(`--data ${JSON.stringify(rec.reqBody)}`);
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

export function frameHeight(rows: number, deviceBar: boolean): number {
  return Math.max(1, rows - 2 - (deviceBar ? 1 : 0));
}

// Explicit search-match style so it reads the same on the colored list and on
// the plain detail view (chalk.inverse looked gray on uncoloured detail text).
const hlMatch = chalk.bgCyanBright.black;

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
    out += text.slice(i, hit) + hlMatch(text.slice(hit, hit + term.length));
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
  buffers: Record<Tab, LogEntry[]>;
  netRecords: NetRecord[];
  sel: number;
  follow: boolean;
  detail: boolean;
  detailScroll: number;
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
  const netFilters =
    !isLogs && (s.errorsOnly || s.method !== 'ALL')
      ? ` · ${[s.errorsOnly ? 'errors' : '', s.method !== 'ALL' ? s.method : ''].filter(Boolean).join('+')}`
      : '';
  const head = ` ${s.who || '…'} · ${s.status}${s.filter ? ` · filter:"${s.filter}"` : ''}${netFilters} · ${restart}   ${tabBar}`;

  let foot: string;
  if (s.mode !== 'normal') foot = `${s.mode}: ${s.input}▏`;
  else if (s.flash) foot = ` ${s.flash}`;
  else if (s.detail) foot = ` ⏎/esc close · ↑↓/jk scroll · g/G top/bottom · / search${s.search ? ' · n/N' : ''} · y copy · q quit`;
  else
    foot =
      ` [ ] tabs${hasDeviceBar ? ' · 1-9 dev' : ''} · / search · f filter${s.search ? ' · n/N' : ''} · ⏎ expand · y copy` +
      (isLogs ? '' : ' · C curl · e errors · m method') +
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

  if (s.tab === 'network' && s.networkSupported === false && s.netRecords.length === 0) {
    body.push(chalk.yellowBright(' Network isn’t exposed over CDP by this React Native version.'));
    while (body.length < h) body.push('');
  } else if (s.detail && len > 0) {
    const dl = detailViewLines(s, items[effSel], cols);
    const start = clamp(s.detailScroll, 0, Math.max(0, dl.length - h));
    for (let i = 0; i < h; i++) {
      const l = dl[start + i];
      body.push(l === undefined ? '' : highlight(l, s.search));
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
  let detailHit = -1; // last search-matched detail line (for n/N + context offset)
  let detailLines: string[] | null = null;
  let detailLoading = false;
  let detailToken = 0; // invalidates in-flight object fetches when the view changes
  let tab: Tab = 'logs';
  let filter = '';
  let search = '';
  let mode: 'normal' | 'filter' | 'search' = 'normal';
  let input = '';
  let clearOnRestart = false;
  let targets: TargetInfo[] = [];
  let errorsOnly = false;
  let method = 'ALL';
  let flash: string | undefined;
  const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
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
  const items = () =>
    tab === 'logs' ? filterEntries(active().logs, filter) : netView(active().net, filter, errorsOnly, method);
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
      }),
    );
  }

  function quit(): void {
    client.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?7h\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  function closeDetail(): void {
    detail = false;
    detailLines = null;
    detailLoading = false;
    detailHit = -1;
    detailToken++; // cancel any in-flight fetch
  }

  function switchTab(dir: 1 | -1): void {
    tab = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
    closeDetail();
  }

  // Wrapped detail lines for the current selection (matches what renderFrame draws).
  function detailLinesNow(): string[] {
    const list = items();
    if (!list.length) return [];
    const effSel = follow ? list.length - 1 : Math.min(sel[tab], list.length - 1);
    return detailViewLines(
      { tab, detailLines, detailLoading } as FrameState,
      list[effSel],
      process.stdout.columns ?? 80,
    );
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
    return items().flatMap((it, i) => {
      const text = tab === 'logs' ? (it as LogEntry).text : `${(it as NetRecord).method} ${(it as NetRecord).url}`;
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

  // Live-follow the first match at/after the cursor as the search term is typed.
  function jumpFirst(): void {
    if (!search) return;
    if (detail) {
      const dl = detailLinesNow();
      const t = search.toLowerCase();
      const from = detailHit >= 0 ? detailHit : detailScroll;
      const hits = dl.flatMap((l, i) => (l.toLowerCase().includes(t) ? [i] : []));
      if (!hits.length) return;
      const next = hits.find(i => i >= from) ?? hits[0];
      detailHit = next;
      detailScroll = Math.max(0, next - CONTEXT);
      return;
    }
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
        if (mode === 'search') search = '';
        mode = 'normal';
      } else if (key.name === 'backspace') {
        input = input.slice(0, -1);
        if (mode === 'filter') filter = input;
        else {
          search = input;
          jumpFirst();
        }
      } else if (str && !key.ctrl) {
        input += str;
        if (mode === 'filter') filter = input;
        else {
          search = input;
          jumpFirst();
        }
      }
      render();
      return;
    }

    flash = undefined; // any normal-mode key dismisses a transient status

    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();

    if (detail) {
      const h = height();
      const max = Math.max(0, detailLinesNow().length - h);
      if (key.name === 'return' || key.name === 'escape') closeDetail();
      else if (str && /^[1-9]$/.test(str)) {
        const idx = Number(str) - 1;
        if (idx < targets.length) {
          activeKey = targets[idx].key; // switch device; the preview belonged to the old one
          closeDetail();
        }
      } else if (str === '/') {
        mode = 'search';
        input = search;
      } else if (str === 'y') return copySelection();
      else if (str === 'n') jumpDetail(1);
      else if (str === 'N') jumpDetail(-1);
      else {
        if (key.name === 'up' || str === 'k') detailScroll = Math.max(0, detailScroll - 1);
        else if (key.name === 'down' || str === 'j') detailScroll = Math.min(max, detailScroll + 1);
        else if (key.name === 'pageup') detailScroll = Math.max(0, detailScroll - h);
        else if (key.name === 'pagedown') detailScroll = Math.min(max, detailScroll + h);
        else if (str === 'g') detailScroll = 0;
        else if (str === 'G') detailScroll = max;
        detailHit = -1; // manual scroll — n/N should resume from here
      }
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
    else if (str === 'y') return copySelection();
    else if (str === 'C') return copyCurl();
    else if (str === 'e' && tab === 'network') errorsOnly = !errorsOnly;
    else if (str === 'm' && tab === 'network') method = METHODS[(METHODS.indexOf(method) + 1) % METHODS.length];
    else if (str === 'a' || key.name === 'space') {
      follow = !follow;
      if (follow) sel[tab] = Math.max(0, n - 1);
    } else if (str && /^[1-9]$/.test(str)) {
      const idx = Number(str) - 1;
      if (idx < targets.length) {
        // Instant view switch — the other device stays connected in the background.
        activeKey = targets[idx].key;
        closeDetail();
      }
    } else if (str === 'r') client.reconnectNow();
    else if (str === 'R') {
      if (activeKey) client.reloadApp(activeKey);
    } else if (key.name === 'return') {
      if (n > 0) {
        detail = true;
        detailScroll = 0;
        detailHit = -1;
        detailLines = null;
        detailLoading = false;
        const effSel = follow ? n - 1 : Math.min(sel[tab], n - 1);
        const it = items()[effSel] as LogEntry | undefined;
        if (tab === 'logs' && activeKey && it?.argObjectIds?.length) {
          detailLoading = true;
          const token = ++detailToken;
          client
            .getObjectTree(activeKey, it.argObjectIds)
            .then(tree => {
              if (token === detailToken) {
                detailLines = [it.text, '', ...tree];
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
