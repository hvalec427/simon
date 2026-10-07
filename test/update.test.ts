import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execSync } from 'child_process';
import {
  changelogSince,
  compareVersions,
  fetchReleaseNotes,
  installTarget,
  latestForChannel,
  needsSudo,
} from '../src/utils/update';

vi.mock('child_process', () => ({ execSync: vi.fn(() => '') }));

afterEach(() => vi.unstubAllGlobals());

describe('compareVersions', () => {
  it('returns 1 when the first version is newer', () => {
    expect(compareVersions('2.1.0', '2.0.0')).toBe(1);
    expect(compareVersions('2.0.1', '2.0.0')).toBe(1);
    expect(compareVersions('3.0.0', '2.9.9')).toBe(1);
  });

  it('returns -1 when the first version is older', () => {
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.1')).toBe(-1);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('orders nightly prereleases by their number', () => {
    expect(compareVersions('2.13.0-nightly.12', '2.13.0-nightly.9')).toBe(1);
    expect(compareVersions('2.13.0-nightly.9', '2.13.0-nightly.12')).toBe(-1);
    expect(compareVersions('2.13.0-nightly.5', '2.13.0-nightly.5')).toBe(0);
  });

  it('ranks a stable release above its nightlies', () => {
    expect(compareVersions('2.13.0', '2.13.0-nightly.12')).toBe(1);
  });

  it('orders timestamp-based nightlies correctly', () => {
    expect(compareVersions('2.15.0-nightly.20261006120500', '2.15.0-nightly.20261006115900')).toBe(1);
    expect(compareVersions('2.15.0-nightly.20261006120500', '2.14.0')).toBe(1); // nightly ahead of stable base
  });

  it('orders dev prereleases by their build timestamp', () => {
    expect(compareVersions('2.17.0-dev.20261007120500', '2.17.0-dev.20261007115900')).toBe(1);
    expect(compareVersions('2.17.0-dev.20261007120500', '2.17.0')).toBe(-1); // dev is a prerelease of 2.17.0
  });
});

describe('latestForChannel', () => {
  it('stable uses the latest non-prerelease', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: 'v2.1.0' }) })));
    expect(await latestForChannel('stable')).toEqual({ version: '2.1.0', tag: 'v2.1.0' });
  });

  it('nightly picks the highest prerelease regardless of list order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          // deliberately out of order, like GitHub's real /releases response
          { tag_name: 'v2.2.0-nightly.9', prerelease: true },
          { tag_name: 'v2.2.0', prerelease: false },
          { tag_name: 'v2.2.0-nightly.12', prerelease: true },
          { tag_name: 'v2.2.0-nightly.10', prerelease: true },
        ],
      })),
    );
    expect(await latestForChannel('nightly')).toEqual({ version: '2.2.0-nightly.12', tag: 'v2.2.0-nightly.12' });
  });

  it('throws when no nightly exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ tag_name: 'v2.2.0', prerelease: false }] })));
    await expect(latestForChannel('nightly')).rejects.toThrow();
  });

  it('dev reads the version from the rolling release title', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ name: '2.17.0-dev.20261007120500', tag_name: 'dev' }) })));
    expect(await latestForChannel('dev')).toEqual({ version: '2.17.0-dev.20261007120500', tag: 'dev' });
  });

  it('dev throws when no dev build exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(latestForChannel('dev')).rejects.toThrow();
  });
});

describe('changelogSince', () => {
  const list = [
    { tag_name: 'v2.2.0-nightly.3', prerelease: true, body: 'n3 notes\n### Install this build\n```sh\ncurl\n```' },
    { tag_name: 'v2.2.0', prerelease: false, body: 'stable two-two notes' },
    { tag_name: 'v2.2.0-nightly.2', prerelease: true, body: 'n2 notes' },
    { tag_name: 'v2.2.0-nightly.1', prerelease: true, body: 'n1 notes' },
  ];
  const stub = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));

  it('aggregates channel releases newer than current, newest first, stripping install', async () => {
    stub();
    const out = (await changelogSince('nightly', '2.2.0-nightly.1')) ?? '';
    expect(out).toContain('## v2.2.0-nightly.3');
    expect(out).toContain('## v2.2.0-nightly.2');
    expect(out).not.toContain('nightly.1'); // current itself excluded
    expect(out).not.toContain('stable two-two'); // other channel excluded
    expect(out).not.toContain('Install this build'); // stripped
    expect(out.indexOf('nightly.3')).toBeLessThan(out.indexOf('nightly.2')); // newest first
  });

  it('stable channel ignores prereleases', async () => {
    stub();
    const out = (await changelogSince('stable', '2.1.0')) ?? '';
    expect(out).toContain('## v2.2.0');
    expect(out).not.toContain('nightly');
  });

  it('unknown current → just the latest release', async () => {
    stub();
    const out = (await changelogSince('nightly', 'unknown')) ?? '';
    expect(out).toContain('## v2.2.0-nightly.3');
    expect(out).not.toContain('nightly.2');
  });

  it('returns undefined when nothing is newer', async () => {
    stub();
    expect(await changelogSince('nightly', '2.2.0-nightly.3')).toBeUndefined();
  });
});

describe('fetchReleaseNotes', () => {
  it('returns the body with the "Install this build" section stripped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ body: '### Features\n- a thing\n\n### Install this build\n```sh\ncurl ...\n```\n' }),
      })),
    );
    expect(await fetchReleaseNotes('v1.0.0')).toBe('### Features\n- a thing');
  });

  it('returns undefined when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await fetchReleaseNotes('v1.0.0')).toBeUndefined();
  });
});

describe('needsSudo', () => {
  it('is false when the target directory is writable', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'simon-'));
    expect(needsSudo(path.join(dir, 'simon'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is true when the directory is missing or not writable', () => {
    expect(needsSudo('/no/such/dir/simon')).toBe(true);
  });
});

describe('installTarget', () => {
  const orig = process.execPath;
  afterEach(() => {
    process.execPath = orig;
  });

  it('targets the running simon binary, resolving symlinks', () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'simon-')));
    const bin = path.join(dir, 'simon');
    writeFileSync(bin, '#!/bin/sh\n');
    process.execPath = bin;
    expect(installTarget()).toBe(bin);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the exec path when it cannot be resolved', () => {
    process.execPath = '/nope/simon';
    expect(installTarget()).toBe('/nope/simon');
  });

  it('falls back to the default path under node with no simon on PATH', () => {
    (execSync as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    process.execPath = '/usr/bin/node';
    expect(installTarget()).toBe('/usr/local/bin/simon');
  });
});
