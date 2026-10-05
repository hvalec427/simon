import { execSync } from 'child_process';
import { chmodSync, writeFileSync } from 'fs';

const REPO = 'hvalec427/simon';
const INSTALL_PATH = '/usr/local/bin/simon';

export function currentVersion(): string {
  return process.env.npm_package_version ?? 'unknown';
}

export async function latestRelease(): Promise<{ version: string; tag: string }> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'simon-cli' },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { tag_name?: string };
  if (!data.tag_name) throw new Error('Could not read the latest release tag.');
  return { version: data.tag_name.replace(/^v/, ''), tag: data.tag_name };
}

// 1 if a > b, -1 if a < b, 0 if equal (semver major.minor.patch)
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
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
