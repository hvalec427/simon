import { describe, it, expect } from 'vitest';
import { resolveTransport } from '../src/utils/pushconfig';
import { base64url } from '../src/utils/jwt';

describe('resolveTransport', () => {
  it('uses the only configured block', () => {
    expect(resolveTransport({ fcm: { serviceAccount: 'x' } })).toBe('fcm');
    expect(resolveTransport({ apns: { keyFile: 'x', keyId: 'k', teamId: 't', bundleId: 'b' } })).toBe('apns');
  });

  it('honors an explicit override', () => {
    const cfg = { fcm: { serviceAccount: 'x' }, apns: { keyFile: 'x', keyId: 'k', teamId: 't', bundleId: 'b' } };
    expect(resolveTransport(cfg, 'apns')).toBe('apns');
    expect(resolveTransport(cfg, 'fcm')).toBe('fcm');
  });

  it('falls back to the config default when both are present', () => {
    const cfg = {
      transport: 'apns' as const,
      fcm: { serviceAccount: 'x' },
      apns: { keyFile: 'x', keyId: 'k', teamId: 't', bundleId: 'b' },
    };
    expect(resolveTransport(cfg)).toBe('apns');
  });

  it('throws when an override has no matching block', () => {
    expect(() => resolveTransport({ fcm: { serviceAccount: 'x' } }, 'apns')).toThrow();
  });

  it('throws when both are configured and nothing selects one', () => {
    expect(() =>
      resolveTransport({ fcm: { serviceAccount: 'x' }, apns: { keyFile: 'x', keyId: 'k', teamId: 't', bundleId: 'b' } }),
    ).toThrow();
  });

  it('throws when neither block exists', () => {
    expect(() => resolveTransport({})).toThrow();
  });
});

describe('base64url', () => {
  it('encodes without padding or url-unsafe chars', () => {
    expect(base64url('subjects?_test')).toBe('c3ViamVjdHM_X3Rlc3Q');
    expect(base64url('{"alg":"ES256"}')).not.toMatch(/[+/=]/);
  });
});
