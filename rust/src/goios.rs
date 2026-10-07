//! Physical-iOS helpers via go-ios (`ios`): auto-install, the iOS 17+ developer
//! tunnel, and running commands. Mirrors the TypeScript `utils/goios.ts`.

use anyhow::{bail, Result};
use std::process::{Command, Stdio};

pub fn tunnel_log() -> std::path::PathBuf {
    std::env::temp_dir().join("simon-ios-tunnel.log")
}

pub fn has_go_ios() -> bool {
    Command::new("sh")
        .args(["-c", "command -v ios"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// go-ios isn't a first-party tool, so install it on demand the first time a
/// physical-iOS command needs it.
pub fn ensure_go_ios() -> Result<()> {
    if has_go_ios() {
        return Ok(());
    }
    eprintln!("go-ios not found — installing (npm install -g go-ios)...");
    let out = Command::new("npm").args(["install", "-g", "go-ios"]).output();
    match out {
        Ok(o) if o.status.success() => {}
        Ok(o) => bail!(
            "go-ios is required for physical iOS devices and the automatic install failed.\n{}\nInstall it manually:  npm install -g go-ios",
            String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("")
        ),
        Err(e) => bail!("Could not run npm to install go-ios: {e}\nInstall it manually:  npm install -g go-ios"),
    }
    if !has_go_ios() {
        bail!("go-ios installed but `ios` isn't on your PATH — check your npm global bin directory is on PATH.");
    }
    Ok(())
}

pub fn tunnel_running() -> bool {
    Command::new("pgrep")
        .args(["-f", "ios tunnel start"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// iOS 17+ needs a root developer tunnel. Started via `nohup … &` so sudo keeps
/// the controlling terminal (its credential timestamp is tty-bound) and the
/// tunnel outlives simon.
pub fn ensure_tunnel() -> Result<()> {
    if tunnel_running() {
        return Ok(());
    }
    eprintln!("Starting the iOS developer tunnel (sudo required; needed on iOS 17+)...");
    if !Command::new("sudo").arg("-v").status().map(|s| s.success()).unwrap_or(false) {
        bail!("Could not get sudo to start the developer tunnel. Start it manually:  sudo ios tunnel start");
    }
    let log = tunnel_log();
    let _ = Command::new("sh")
        .arg("-c")
        .arg(format!("nohup sudo ios tunnel start > {:?} 2>&1 &", log))
        .status();

    for i in 0..24 {
        if tunnel_running() {
            std::thread::sleep(std::time::Duration::from_secs(2)); // let it finish establishing
            eprintln!("Tunnel started (logs: {}).", log.display());
            return Ok(());
        }
        let _ = i;
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    bail!(
        "The developer tunnel did not start. Check {}, or run it manually:  sudo ios tunnel start",
        log.display()
    )
}

pub fn stop_tunnel() -> bool {
    if !tunnel_running() {
        return false;
    }
    let _ = Command::new("sudo").args(["pkill", "-f", "ios tunnel start"]).status();
    true
}

/// Run `ios <args>`, surfacing the first stderr line on failure.
pub fn ios_cmd(args: &[&str]) -> Result<()> {
    let out = Command::new("ios").args(args).output()?;
    if !out.status.success() {
        let first = String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("").trim().to_string();
        bail!("go-ios failed{}", if first.is_empty() { String::new() } else { format!(": {first}") });
    }
    Ok(())
}
