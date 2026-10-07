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

pub fn open_url_on_simulator(udid: &str, url: &str) -> anyhow::Result<()> {
    simctl(&["openurl", udid, url])
}

/// Launch (foreground) an installed app on a simulator by bundle id.
pub fn launch_app_on_simulator(udid: &str, bundle_id: &str) -> anyhow::Result<()> {
    simctl(&["launch", udid, bundle_id])
}

/// Launch an app on a physical device by bundle id (devicectl).
pub fn launch_app_on_physical_ios(udid: &str, bundle_id: &str) -> anyhow::Result<()> {
    ensure_devicectl()?;
    let out = Command::new("xcrun")
        .args(["devicectl", "device", "process", "launch", "--device", udid, bundle_id])
        .output()?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr).lines().map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("").to_string();
        anyhow::bail!("Failed to launch \"{bundle_id}\"{}", if detail.is_empty() { ".".into() } else { format!(":\n  {detail}") });
    }
    Ok(())
}

pub fn set_sim_location(udid: &str, lat: &str, lon: &str) -> anyhow::Result<()> {
    simctl(&["location", udid, "set", &format!("{lat},{lon}")])
}

pub fn clear_sim_location(udid: &str) -> anyhow::Result<()> {
    simctl(&["location", udid, "clear"])
}

fn ensure_devicectl() -> anyhow::Result<()> {
    let ok = Command::new("xcrun").args(["-f", "devicectl"]).output().map(|o| o.status.success()).unwrap_or(false);
    if !ok {
        anyhow::bail!(
            "Opening deep links on a physical iOS device requires full Xcode (devicectl).\n\
             Install Xcode, then point the tools at it:\n  sudo xcode-select -s /Applications/Xcode.app"
        );
    }
    Ok(())
}

/// devicectl has no system-wide "open URL"; hand it to Safari (or directly to
/// `bundle_id`) and let the system route the scheme. `restart` cold-relaunches
/// via --terminate-existing; otherwise the app is warm-foregrounded.
pub fn open_url_on_physical_ios(udid: &str, url: &str, bundle_id: Option<&str>, restart: bool) -> anyhow::Result<()> {
    ensure_devicectl()?;
    let target = bundle_id.unwrap_or("com.apple.mobilesafari");
    let mut args: Vec<&str> = vec!["devicectl", "device", "process", "launch"];
    if restart {
        args.push("--terminate-existing");
    }
    args.extend(["--payload-url", url, "--device", udid, target]);
    let out = Command::new("xcrun").args(&args).output()?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr).lines().map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("").to_string();
        let mut msg = format!("Failed to open the link on the device{}", if detail.is_empty() { ".".into() } else { format!(":\n  {detail}") });
        if let Some(b) = bundle_id {
            msg.push_str(&format!(
                "\nCheck that \"{b}\" is the app's exact bundle id — list installed apps with:\n  xcrun devicectl device info apps --device \"{udid}\""
            ));
        }
        anyhow::bail!(msg);
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct DeviceType {
    pub name: String,
    pub identifier: String,
}
impl std::fmt::Display for DeviceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name)
    }
}

#[derive(Debug, Clone)]
pub struct Runtime {
    pub name: String,
    pub identifier: String,
    pub version: String,
}
impl std::fmt::Display for Runtime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name)
    }
}

#[derive(Deserialize)]
struct DeviceTypesList {
    devicetypes: Vec<DeviceTypeRaw>,
}
#[derive(Deserialize)]
struct DeviceTypeRaw {
    name: String,
    identifier: String,
}

#[derive(Deserialize)]
struct RuntimesList {
    runtimes: Vec<RuntimeRaw>,
}
#[derive(Deserialize)]
struct RuntimeRaw {
    name: String,
    identifier: String,
    version: String,
    #[serde(rename = "isAvailable", default)]
    is_available: bool,
}

pub fn list_device_types() -> Vec<DeviceType> {
    let out = match Command::new("xcrun").args(["simctl", "list", "devicetypes", "--json"]).output() {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    let data: DeviceTypesList = match serde_json::from_slice(&out) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    data.devicetypes
        .into_iter()
        .filter(|d| d.name.contains("iPhone") || d.name.contains("iPad"))
        .map(|d| DeviceType { name: d.name, identifier: d.identifier })
        .collect()
}

pub fn list_runtimes() -> Vec<Runtime> {
    let out = match Command::new("xcrun").args(["simctl", "list", "runtimes", "--json"]).output() {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    let data: RuntimesList = match serde_json::from_slice(&out) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    data.runtimes
        .into_iter()
        .filter(|r| r.is_available && r.name.contains("iOS"))
        .map(|r| Runtime { name: r.name, identifier: r.identifier, version: r.version })
        .collect()
}

pub fn create_simulator(name: &str, device_type: &str, runtime: &str) -> anyhow::Result<String> {
    let out = Command::new("xcrun").args(["simctl", "create", name, device_type, runtime]).output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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
