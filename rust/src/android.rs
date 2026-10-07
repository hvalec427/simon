//! Android device discovery via the SDK's `emulator` and `adb`. Mirrors the
//! TypeScript `utils/android.ts`.

use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct RunningEmulator {
    pub serial: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct PhysicalAndroidDevice {
    pub serial: String,
    pub model: String,
}

pub fn sdk_root() -> PathBuf {
    if let Ok(p) = std::env::var("ANDROID_HOME") {
        return PathBuf::from(p);
    }
    if let Ok(p) = std::env::var("ANDROID_SDK_ROOT") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join("Library/Android/sdk")
}

/// Resolve `emulator` or `adb` within the SDK, falling back to the bare name
/// (so it still works if they're on PATH).
pub fn find_bin(name: &str) -> String {
    let subdir = if name == "emulator" { "emulator" } else { "platform-tools" };
    let p = sdk_root().join(subdir).join(name);
    if p.exists() {
        p.to_string_lossy().into_owned()
    } else {
        name.to_string()
    }
}

fn output(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        None
    }
}

pub fn list_avds() -> Vec<String> {
    let emulator = find_bin("emulator");
    match output(&emulator, &["-list-avds"]) {
        Some(out) => out.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).map(String::from).collect(),
        None => Vec::new(),
    }
}

/// Serials from `adb devices` split into (emulator serials, physical serials).
fn adb_serials(adb: &str) -> (Vec<String>, Vec<String>) {
    let out = match output(adb, &["devices"]) {
        Some(o) => o,
        None => return (Vec::new(), Vec::new()),
    };
    let mut emulators = Vec::new();
    let mut physical = Vec::new();
    for line in out.lines().skip(1) {
        if !line.contains("\tdevice") {
            continue;
        }
        let serial = line.split('\t').next().unwrap_or("").trim().to_string();
        if serial.is_empty() {
            continue;
        }
        if serial.starts_with("emulator-") {
            emulators.push(serial);
        } else {
            physical.push(serial);
        }
    }
    (emulators, physical)
}

pub fn running_emulators() -> Vec<RunningEmulator> {
    let adb = find_bin("adb");
    let (serials, _) = adb_serials(&adb);
    serials
        .into_iter()
        .map(|serial| {
            let name = output(&adb, &["-s", &serial, "emu", "avd", "name"])
                .and_then(|o| o.lines().next().map(|l| l.trim().to_string()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| serial.clone());
            RunningEmulator { serial, name }
        })
        .collect()
}

pub fn running_avd_names() -> Vec<String> {
    running_emulators().into_iter().map(|e| e.name).collect()
}

pub fn connected_android_devices() -> Vec<PhysicalAndroidDevice> {
    let adb = find_bin("adb");
    let (_, serials) = adb_serials(&adb);
    serials
        .into_iter()
        .map(|serial| {
            let model = output(&adb, &["-s", &serial, "shell", "getprop", "ro.product.model"])
                .map(|o| o.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| serial.clone());
            PhysicalAndroidDevice { serial, model }
        })
        .collect()
}
