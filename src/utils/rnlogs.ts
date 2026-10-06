import chalk from 'chalk';
import WebSocket from 'ws';
import { selectWithExit } from './prompt.js';

interface RnTarget {
  webSocketDebuggerUrl?: string;
  title?: string;
  description?: string;
  deviceName?: string;
}

function targetLabel(t: RnTarget): string {
  const title = t.title || t.description || 'app';
  return t.deviceName ? `${title}  ${chalk.gray(t.deviceName)}` : title;
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

function colorForLevel(level: string): (s: string) => string {
  switch (level) {
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

function handleCdp(msg: { method?: string; params?: any }): void {
  switch (msg.method) {
    case 'Runtime.consoleAPICalled': {
      const { type = 'log', args = [] } = msg.params ?? {};
      const text = (args as RemoteObject[]).map(renderArg).join(' ');
      console.log(colorForLevel(type)(text));
      break;
    }
    case 'Log.entryAdded': {
      const entry = msg.params?.entry ?? {};
      console.log(colorForLevel(entry.level ?? 'log')(entry.text ?? ''));
      break;
    }
    case 'Runtime.exceptionThrown': {
      const d = msg.params?.exceptionDetails ?? {};
      const text = d.exception?.description ?? d.text ?? 'Uncaught exception';
      console.log(chalk.red(text));
      break;
    }
    case 'Network.requestWillBeSent': {
      const r = msg.params?.request ?? {};
      console.log(chalk.gray(`→ ${r.method ?? 'GET'} ${r.url ?? ''}`));
      break;
    }
    case 'Network.responseReceived': {
      const r = msg.params?.response ?? {};
      const status = r.status ?? '';
      const color = typeof status === 'number' && status >= 400 ? chalk.red : chalk.gray;
      console.log(color(`← ${status} ${r.url ?? ''}`));
      break;
    }
  }
}

export async function streamReactNativeLogs(port: number, nameFilter?: string): Promise<void> {
  const base = `http://localhost:${port}`;
  let targets: RnTarget[];
  try {
    const res = await fetch(`${base}/json`);
    if (!res.ok) throw new Error(`Metro responded ${res.status}`);
    targets = (await res.json()) as RnTarget[];
  } catch (e) {
    throw new Error(
      `Could not reach Metro at ${base} — is the dev server running? ` +
        `Start it with your app's \`npm start\` / \`npx react-native start\`.`,
    );
  }

  let debuggable = targets.filter(t => t.webSocketDebuggerUrl);
  if (nameFilter) {
    const n = nameFilter.toLowerCase();
    const matched = debuggable.filter(
      t => (t.deviceName ?? '').toLowerCase().includes(n) || (t.title ?? '').toLowerCase().includes(n),
    );
    if (matched.length) debuggable = matched;
  }

  if (debuggable.length === 0) {
    throw new Error('No debuggable React Native target found — is the app running in dev mode and connected to Metro?');
  }

  // Multiple devices/simulators on one Metro → let the user pick (auto if one).
  const target =
    debuggable.length === 1
      ? debuggable[0]
      : await selectWithExit(
          'Select a React Native target:',
          debuggable.map(t => ({ name: targetLabel(t), value: t })),
        );

  // Metro's inspector proxy requires a localhost Origin header on the upgrade
  // request — the `ws` client lets us set it (the global WebSocket can't).
  const ws = new WebSocket(target.webSocketDebuggerUrl!, { origin: base });
  let id = 1;
  const send = (method: string, params?: object) => ws.send(JSON.stringify({ id: id++, method, params }));

  ws.on('open', () => {
    send('Runtime.enable');
    send('Log.enable');
    send('Network.enable');
    const who = target.title ?? target.deviceName ?? 'app';
    console.log(
      chalk.cyan(`Connected to Metro (${who}) — streaming console + network`) + chalk.gray('  (Ctrl+C to stop)\n'),
    );
  });

  ws.on('message', data => {
    try {
      handleCdp(JSON.parse(data.toString()));
    } catch {
      /* ignore non-JSON frames */
    }
  });

  ws.on('error', err => {
    console.error(chalk.red(`Lost connection to Metro: ${err.message}`));
    process.exit(1);
  });
  ws.on('close', () => process.exit(0));

  process.once('SIGINT', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}
