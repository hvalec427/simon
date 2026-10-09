//! Self-update: release channels, GitHub resolution, version comparison, and
//! installing over the running binary. Mirrors the TypeScript `utils/update.ts`.

use anyhow::{bail, Result};
use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;

const REPO: &str = "hvalec427/simon";
const DEFAULT_INSTALL_PATH: &str = "/usr/local/bin/simon";
const UA: &str = "simon-cli";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Stable,
    Nightly,
    Dev,
}

impl Channel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Nightly => "nightly",
            Channel::Dev => "dev",
        }
    }
}

pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn platform_supported() -> bool {
    cfg!(target_os = "macos") && (cfg!(target_arch = "aarch64") || cfg!(target_arch = "x86_64"))
}

/// The channel (release ring) the running build came from. `update` stays on it
/// unless --stable / --nightly / --dev switches rings.
pub fn current_channel() -> Channel {
    channel_of(&current_version())
}

/// The channel a version string belongs to.
pub fn channel_of(version: &str) -> Channel {
    if version.contains("-dev.") {
        Channel::Dev
    } else if version.contains("-nightly.") {
        Channel::Nightly
    } else {
        Channel::Stable
    }
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().user_agent(UA).build().expect("http client")
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    body: Option<String>,
}

pub struct Latest {
    pub version: String,
    pub tag: String,
}

fn strip_v(s: &str) -> String {
    s.strip_prefix('v').unwrap_or(s).to_string()
}

pub fn latest_for_channel(channel: Channel) -> Result<Latest> {
    let c = client();
    match channel {
        Channel::Dev => {
            let r = c.get(format!("https://api.github.com/repos/{REPO}/releases/tags/dev")).send()?;
            if !r.status().is_success() {
                bail!("No dev build has been published yet.");
            }
            let rel: Release = r.json()?;
            let version = strip_v(rel.name.as_deref().unwrap_or(&rel.tag_name));
            if version.is_empty() {
                bail!("Could not read the dev build version.");
            }
            Ok(Latest { version, tag: "dev".into() })
        }
        Channel::Stable => {
            let r = c.get(format!("https://api.github.com/repos/{REPO}/releases/latest")).send()?;
            if !r.status().is_success() {
                bail!("GitHub API returned {}", r.status());
            }
            let rel: Release = r.json()?;
            Ok(Latest { version: strip_v(&rel.tag_name), tag: rel.tag_name })
        }
        Channel::Nightly => {
            let r = c.get(format!("https://api.github.com/repos/{REPO}/releases?per_page=30")).send()?;
            if !r.status().is_success() {
                bail!("GitHub API returned {}", r.status());
            }
            let mut releases: Vec<Release> = r.json()?;
            releases.retain(|r| r.prerelease && strip_v(&r.tag_name).contains("-nightly."));
            releases.sort_by(|a, b| compare_versions(&strip_v(&b.tag_name), &strip_v(&a.tag_name)));
            let nightly = releases.into_iter().next().ok_or_else(|| anyhow::anyhow!("No nightly (prerelease) build found yet."))?;
            Ok(Latest { version: strip_v(&nightly.tag_name), tag: nightly.tag_name })
        }
    }
}

fn strip_install(body: &str) -> String {
    // Cut everything from an "Install this build" heading onward.
    let lower = body.to_lowercase();
    if let Some(idx) = lower.find("install this build") {
        // back up to the start of that heading line
        let head = body[..idx].rfind('\n').map(|n| n).unwrap_or(0);
        body[..head].trim().to_string()
    } else {
        body.trim().to_string()
    }
}

/// Aggregated changelog for releases in `channel` newer than `current`,
/// newest-first. None for dev (rolling, no notes) or on any failure.
pub fn changelog_since(channel: Channel, current: &str) -> Option<String> {
    if channel == Channel::Dev {
        return None;
    }
    let c = client();
    let r = c.get(format!("https://api.github.com/repos/{REPO}/releases?per_page=100")).send().ok()?;
    if !r.status().is_success() {
        return None;
    }
    let releases: Vec<Release> = r.json().ok()?;
    let mut in_channel: Vec<Release> = releases
        .into_iter()
        .filter(|r| if channel == Channel::Stable { !r.prerelease } else { r.prerelease && strip_v(&r.tag_name).contains("-nightly.") })
        .collect();
    in_channel.sort_by(|a, b| compare_versions(&strip_v(&b.tag_name), &strip_v(&a.tag_name)));
    if in_channel.is_empty() {
        return None;
    }
    let known = current != "unknown" && current.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
    let newer: Vec<&Release> = if known {
        in_channel.iter().filter(|r| compare_versions(&strip_v(&r.tag_name), current) == std::cmp::Ordering::Greater).collect()
    } else {
        in_channel.iter().take(1).collect()
    };
    if newer.is_empty() {
        return None;
    }
    const MAX: usize = 25;
    let mut sections: Vec<String> = newer
        .iter()
        .take(MAX)
        .map(|r| {
            let notes = r.body.as_deref().map(strip_install).filter(|s| !s.is_empty()).unwrap_or_else(|| "_(no notes)_".into());
            format!("## {}\n\n{}", r.tag_name, notes)
        })
        .collect();
    if newer.len() > MAX {
        sections.push(format!("_… and {} older release(s)._", newer.len() - MAX));
    }
    Some(sections.join("\n\n"))
}

