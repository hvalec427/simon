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

interface RemoteObject {
  type?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
}

function renderArg(a: RemoteObject): string {
  if (a == null) return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
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
export class RnClient extends EventEmitter {
  private ws?: WebSocket;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private port: number, private nameFilter?: string) {
    super();
  }

  start(): void {
    this.connect();
  }

  reconnectNow(): void {
    this.teardown();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
  }

  private teardown(): void {
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

  private retryLater(): void {
    if (this.stopped) return;
    this.emit('status', 'disconnected');
    this.timer = setTimeout(() => this.connect(), 2000);
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

    let list = targets.filter(t => t.webSocketDebuggerUrl);
    if (this.nameFilter) {
      const n = this.nameFilter.toLowerCase();
      const matched = list.filter(
        t => (t.deviceName ?? '').toLowerCase().includes(n) || (t.title ?? '').toLowerCase().includes(n),
      );
      if (matched.length) list = matched;
    }
    const target = list[0];
    if (!target?.webSocketDebuggerUrl) {
      this.retryLater();
      return;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl, { origin: `http://localhost:${this.port}` });
    this.ws = ws;
    let id = 1;
    const send = (method: string) => ws.send(JSON.stringify({ id: id++, method }));
    const NETWORK_ENABLE_ID = 3;

    ws.on('open', () => {
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
      const entry = toEntry(msg);
      if (entry) this.emit('log', entry);
    });
    ws.on('close', () => {
      if (!this.stopped) this.retryLater();
    });
    ws.on('error', () => {
      /* 'close' fires next and triggers the retry */
    });
  }
}
