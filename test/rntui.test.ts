import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
import { filterEntries, highlight } from '../src/commands/rntui';
import { toEntry } from '../src/utils/rnclient';
import type { LogEntry } from '../src/utils/rnclient';

chalk.level = 3; // force color output so highlight emits ANSI in the test env

const entries: LogEntry[] = [
  { kind: 'console', level: 'log', text: 'user tapped order 47e8' },
  { kind: 'network', level: 'request', text: '→ POST https://api/orders' },
  { kind: 'console', level: 'error', text: 'network timeout' },
];

describe('filterEntries', () => {
  it('hides network entries when network is off', () => {
    const r = filterEntries(entries, '', false);
    expect(r).toHaveLength(2);
    expect(r.every(e => e.kind !== 'network')).toBe(true);
  });

  it('filters by substring (case-insensitive) across kinds', () => {
    expect(filterEntries(entries, '47E8', true)).toHaveLength(1);
    expect(filterEntries(entries, 'order', true)).toHaveLength(2); // "order 47e8" + "orders" in the URL
    // "network" matches the console line's text, not the network kind
    expect(filterEntries(entries, 'network', true)).toHaveLength(1);
  });

  it('returns everything with no filter and network on', () => {
    expect(filterEntries(entries, '', true)).toHaveLength(3);
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