/// Compare versions incl. `-<label>.<N>` prereleases. A final X.Y.Z outranks its
/// prereleases.
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    fn parts(v: &str) -> [u64; 4] {
        // X.Y.Z optionally -<label>.<N>
        let (core, pre) = match v.split_once('-') {
            Some((c, p)) => (c, Some(p)),
            None => (v, None),
        };
        let mut nums = core.split('.').map(|n| n.parse::<u64>().unwrap_or(0));
        let x = nums.next().unwrap_or(0);
        let y = nums.next().unwrap_or(0);
        let z = nums.next().unwrap_or(0);
        let pre_num = match pre {
            None => u64::MAX, // final release outranks prereleases
            Some(p) => p
                .rsplit_once('.')
                .and_then(|(_, n)| {
                    // Older builds used YYYYMMDDHHMMSS; scale a YYYYMMDD date to
                    // match so the two orders by day.
                    let v = n.parse::<u64>().ok()?;
                    Some(if n.len() == 8 { v * 1_000_000 } else { v })
                })
                .unwrap_or(0),
        };
        [x, y, z, pre_num]
    }
    parts(a).cmp(&parts(b))
}

fn asset_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "simon-darwin-arm64"
    } else {
        "simon-darwin-x64"
    }
}

pub fn download_binary(tag: &str) -> Result<PathBuf> {
    let url = format!("https://github.com/{REPO}/releases/download/{tag}/{}", asset_name());
    let resp = client().get(&url).send()?;
    if !resp.status().is_success() {
        bail!("Download failed: {}", resp.status());
    }
    let bytes = resp.bytes()?;
    let tmp = std::env::temp_dir().join("simon-update");
    std::fs::write(&tmp, &bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    // Strip the macOS quarantine flag so Gatekeeper doesn't block it.
    let _ = Command::new("xattr").arg("-d").arg("com.apple.quarantine").arg(&tmp).output();
    Ok(tmp)
}

/// Install over the actually-running binary (resolving symlinks), falling back
/// to `simon` on PATH, then the default path.
pub fn install_target() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if exe.file_name().map(|n| n == "simon").unwrap_or(false) {
            return std::fs::canonicalize(&exe).unwrap_or(exe);
        }
    }
    if let Ok(out) = Command::new("sh").args(["-c", "command -v simon"]).output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return std::fs::canonicalize(&p).unwrap_or_else(|_| PathBuf::from(p));
        }
    }
    PathBuf::from(DEFAULT_INSTALL_PATH)
}

pub fn needs_sudo(target: &std::path::Path) -> bool {
    let dir = target.parent().unwrap_or(std::path::Path::new("/"));
    // Writable if we can create (and remove) a probe file.
    let probe = dir.join(".simon-write-probe");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            false
        }
        Err(_) => true,
    }
}

pub fn install_binary(tmp: &std::path::Path, target: &std::path::Path) -> Result<()> {
    let cmd = if needs_sudo(target) { ("sudo", vec!["mv"]) } else { ("mv", vec![]) };
    let mut c = Command::new(cmd.0);
    c.args(cmd.1).arg(tmp).arg(target);
    let status = c.status()?;
    if !status.success() {
        bail!("install failed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering::*;

    #[test]
    fn compares_versions() {
        assert_eq!(compare_versions("1.3.0-dev.20261009120000", "1.2.0-dev.20261009130000"), Greater);
        assert_eq!(compare_versions("1.2.0", "1.2.0-nightly.20261009"), Greater);
        assert_eq!(compare_versions("2.16.0-nightly.20261009", "2.16.0-nightly.20261006193436"), Greater);
        assert_eq!(compare_versions("2.16.0-nightly.20261006", "2.16.0-nightly.20261006193436"), Less);
        assert_eq!(compare_versions("1.2.0-dev.20261009120000", "1.2.0-dev.20261009120000"), Equal);
    }

    #[test]
    fn infers_channel_from_version() {
        assert_eq!(channel_of("1.2.0-dev.20261009120000"), Channel::Dev);
        assert_eq!(channel_of("1.2.0-nightly.20261009"), Channel::Nightly);
        assert_eq!(channel_of("1.2.0"), Channel::Stable);
    }
}
