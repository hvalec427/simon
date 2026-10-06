import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { compareVersions, fetchReleaseNotes, installTarget, latestForChannel, needsSudo } from '../src/utils/update';

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
