import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface LogEntry {
  kind: 'console' | 'network' | 'system';
  level: string;
  text: string;
  argObjectIds?: string[]; // objectIds of object/array args, for deep expansion
}

export interface TargetInfo {
  key: string;
  label: string;
}

export interface PerfSample {
  fps: number | null; // JS-thread frames/sec (null if Runtime.evaluate unsupported)
  heapUsed: number | null; // bytes
  heapTotal: number | null; // bytes
}

export interface NetRecord {
  id: string;
  method: string;
  url: string;
  status?: number;
  mimeType?: string;
  reqHeaders?: Record<string, string>;
  reqBody?: string;
  resHeaders?: Record<string, string>;
  resBody?: string;
  startTs?: number; // CDP monotonic timestamp (seconds) at request start
  durationMs?: number; // request→finished, once known
}

export type Status = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface RnTarget {
  webSocketDebuggerUrl?: string;
  title?: string;
  description?: string;
  deviceName?: string;
}

interface PreviewProp {
  name: string;
  value?: string;
  type?: string;
  subtype?: string;
  valuePreview?: ObjectPreview; // nested preview the runtime already sent (free)
}
interface ObjectPreview {
  subtype?: string;
  properties?: PreviewProp[];
  overflow?: boolean;
}
interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
  preview?: ObjectPreview;
  objectId?: string;
}

// A value that should be printed verbatim (unquoted) in the JS output — e.g.
// `undefined`, `ƒ ()`, `NaN`, or a depth-truncated `{…}`.
class Raw {
  constructor(public text: string) {}
}

