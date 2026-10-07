//! iOS device discovery via `xcrun simctl` (simulators) and `xcrun devicectl`
//! (physical devices). Mirrors the behaviour of the TypeScript `utils/ios.ts`.

use serde::Deserialize;
use std::collections::HashMap;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Simulator {
    pub name: String,
    pub udid: String,
    pub state: String,
    pub runtime: String,
}

#[derive(Debug, Clone)]
pub struct PhysicalIosDevice {
    pub name: String,
    pub udid: String,
    pub os_version: String,
}

#[derive(Deserialize)]
struct SimctlList {
    devices: HashMap<String, Vec<SimctlDevice>>,
}

#[derive(Deserialize)]
struct SimctlDevice {
    name: String,
    udid: String,
    state: String,
    #[serde(rename = "isAvailable", default)]
    is_available: bool,
}

/// Turn "iOS-17-0" into "iOS 17.0": strip the SimRuntime prefix, swap dashes for
/// spaces, then join a trailing "<major> <minor>" pair with a dot.
fn tidy_runtime(raw: &str) -> String {
    let spaced = raw
        .replace("com.apple.CoreSimulator.SimRuntime.", "")
        .replace('-', " ");
    let parts: Vec<&str> = spaced.split_whitespace().collect();
    if parts.len() >= 3 {
        let (n2, n1) = (parts[parts.len() - 1], parts[parts.len() - 2]);
        if n1.chars().all(|c| c.is_ascii_digit()) && n2.chars().all(|c| c.is_ascii_digit()) {
            let head = parts[..parts.len() - 2].join(" ");
            return format!("{head} {n1}.{n2}");
        }
    }
    spaced
}

pub fn list_simulators() -> Vec<Simulator> {
    let out = match Command::new("xcrun").args(["simctl", "list", "devices", "--json"]).output() {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    let data: SimctlList = match serde_json::from_slice(&out) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let mut sims = Vec::new();
    for (runtime, devices) in data.devices {
        let label = tidy_runtime(&runtime);
        for d in devices {
            if d.is_available {
                sims.push(Simulator { name: d.name, udid: d.udid, state: d.state, runtime: label.clone() });
            }
        }
    }
    sims.sort_by(|a, b| a.name.cmp(&b.name));
    sims
}

fn simctl(args: &[&str]) -> anyhow::Result<()> {
    let out = Command::new("xcrun").arg("simctl").args(args).output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

pub fn boot_simulator(udid: &str) -> anyhow::Result<()> {
    // Boot may fail if it's already booted — that's fine.
    let _ = Command::new("xcrun").args(["simctl", "boot", udid]).output();
    let _ = Command::new("open").args(["-a", "Simulator"]).spawn();
    Ok(())
}

pub fn shutdown_simulator(udid: &str) -> anyhow::Result<()> {
    simctl(&["shutdown", udid])
}

pub fn delete_simulator(udid: &str) -> anyhow::Result<()> {
    simctl(&["delete", udid])
}

pub fn erase_simulator(udid: &str) -> anyhow::Result<()> {
    simctl(&["erase", udid])
}

pub fn list_physical_ios_devices() -> Vec<PhysicalIosDevice> {
    let tmp = std::env::temp_dir().join("simon-devicectl.json");
    let status = Command::new("xcrun")
        .args(["devicectl", "list", "devices", "--json-output"])
        .arg(&tmp)
        .output();
    if !matches!(status, Ok(ref o) if o.status.success()) {
        return Vec::new();
    }
    let raw = match std::fs::read(&tmp) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let data: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let devices = data["result"]["devices"].as_array().cloned().unwrap_or_default();
    devices
        .into_iter()
        .filter(|d| !d["connectionProperties"]["transportType"].is_null())
        .map(|d| PhysicalIosDevice {
            name: d["deviceProperties"]["name"]
                .as_str()
                .or_else(|| d["hardwareProperties"]["marketingName"].as_str())
                .unwrap_or("Unknown")
                .to_string(),
            udid: d["hardwareProperties"]["udid"]
                .as_str()
                .or_else(|| d["identifier"].as_str())
                .unwrap_or("")
                .to_string(),
            os_version: d["deviceProperties"]["osVersionNumber"].as_str().unwrap_or("").to_string(),
        })
        .collect()
}
