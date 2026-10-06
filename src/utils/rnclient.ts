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

function remoteValue(v: RemoteObject): string {
  if (v == null) return '';
  if (v.value !== undefined) return typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
  if (v.description) return v.description;
  return v.type ?? '';
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

  // Lazily expand an object's properties (deep) via Runtime.getProperties —
  // objectIds are only valid while the runtime still holds them.
  async getObjectTree(key: string, objectIds: string[], depth = 4): Promise<string[]> {
    const conn = this.conns.get(key);
    if (!conn?.ws || !conn.connected) return ['(device not connected — reconnect to inspect)'];
    const lines: string[] = [];
    for (const oid of objectIds) lines.push(...(await this.expandObject(conn, oid, depth, '')));
    return lines;
  }

  private async expandObject(conn: Conn, objectId: string, depth: number, indent: string): Promise<string[]> {
    let res: any;
    try {
      res = await this.request(conn, 'Runtime.getProperties', { objectId, ownProperties: true });
    } catch {
      return [`${indent}(unavailable — object no longer in memory)`];
    }
    const props = ((res?.result ?? []) as any[]).filter(p => p.value && p.enumerable !== false);
    if (!props.length) return [`${indent}(no properties)`];
    const out: string[] = [];
    for (const p of props.slice(0, 200)) {
      const v = p.value as RemoteObject;
      if (v.type === 'object' && v.objectId && depth > 0) {
        out.push(`${indent}${p.name}: ${v.description ?? (v.subtype === 'array' ? 'Array' : 'Object')}`);
        out.push(...(await this.expandObject(conn, v.objectId, depth - 1, indent + '  ')));
      } else {
        out.push(`${indent}${p.name}: ${remoteValue(v)}`);
      }
    }
    return out;
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
