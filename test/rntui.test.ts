import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
import {
  FrameState,
  filterEntries,
  filterRecords,
  frameHeight,
  highlight,
  netDetailLines,
  netSummary,
  renderFrame,
} from '../src/commands/rntui';
import { toEntry } from '../src/utils/rnclient';
import type { LogEntry, NetRecord } from '../src/utils/rnclient';

chalk.level = 3; // force color output so highlight emits ANSI in the test env

const entries: LogEntry[] = [
  { kind: 'console', level: 'log', text: 'user tapped order 47e8' },
  { kind: 'network', level: 'request', text: '→ POST https://api/orders' },
  { kind: 'console', level: 'error', text: 'network timeout' },
];

describe('filterEntries', () => {
  it('filters by substring (case-insensitive)', () => {
    expect(filterEntries(entries, '47E8')).toHaveLength(1);
    expect(filterEntries(entries, 'order')).toHaveLength(2); // "order 47e8" + "orders" in the URL
    expect(filterEntries(entries, 'network')).toHaveLength(1);
  });

  it('returns everything with no filter', () => {
    expect(filterEntries(entries, '')).toHaveLength(3);
  });
});

describe('highlight', () => {
  it('wraps matches and is case-insensitive', () => {
    const out = highlight('Order 47 order', 'order');
    expect(out).toContain('\x1b['); // contains ANSI from chalk.inverse
    expect(out).toContain('47');
  });

  it('returns the text unchanged with no term', () => {
    expect(highlight('plain', '')).toBe('plain');
  });
});

describe('toEntry', () => {
  it('maps console calls', () => {
    const e = toEntry({ method: 'Runtime.consoleAPICalled', params: { type: 'warn', args: [{ value: 'hi' }] } });
    expect(e).toEqual({ kind: 'console', level: 'warn', text: 'hi' });
  });

  it('maps network responses, flagging 4xx+ as error', () => {
    const e = toEntry({ method: 'Network.responseReceived', params: { response: { status: 500, url: 'u' } } });
    expect(e?.kind).toBe('network');
    expect(e?.level).toBe('error');
  });

  it('ignores unrelated methods', () => {
    expect(toEntry({ method: 'Debugger.paused' })).toBeNull();
  });
});

function frame(partial: Partial<FrameState>): string {
  return renderFrame({
    cols: 80,
    rows: 12,
    tab: 'logs',
    buffers: { logs: [], network: [] },
    netRecords: [],
    netSel: 0,
    detail: false,
    detailScroll: 0,
    scroll: 0,
    follow: true,
    filter: '',
    search: '',
    mode: 'normal',
    input: '',
    clearOnRestart: false,
    status: 'connected',
    who: 'iPhone',
    networkSupported: true,
    targets: [],
    ...partial,
  });
}

describe('frameHeight', () => {
  it('reserves header + footer, and a device-bar row when present', () => {
    expect(frameHeight(24, false)).toBe(22);
    expect(frameHeight(24, true)).toBe(21);
    expect(frameHeight(2, false)).toBe(1); // clamped to at least 1
  });
});

describe('renderFrame', () => {
  it('renders header, tab counts and log text', () => {
    const f = frame({ buffers: { logs: [{ kind: 'console', level: 'log', text: 'hello world' }], network: [] } });
    expect(f).toContain('Logs (1)');
    expect(f).toContain('Network (0)');
    expect(f).toContain('iPhone');
    expect(f).toContain('connected');
    expect(f).toContain('keeps logs on app restart');
    expect(f).toContain('hello world');
  });

  it('applies the active filter to the view', () => {
    const f = frame({
      filter: 'keep',
      buffers: {
        logs: [
          { kind: 'console', level: 'log', text: 'keep me' },
          { kind: 'console', level: 'log', text: 'drop me' },
        ],
        network: [],
      },
    });
    expect(f).toContain('keep me');
    expect(f).not.toContain('drop me');
    expect(f).toContain('filter:"keep"');
  });

  it('describes clear-on-restart when toggled', () => {
    expect(frame({ clearOnRestart: true })).toContain('clears logs on app restart');
  });

  it('notes when network is unsupported on the network tab', () => {
    expect(frame({ tab: 'network', networkSupported: false })).toContain('isn’t exposed');
  });

  it('shows a device bar and hint when multiple targets exist', () => {
    const f = frame({ targets: [{ key: 'iPhone', label: 'iPhone' }, { key: 'Pixel', label: 'Pixel' }] });
    expect(f).toContain('Devices:');
    expect(f).toContain('1:iPhone');
    expect(f).toContain('2:Pixel');
    expect(f).toContain('1-9 device');
  });

  it('lists network records on the network tab', () => {
    const f = frame({
      tab: 'network',
      netRecords: [{ id: '1', method: 'POST', url: 'https://api/x', status: 200 }],
    });
    expect(f).toContain('200');
    expect(f).toContain('POST https://api/x');
    expect(f).toContain('enter details');
  });

  it('renders a request detail view', () => {
    const rec: NetRecord = {
      id: '1',
      method: 'POST',
      url: 'https://api/x',
      status: 201,
      reqHeaders: { 'content-type': 'application/json' },
      reqBody: '{"a":1}',
      resBody: '{"ok":true}',
    };
    const f = frame({ tab: 'network', detail: true, rows: 40, netRecords: [rec] });
    expect(f).toContain('Request headers');
    expect(f).toContain('content-type: application/json');
    expect(f).toContain('Response body');
    expect(f).toContain('esc back');
  });
});

const sampleRec: NetRecord = { id: '1', method: 'GET', url: 'https://api/orders', status: 404 };

describe('netSummary', () => {
  it('formats status, method and url, flagging 4xx+', () => {
    const s = netSummary(sampleRec);
    expect(s.text).toContain('404');
    expect(s.text).toContain('GET https://api/orders');
    expect(s.error).toBe(true);
  });
  it('marks pending when there is no status yet', () => {
    expect(netSummary({ id: '2', method: 'GET', url: 'u' }).pending).toBe(true);
  });
});

describe('filterRecords', () => {
  it('filters by method/url substring', () => {
    const recs: NetRecord[] = [sampleRec, { id: '2', method: 'POST', url: 'https://api/login' }];
    expect(filterRecords(recs, 'login')).toHaveLength(1);
    expect(filterRecords(recs, 'GET')).toHaveLength(1);
    expect(filterRecords(recs, '')).toHaveLength(2);
  });
});

describe('netDetailLines', () => {
  it('pretty-prints JSON bodies and notes missing data', () => {
    const lines = netDetailLines({ id: '1', method: 'POST', url: 'u', reqBody: '{"a":1}' }).join('\n');
    expect(lines).toContain('"a": 1'); // pretty-printed
    expect(lines).toContain('(not captured)'); // response body absent
  });
});
