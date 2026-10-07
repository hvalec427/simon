//! Android device discovery via the SDK's `emulator` and `adb`. Mirrors the
//! TypeScript `utils/android.ts`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

/// Locate `avdmanager` across the SDK layouts, falling back to the bare name.
fn find_avdmanager() -> String {
    let sdk = sdk_root();
    let mut candidates = vec![
        sdk.join("cmdline-tools/latest/bin/avdmanager"),
        sdk.join("tools/bin/avdmanager"),
    ];
    if let Ok(entries) = std::fs::read_dir(sdk.join("cmdline-tools")) {
        for e in entries.flatten() {
            candidates.push(e.path().join("bin/avdmanager"));
        }
    }
    candidates
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "avdmanager".to_string())
}

pub fn launch_avd(name: &str) -> anyhow::Result<()> {
    let emulator = find_bin("emulator");
    let dir = Path::new(&emulator).parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    let sdk = sdk_root();
    Command::new(&emulator)
        .args(["-avd", name])
        .current_dir(dir)
        .env("ANDROID_HOME", &sdk)
        .env("ANDROID_SDK_ROOT", &sdk)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

pub fn stop_emulator(serial: &str) -> anyhow::Result<()> {
    let adb = find_bin("adb");
    Command::new(&adb).args(["-s", serial, "emu", "kill"]).output()?;
    Ok(())
}

pub fn open_url(serial: &str, url: &str) -> anyhow::Result<()> {
    let adb = find_bin("adb");
    let out = Command::new(&adb)
        .args(["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url])
        .output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// `adb emu geo fix` takes longitude first, then latitude.
pub fn emu_geo_fix(serial: &str, lon: &str, lat: &str) -> anyhow::Result<()> {
    let adb = find_bin("adb");
    let out = Command::new(&adb).args(["-s", serial, "emu", "geo", "fix", lon, lat]).output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

pub fn delete_avd(name: &str) -> anyhow::Result<()> {
    let out = Command::new(find_avdmanager()).args(["delete", "avd", "-n", name]).output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Erase an AVD's data by removing its userdata/cache images (next boot recreates them).
pub fn wipe_avd(name: &str) -> anyhow::Result<()> {
    let home = std::env::var("HOME").unwrap_or_default();
    let base = PathBuf::from(&home).join(".android/avd");
    let ini = base.join(format!("{name}.ini"));
    let mut avd_path = base.join(format!("{name}.avd"));
    if let Ok(contents) = std::fs::read_to_string(&ini) {
        for line in contents.lines() {
            if let Some(rest) = line.trim().strip_prefix("path") {
                if let Some(v) = rest.trim_start().strip_prefix('=') {
                    avd_path = PathBuf::from(v.trim());
                }
            }
        }
    }
    for pattern in ["userdata-qemu.img", "userdata-qemu.img.qcow2", "cache.img", "cache.img.qcow2"] {
        let f = avd_path.join(pattern);
        if f.exists() {
            std::fs::remove_file(&f).ok();
        }
    }
    Ok(())
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
