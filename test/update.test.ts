import { describe, it, expect, vi, afterEach } from 'vitest';
import { compareVersions, latestForChannel } from '../src/utils/update';

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

  it('treats missing components as zero', () => {
    expect(compareVersions('2', '2.0.0')).toBe(0);
    expect(compareVersions('2.1', '2.0.9')).toBe(1);
  });
});

describe('latestForChannel', () => {
  it('stable uses the latest non-prerelease', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: 'v2.1.0' }) })));
    expect(await latestForChannel('stable')).toEqual({ version: '2.1.0', tag: 'v2.1.0' });
  });

  it('nightly picks the first prerelease in the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { tag_name: 'v2.2.0', prerelease: false },
          { tag_name: 'v2.2.0-nightly.3', prerelease: true },
          { tag_name: 'v2.2.0-nightly.2', prerelease: true },
        ],
      })),
    );
    expect(await latestForChannel('nightly')).toEqual({ version: '2.2.0-nightly.3', tag: 'v2.2.0-nightly.3' });
  });

  it('throws when no nightly exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ tag_name: 'v2.2.0', prerelease: false }] })));
    await expect(latestForChannel('nightly')).rejects.toThrow();
  });
});
