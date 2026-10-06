import { execSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const REPO = 'hvalec427/simon';
const INSTALL_PATH = '/usr/local/bin/simon';

export type Channel = 'stable' | 'nightly';

const GH_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'simon-cli' };

export function currentVersion(): string {
  return process.env.npm_package_version ?? 'unknown';
}

function channelConfigPath(): string {
  return path.join(homedir(), '.config', 'simon', 'update.json');
}

export function loadChannel(): Channel {
  try {
    const data = JSON.parse(readFileSync(channelConfigPath(), 'utf8')) as { channel?: Channel };
    return data.channel === 'nightly' ? 'nightly' : 'stable';
  } catch {
    return 'stable';
  }
}

export function saveChannel(channel: Channel): void {
  const p = channelConfigPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ channel }, null, 2));
}

interface Release {
  tag_name: string;
  prerelease: boolean;
}

// Stable = GitHub's "latest" (excludes prereleases). Nightly = newest prerelease.
export async function latestForChannel(channel: Channel): Promise<{ version: string; tag: string }> {
  if (channel === 'stable') {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: GH_HEADERS });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { tag_name?: string };
    if (!data.tag_name) throw new Error('Could not read the latest release tag.');
    return { version: data.tag_name.replace(/^v/, ''), tag: data.tag_name };
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: GH_HEADERS });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
  const releases = (await res.json()) as Release[];
  // GitHub's /releases list is NOT reliably newest-first, so pick the highest
  // version rather than the first prerelease in the list.
  const nightly = releases
    .filter(r => r.prerelease)
    .sort((a, b) => compareVersions(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, '')))[0];
  if (!nightly) throw new Error('No nightly (prerelease) build found yet.');
  return { version: nightly.tag_name.replace(/^v/, ''), tag: nightly.tag_name };
}

// Compare versions incl. `-nightly.N` prereleases: 1 if a > b, -1 if a < b, else 0.
// A stable X.Y.Z outranks any X.Y.Z-nightly.N.
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$/);
    if (!m) return [0, 0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Number.MAX_SAFE_INTEGER : Number(m[4])];
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function assetName(): string {
  return process.arch === 'arm64' ? 'simon-darwin-arm64' : 'simon-darwin-x64';
}

export async function downloadBinary(tag: string): Promise<string> {
  const url = `https://github.com/${REPO}/releases/download/${tag}/${assetName()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const tmp = '/tmp/simon-update';
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  chmodSync(tmp, 0o755);
  return tmp;
}

export function installBinary(tmpPath: string): void {
  execSync(`sudo mv "${tmpPath}" "${INSTALL_PATH}"`, { stdio: 'inherit' });
}
