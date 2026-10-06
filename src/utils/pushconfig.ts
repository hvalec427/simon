import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

export interface FcmConfig {
  serviceAccount: string;
}

export interface ApnsConfig {
  keyFile: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  env?: 'sandbox' | 'production';
}

export interface PushConfig {
  transport?: 'fcm' | 'apns';
  fcm?: FcmConfig;
  apns?: ApnsConfig;
}

export type Transport = 'fcm' | 'apns';

export function pushConfigPath(): string {
  return path.join(homedir(), '.config', 'simon', 'push.json');
}

export function loadPushConfig(): PushConfig | null {
  const p = pushConfigPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PushConfig;
  } catch {
    throw new Error(`Could not parse ${p} — is it valid JSON?`);
  }
}

// Pick the transport from an explicit override, else the config's default, else
// whichever block is present. Throws a clear error when it can't decide.
export function resolveTransport(cfg: PushConfig, override?: Transport): Transport {
  const want = override ?? cfg.transport;
  if (want === 'fcm') {
    if (!cfg.fcm) throw new Error('FCM selected but there is no "fcm" block in push.json.');
    return 'fcm';
  }
  if (want === 'apns') {
    if (!cfg.apns) throw new Error('APNs selected but there is no "apns" block in push.json.');
    return 'apns';
  }
  if (cfg.fcm && cfg.apns) {
    throw new Error('Both fcm and apns are configured — choose with --fcm or --apns, or set "transport" in push.json.');
  }
  if (cfg.fcm) return 'fcm';
  if (cfg.apns) return 'apns';
  throw new Error('push.json has neither an "fcm" nor an "apns" block.');
}

// Expand a leading ~ and resolve relative paths (credentials may be referenced
// either way in the config).
export function expandPath(p: string): string {
  const expanded = p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
  return path.resolve(expanded);
}
