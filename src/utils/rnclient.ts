import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface LogEntry {
  kind: 'console' | 'network' | 'system';
  level: string;
  text: string;
}

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
  // Objects/arrays aren't serialized by value over CDP — use the preview.
  if (a.preview) return previewToString(a.preview);
  if (a.description) return a.description;
  if (a.unserializableValue) return a.unserializableValue;
  return a.type ?? '';
}

// Map a CDP message to a log entry, or null if it's not something we render.
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
    case 'Network.requestWillBeSent': {
      const r = msg.params?.request ?? {};
      return { kind: 'network', level: 'request', text: `→ ${r.method ?? 'GET'} ${r.url ?? ''}` };
    }
    case 'Network.responseReceived': {
      const r = msg.params?.response ?? {};
      const status = r.status;
      return {
        kind: 'network',
        level: typeof status === 'number' && status >= 400 ? 'error' : 'response',
        text: `← ${status ?? ''} ${r.url ?? ''}`,
      };
    }
    default:
      return null;
  }
}

export type Status = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Connects to Metro's inspector (CDP) and emits log entries. Auto-reconnects when
 * the app closes/crashes by re-resolving the target and dialing back in.
 *   'log'     → (LogEntry)
 *   'status'  → (Status, who?)
 *   'network' → (boolean)  whether the Network domain is supported
 */
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

export class RnClient extends EventEmitter {
  private ws?: WebSocket;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private targets: TargetInfo[] = [];
  private selectedKey?: string;
  private netRecords = new Map<string, NetRecord>();
  private cmdSeq = 1000;
  private connected = false;

  constructor(private port: number, private nameFilter?: string, private retryMs = 2000) {
    super();
  }

  // Switch to the target at `index` from the last published target list.
  select(index: number): void {
    const t = this.targets[index];
    if (!t) return;
    this.selectedKey = t.key;
    this.netRecords.clear();
    this.reconnectNow(true);
  }

  // Clear persists across reconnects only if the device forgets its console
  // history — otherwise Hermes replays it on the next Runtime.enable.
  discardConsole(): void {
    this.netRecords.clear();
    if (!this.ws) return;
    try {
      this.ws.send(JSON.stringify({ id: this.cmdSeq++, method: 'Runtime.discardConsoleEntries' }));
      this.ws.send(JSON.stringify({ id: this.cmdSeq++, method: 'Log.clear' }));
    } catch {
      /* ignore */
    }
  }

  // Ask the app to reload (like the "r" in React Native DevTools). Best-effort:
  // sends whichever reload the connected target understands.
  reloadApp(): void {
    if (!this.ws) return;
    try {
      this.ws.send(JSON.stringify({ id: this.cmdSeq++, method: 'Page.reload' }));
      this.ws.send(JSON.stringify({ id: this.cmdSeq++, method: 'ReactNativeApplication.reload' }));
    } catch {
      /* ignore */
    }
  }

  start(): void {
    this.connect();
  }

  // `force` reconnects even when already connected (used for device switches);
  // the manual reconnect key is a no-op while the connection is live.
  reconnectNow(force = false): void {
    if (this.connected && !force) return;
    this.teardown();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
  }

  private teardown(): void {
    this.connected = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = undefined;
    }
  }

  private handleNetwork(msg: { method?: string; params?: any }, fetchBody: (id: string) => void): void {
    const p = msg.params ?? {};
    if (msg.method === 'Network.requestWillBeSent') {
      const r = p.request ?? {};
      const rec: NetRecord = {
        id: p.requestId,
        method: r.method ?? 'GET',
        url: r.url ?? '',
        reqHeaders: r.headers,
        reqBody: r.postData,
      };
      this.netRecords.set(p.requestId, rec);
      this.emit('net', rec);
    } else if (msg.method === 'Network.responseReceived') {
      const rec = this.netRecords.get(p.requestId);
      if (rec) {
        const res = p.response ?? {};
        rec.status = res.status;
        rec.resHeaders = res.headers;
        rec.mimeType = res.mimeType;
        this.emit('net', rec);
      }
    } else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
      if (this.netRecords.has(p.requestId)) fetchBody(p.requestId);
    }
  }

  private retryLater(): void {
    if (this.stopped) return;
    this.emit('status', 'disconnected');
    this.timer = setTimeout(() => this.connect(), this.retryMs);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.emit('status', 'connecting');

    let targets: RnTarget[];
    try {
      const res = await fetch(`http://localhost:${this.port}/json`);
      if (!res.ok) throw new Error();
      targets = (await res.json()) as RnTarget[];
    } catch {
      this.retryLater();
      return;
    }

    const all = targets.filter(t => t.webSocketDebuggerUrl);
    const keyOf = (t: RnTarget) => t.deviceName || t.title || 'app';
    this.targets = all.map(t => ({ key: keyOf(t), label: keyOf(t) }));
    this.emit('targets', this.targets);

    let list = all;
    if (this.nameFilter) {
      const n = this.nameFilter.toLowerCase();
      const matched = list.filter(
        t => (t.deviceName ?? '').toLowerCase().includes(n) || (t.title ?? '').toLowerCase().includes(n),
      );
      if (matched.length) list = matched;
    }
    // Prefer an explicitly selected device (by key) across reconnects.
    const target = (this.selectedKey && all.find(t => keyOf(t) === this.selectedKey)) || list[0];
    if (!target?.webSocketDebuggerUrl) {
      this.retryLater();
      return;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl, { origin: `http://localhost:${this.port}` });
    this.ws = ws;
    let id = 1;
    const send = (method: string) => ws.send(JSON.stringify({ id: id++, method }));
    const NETWORK_ENABLE_ID = 3;

    // Response bodies are fetched on demand; map our getResponseBody call id → requestId.
    const pendingBody = new Map<number, string>();
    let cmdId = 100;
    const fetchBody = (requestId: string) => {
      const c = cmdId++;
      pendingBody.set(c, requestId);
      ws.send(JSON.stringify({ id: c, method: 'Network.getResponseBody', params: { requestId } }));
    };

    ws.on('open', () => {
      this.connected = true;
      send('Runtime.enable');
      send('Log.enable');
      send('Network.enable');
      this.emit('status', 'connected', target.title ?? target.deviceName ?? 'app');
    });
    ws.on('message', data => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.id === NETWORK_ENABLE_ID) {
        this.emit('network', !msg.error);
        return;
      }
      if (msg.id && pendingBody.has(msg.id)) {
        const reqId = pendingBody.get(msg.id)!;
        pendingBody.delete(msg.id);
        const rec = this.netRecords.get(reqId);
        if (rec && msg.result) {
          rec.resBody = msg.result.base64Encoded
            ? Buffer.from(msg.result.body ?? '', 'base64').toString('utf8')
            : msg.result.body;
          this.emit('net', rec);
        }
        return;
      }
      // Fast refresh / reload resets the JS context — treat as a reload.
      if (msg.method === 'Runtime.executionContextsCleared') {
        this.netRecords.clear();
        this.emit('contextcleared');
        return;
      }
      if (typeof msg.method === 'string' && msg.method.startsWith('Network.')) {
        this.handleNetwork(msg, fetchBody);
        return;
      }
      const entry = toEntry(msg);
      if (entry) this.emit('log', entry);
    });
    ws.on('close', () => {
      this.connected = false;
      if (!this.stopped) this.retryLater();
    });
    ws.on('error', () => {
      /* 'close' fires next and triggers the retry */
    });
  }
}
