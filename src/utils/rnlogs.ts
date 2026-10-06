import chalk from 'chalk';

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

export async function streamReactNativeLogs(port: number): Promise<void> {
  if (typeof WebSocket === 'undefined') {
    throw new Error('This build of Node has no WebSocket support — update simon (or Node ≥ 22.4).');
  }

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

  const target = targets.find(t => t.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('No debuggable React Native target found — is the app running in dev mode and connected to Metro?');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 1;
  const send = (method: string, params?: object) => ws.send(JSON.stringify({ id: id++, method, params }));

  ws.addEventListener('open', () => {
    send('Runtime.enable');
    send('Log.enable');
    send('Network.enable');
    const who = target.title ?? target.deviceName ?? 'app';
    console.log(
      chalk.cyan(`Connected to Metro (${who}) — streaming console + network`) + chalk.gray('  (Ctrl+C to stop)\n'),
    );
  });

  ws.addEventListener('message', ev => {
    try {
      handleCdp(JSON.parse(String((ev as MessageEvent).data)));
    } catch {
      /* ignore non-JSON frames */
    }
  });

  ws.addEventListener('error', () => {
    console.error(chalk.red('Lost connection to Metro.'));
    process.exit(1);
  });
  ws.addEventListener('close', () => process.exit(0));

  process.once('SIGINT', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}
