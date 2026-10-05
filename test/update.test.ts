import { describe, it, expect } from 'vitest';
import { compareVersions } from '../src/utils/update';

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
