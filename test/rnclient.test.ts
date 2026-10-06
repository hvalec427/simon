import { describe, it, expect } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { RnClient } from '../src/utils/rnclient';

interface FakeMetro {
  port: number;
  connections: number;
  sockets: WebSocket[];
  onConnect(cb: (ws: WebSocket) => void): void;
  close(): Promise<void>;
}

async function startFakeMetro(): Promise<FakeMetro> {
  const sockets: WebSocket[] = [];
  let connectCb: ((ws: WebSocket) => void) | undefined;
  const fake: Partial<FakeMetro> = { connections: 0, sockets };

  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      const port = (server.address() as AddressInfo).port;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify([
          { title: 'App', deviceName: 'iPhone', webSocketDebuggerUrl: `ws://localhost:${port}/inspector` },
        ]),
      );
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  const wss = new WebSocketServer({ server, path: '/inspector' });
  wss.on('connection', ws => {
    fake.connections = (fake.connections ?? 0) + 1;
    sockets.push(ws);
    connectCb?.(ws);
  });

  await new Promise<void>(resolve => server.listen(0, resolve));

  return {
    port: (server.address() as AddressInfo).port,
    get connections() {
      return fake.connections ?? 0;
    },
    sockets,
    onConnect(cb) {
      connectCb = cb;
    },
    close() {
      return new Promise<void>(resolve => {
        wss.close();
        server.close(() => resolve());
      });
    },
  };
}

function waitFor<T>(fn: () => T | undefined | false, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v !== undefined && v !== false) {
        clearInterval(iv);
        resolve(v as T);
      } else if (Date.now() - start > timeout) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 10);
  });
}

describe('RnClient against a fake Metro inspector', () => {
  it('parses console events over CDP', async () => {
    const metro = await startFakeMetro();
    const client = new RnClient(metro.port, 50);
    const logs: { text: string }[] = [];
    client.on('log', (_key: string, e: { text: string }) => logs.push(e));
    metro.onConnect(ws => {
      ws.send(JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ value: 'hi from app' }] } }));
    });

    client.start();
    const entry = await waitFor(() => logs[0]);
    expect(entry.text).toBe('hi from app');

    client.stop();
    await metro.close();
  });

  it('auto-reconnects (via polling) when the socket drops', async () => {
    const metro = await startFakeMetro();
    const client = new RnClient(metro.port, 50);
    client.start();

    await waitFor(() => metro.connections >= 1);
    metro.sockets[0].close(); // simulate the app dying
    await waitFor(() => metro.connections >= 2, 4000);
    expect(metro.connections).toBeGreaterThanOrEqual(2);

    client.stop();
    await metro.close();
  });
});