function firstLine(s?: string): string {
  return (s ?? '').split('\n')[0].trim();
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

// Pretty-print a reconstructed value as a JS object/array literal.
function formatJs(value: unknown, indent = ''): string {
  if (value instanceof Raw) return value.text;
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const next = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => `${next}${formatJs(v === undefined ? new Raw('undefined') : v, next)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const body = entries.map(([k, v]) => `${next}${IDENT.test(k) ? k : JSON.stringify(k)}: ${formatJs(v, next)}`);
    return `{\n${body.join(',\n')}\n${indent}}`;
  }
  return String(value);
}

function previewToString(p: ObjectPreview): string {
  const valueOf = (pr: PreviewProp): string =>
    pr.valuePreview ? previewToString(pr.valuePreview) : pr.value ?? pr.type ?? '';
  const parts = (p.properties ?? []).map(pr => (p.subtype === 'array' ? valueOf(pr) : `${pr.name}: ${valueOf(pr)}`));
  if (p.overflow) parts.push('…');
  return p.subtype === 'array' ? `[${parts.join(', ')}]` : `{ ${parts.join(', ')} }`;
}

function renderArg(a: RemoteObject): string {
  if (a == null) return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.preview) return previewToString(a.preview);
  if (a.description) return a.description;
  if (a.unserializableValue) return a.unserializableValue;
  return a.type ?? '';
}

export function toEntry(msg: { method?: string; params?: any }): LogEntry | null {
  switch (msg.method) {
    case 'Runtime.consoleAPICalled': {
      const { type = 'log', args = [] } = msg.params ?? {};
      const list = args as RemoteObject[];
      const ids = list.filter(a => a?.objectId && a.type === 'object').map(a => a.objectId!);
      const entry: LogEntry = { kind: 'console', level: type, text: list.map(renderArg).join(' ') };
      if (ids.length) entry.argObjectIds = ids;
      return entry;
    }
    case 'Log.entryAdded': {
      const e = msg.params?.entry ?? {};
      return { kind: 'console', level: e.level ?? 'log', text: e.text ?? '' };
    }
    case 'Runtime.exceptionThrown': {
      const d = msg.params?.exceptionDetails ?? {};
      return { kind: 'console', level: 'error', text: d.exception?.description ?? d.text ?? 'Uncaught exception' };
    }
    default:
      return null;
  }
}

const keyOf = (t: RnTarget) => t.deviceName || t.title || 'app';

// List Metro inspector targets (label + CDP WebSocket URL) — handy for pointing
// an external debugger (e.g. nvim-dap's attach) at the right endpoint.
export async function fetchInspectorTargets(port: number): Promise<{ label: string; url: string }[]> {
  const res = await fetch(`http://localhost:${port}/json`);
  if (!res.ok) throw new Error(`Metro inspector returned ${res.status} ${res.statusText}`);
  const targets = (await res.json()) as RnTarget[];
  return targets.filter(t => t.webSocketDebuggerUrl).map(t => ({ label: keyOf(t), url: t.webSocketDebuggerUrl! }));
}

interface Conn {
  key: string;
  ws?: WebSocket;
  connected: boolean;
  netRecords: Map<string, NetRecord>;
  cmdSeq: number;
  pending: Map<number, (result: any) => void>;
}

/**
 * Connects to EVERY React Native target on Metro at once and keeps them alive,
 * so the UI can switch between devices instantly (no reconnect). Events are
 * tagged with the target key.
 *   'targets'        → (TargetInfo[])
 *   'status'         → (key, Status)
 *   'log'            → (key, LogEntry)
 *   'net'            → (key, NetRecord)
 *   'network'        → (key, boolean)   Network domain supported?
 *   'contextcleared' → (key)
 */
export class RnClient extends EventEmitter {
  private conns = new Map<string, Conn>();
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private port: number, private pollMs = 3000) {
    super();
  }

  start(): void {
    this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.conns.values()) this.closeConn(c);
    this.conns.clear();
  }

  // Reconnect any dead targets now (live ones are left alone).
  reconnectNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.poll();
  }

  reloadApp(key: string): void {
    const ws = this.conns.get(key)?.ws;
    if (!ws) return;
    const c = this.conns.get(key)!;
    try {
      ws.send(JSON.stringify({ id: c.cmdSeq++, method: 'Page.reload' }));
      ws.send(JSON.stringify({ id: c.cmdSeq++, method: 'ReactNativeApplication.reload' }));
    } catch {
      /* ignore */
    }
  }

  discardConsole(key: string): void {
    const c = this.conns.get(key);
    if (!c) return;
    c.netRecords.clear();
    if (!c.ws) return;
    try {
      c.ws.send(JSON.stringify({ id: c.cmdSeq++, method: 'Runtime.discardConsoleEntries' }));
      c.ws.send(JSON.stringify({ id: c.cmdSeq++, method: 'Log.clear' }));
    } catch {
      /* ignore */
    }
  }

  // Sample performance for a device: JS-thread FPS (via an injected
  // requestAnimationFrame counter) and JS heap usage. Native/UI FPS isn't
  // available over CDP. Returns null if the device isn't connected.
  async perfSample(key: string): Promise<PerfSample | null> {
    const conn = this.conns.get(key);
    if (!conn?.ws || !conn.connected) return null;
    // Installs a once-per-second rAF frame counter on first call (idempotent),
    // then returns the most recent frames-per-second value.
    const expr =
      '(function(){var s=globalThis.__simonFps;if(!s){s=globalThis.__simonFps={v:0,c:0,t:Date.now()};' +
      'var loop=function(){s.c++;var n=Date.now();if(n-s.t>=1000){s.v=Math.round(s.c*1000/(n-s.t));s.c=0;s.t=n;}' +
      '(globalThis.requestAnimationFrame||function(f){return setTimeout(f,16);})(loop);};loop();}return s.v;})()';
    let fps: number | null = null;
    let heapUsed: number | null = null;
    let heapTotal: number | null = null;
    try {
      const r = await this.request(conn, 'Runtime.evaluate', { expression: expr, returnByValue: true });
      const v = r?.result?.value;
      fps = typeof v === 'number' ? v : null;
    } catch {
      /* evaluate unsupported */
    }
    try {
      const h = await this.request(conn, 'Runtime.getHeapUsage', {});
      if (typeof h?.usedSize === 'number') heapUsed = h.usedSize;
      if (typeof h?.totalSize === 'number') heapTotal = h.totalSize;
    } catch {
      /* heap usage unsupported by this runtime */
    }
    return { fps, heapUsed, heapTotal };
  }

  // Lazily expand object args (deep) via Runtime.getProperties and render them as
  // real, pretty-printed JS objects/arrays. objectIds are only valid while the
  // runtime still holds them.
  async getObjectTree(key: string, objectIds: string[], depth = 4): Promise<string[]> {
    const conn = this.conns.get(key);
    if (!conn?.ws || !conn.connected) return ['(device not connected — reconnect to inspect)'];
    const lines: string[] = [];
    for (let i = 0; i < objectIds.length; i++) {
      const value = await this.buildValue(conn, { type: 'object', objectId: objectIds[i] }, depth);
      if (i > 0) lines.push('');
      lines.push(...formatJs(value).split('\n'));
    }
    return lines;
  }

  // Reconstruct a plain JS value from a RemoteObject, recursing into objects and
  // arrays. Non-serializable values (functions, dates, depth-limited objects)
  // become Raw markers so they render unquoted.
  private async buildValue(conn: Conn, v: RemoteObject, depth: number): Promise<unknown> {
    if (v == null) return null;
    if (v.type === 'undefined') return new Raw('undefined');
    if (v.type === 'function') return new Raw(`ƒ ${firstLine(v.description) || '()'}`);
    if (v.type === 'symbol') return new Raw(v.description ?? 'Symbol()');
    if (v.unserializableValue !== undefined) return new Raw(v.unserializableValue); // NaN, Infinity, -0, bigint
    if (v.value !== undefined) return v.value; // primitive: string | number | boolean | null
    if (v.type !== 'object') return v.description ?? v.type ?? null;
    if (v.subtype === 'null') return null;
    // Opaque object kinds: show their description rather than cracking them open.
    if (v.subtype && ['date', 'regexp', 'error', 'map', 'set', 'weakmap', 'weakset', 'proxy', 'promise', 'node'].includes(v.subtype)) {
      return new Raw(firstLine(v.description) || v.subtype);
    }
    if (!v.objectId || depth <= 0) return new Raw(v.subtype === 'array' ? '[…]' : firstLine(v.description) || '{…}');

    let res: any;
    try {
      res = await this.request(conn, 'Runtime.getProperties', { objectId: v.objectId, ownProperties: true });
    } catch {
      return new Raw('(unavailable — no longer in memory)');
    }
    const props = ((res?.result ?? []) as any[]).filter(p => p.value && p.enumerable !== false);
    if (v.subtype === 'array') {
      const arr: unknown[] = [];
      for (const p of props) {
        if (!/^\d+$/.test(p.name)) continue; // skip "length" and non-index keys
        arr[Number(p.name)] = await this.buildValue(conn, p.value as RemoteObject, depth - 1);
      }
      return arr;
    }
    const obj: Record<string, unknown> = {};
    for (const p of props.slice(0, 200)) obj[p.name] = await this.buildValue(conn, p.value as RemoteObject, depth - 1);
    return obj;
  }

  private request(conn: Conn, method: string, params: object): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!conn.ws) return reject(new Error('not connected'));
      const reqId = conn.cmdSeq++;
      const timer = setTimeout(() => {
        conn.pending.delete(reqId);
        reject(new Error('timeout'));
      }, 5000);
      conn.pending.set(reqId, result => {
        clearTimeout(timer);
        resolve(result);
      });
      conn.ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  private closeConn(c: Conn): void {
    c.pending.clear();
    if (c.ws) {
      try {
        c.ws.removeAllListeners();
        c.ws.on('error', () => {}); // swallow the late abort error when closing while still connecting
        c.ws.close();
      } catch {
        /* ignore */
      }
      c.ws = undefined;
    }
    c.connected = false;
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;

    let targets: RnTarget[] = [];
    try {
      const res = await fetch(`http://localhost:${this.port}/json`);
      if (res.ok) targets = (await res.json()) as RnTarget[];
    } catch {
      /* Metro down — keep existing conns, retry next tick */
    }

    const live = targets.filter(t => t.webSocketDebuggerUrl);
    this.emit('targets', live.map(t => ({ key: keyOf(t), label: keyOf(t) })));

    for (const t of live) {
      const key = keyOf(t);
      const existing = this.conns.get(key);
      if (!existing || !existing.connected) this.openConn(key, t.webSocketDebuggerUrl!);
    }

    if (!this.stopped) this.timer = setTimeout(() => this.poll(), this.pollMs);
  }

  private openConn(key: string, url: string): void {
    let conn = this.conns.get(key);
    if (!conn) {
      conn = { key, connected: false, netRecords: new Map(), cmdSeq: 1000, pending: new Map() };
      this.conns.set(key, conn);
    }
    if (conn.connected || conn.ws) return;

    const ws = new WebSocket(url, { origin: `http://localhost:${this.port}` });
    conn.ws = ws;
    this.emit('status', key, 'connecting');

    let id = 1;
    const send = (method: string) => ws.send(JSON.stringify({ id: id++, method }));
    const NETWORK_ENABLE_ID = 3;
    const fetchBody = async (requestId: string) => {
      try {
        const r = await this.request(conn!, 'Network.getResponseBody', { requestId });
        const rec = conn!.netRecords.get(requestId);
        if (rec && r) {
          rec.resBody = r.base64Encoded ? Buffer.from(r.body ?? '', 'base64').toString('utf8') : r.body;
          this.emit('net', key, rec);
        }
      } catch {
        /* body unavailable */
      }
    };

    ws.on('open', () => {
      conn!.connected = true;
      send('Runtime.enable');
      send('Log.enable');
      send('Network.enable');
      this.emit('status', key, 'connected');
    });
    ws.on('message', data => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.id === NETWORK_ENABLE_ID) {
        this.emit('network', key, !msg.error);
        return;
      }
      if (msg.id && conn!.pending.has(msg.id)) {
        const cb = conn!.pending.get(msg.id)!;
        conn!.pending.delete(msg.id);
        cb(msg.result);
        return;
      }
      if (msg.method === 'Runtime.executionContextsCleared') {
        conn!.netRecords.clear();
        this.emit('contextcleared', key);
        return;
      }
      if (typeof msg.method === 'string' && msg.method.startsWith('Network.')) {
        this.handleNetwork(conn!, key, msg, fetchBody);
        return;
      }
      const entry = toEntry(msg);
      if (entry) this.emit('log', key, entry);
    });
    ws.on('close', () => {
      conn!.connected = false;
      conn!.ws = undefined;
      if (!this.stopped) this.emit('status', key, 'disconnected');
    });
    ws.on('error', () => {
      /* 'close' follows; poll will reopen */
    });
  }

  private handleNetwork(conn: Conn, key: string, msg: { method?: string; params?: any }, fetchBody: (id: string) => void): void {
    const p = msg.params ?? {};
    if (msg.method === 'Network.requestWillBeSent') {
      const r = p.request ?? {};
      const rec: NetRecord = {
        id: p.requestId,
        method: r.method ?? 'GET',
        url: r.url ?? '',
        reqHeaders: r.headers,
        reqBody: r.postData,
        startTs: typeof p.timestamp === 'number' ? p.timestamp : undefined,
      };
      conn.netRecords.set(p.requestId, rec);
      this.emit('net', key, rec);
    } else if (msg.method === 'Network.responseReceived') {
      const rec = conn.netRecords.get(p.requestId);
      if (rec) {
        const res = p.response ?? {};
        rec.status = res.status;
        rec.resHeaders = res.headers;
        rec.mimeType = res.mimeType;
        this.emit('net', key, rec);
      }
    } else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
      const rec = conn.netRecords.get(p.requestId);
      if (rec) {
        if (rec.startTs !== undefined && typeof p.timestamp === 'number') {
          rec.durationMs = Math.max(0, (p.timestamp - rec.startTs) * 1000);
        }
        this.emit('net', key, rec);
        fetchBody(p.requestId);
      }
    }
  }
}
