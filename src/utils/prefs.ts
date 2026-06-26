import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

interface Prefs {
  ios?: string;   // udid
  android?: string; // avd name
}

function prefsPath(): string {
  return path.join(homedir(), '.config', 'simon', 'prefs.json');
}

export function loadPrefs(): Prefs {
  const p = prefsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Prefs;
  } catch {
    return {};
  }
}

export function savePrefs(prefs: Prefs): void {
  const p = prefsPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(prefs, null, 2));
}

export function setIosPref(udid: string): void {
  savePrefs({ ...loadPrefs(), ios: udid });
}

export function setAndroidPref(name: string): void {
  savePrefs({ ...loadPrefs(), android: name });
}
