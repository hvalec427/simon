import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface LogEntry {
  kind: 'console' | 'network' | 'system';
  level: string;
  text: string;
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
}

function previewToString(p: ObjectPreview): string {
  const parts = (p.properties ?? []).map(pr => (p.subtype === 'array' ? `${pr.value}` : `${pr.name}: ${pr.value}`));
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
      return { kind: 'console', level: type, text: (args as RemoteObject[]).map(renderArg).join(' ') };
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

  private closeConn(c: Conn): void {
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
      conn = { key, connected: false, netRecords: new Map(), cmdSeq: 1000 };
      this.conns.set(key, conn);
    }
    if (conn.connected || conn.ws) return;

    const ws = new WebSocket(url, { origin: `http://localhost:${this.port}` });
    conn.ws = ws;
    this.emit('status', key, 'connecting');

    let id = 1;
    const send = (method: string) => ws.send(JSON.stringify({ id: id++, method }));
    const NETWORK_ENABLE_ID = 3;
    const pendingBody = new Map<number, string>();
    const fetchBody = (requestId: string) => {
      const c = conn!.cmdSeq++;
      pendingBody.set(c, requestId);
      ws.send(JSON.stringify({ id: c, method: 'Network.getResponseBody', params: { requestId } }));
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
      if (msg.id && pendingBody.has(msg.id)) {
        const reqId = pendingBody.get(msg.id)!;
        pendingBody.delete(msg.id);
        const rec = conn!.netRecords.get(reqId);
        if (rec && msg.result) {
          rec.resBody = msg.result.base64Encoded
            ? Buffer.from(msg.result.body ?? '', 'base64').toString('utf8')
            : msg.result.body;
          this.emit('net', key, rec);
        }
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
      const rec: NetRecord = { id: p.requestId, method: r.method ?? 'GET', url: r.url ?? '', reqHeaders: r.headers, reqBody: r.postData };
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
      if (conn.netRecords.has(p.requestId)) fetchBody(p.requestId);
    }
  }
}
