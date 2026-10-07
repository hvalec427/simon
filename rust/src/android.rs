//! Android device discovery via the SDK's `emulator` and `adb`. Mirrors the
//! TypeScript `utils/android.ts`.

use std::io::Write;
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

#[derive(Debug, Clone)]
pub struct DeviceDefinition {
    pub id: String,
    pub name: String,
}
impl std::fmt::Display for DeviceDefinition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name)
    }
}

#[derive(Debug, Clone)]
pub struct SystemImage {
    pub api: String,
    pub package: String,
    pub label: String,
}
impl std::fmt::Display for SystemImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label)
    }
}

pub fn list_device_definitions() -> Vec<DeviceDefinition> {
    let out = match output(&find_avdmanager(), &["list", "device"]) {
        Some(o) => o,
        None => return Vec::new(),
    };
    const SKIP: [&str; 6] = ["automotive", "tv_", "glass", "wear", "desktop", "chromebook"];
    let mut devices = Vec::new();
    let mut current_id: Option<String> = None;
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("id: ") {
            // `id: 17 or "pixel_7"`
            if let Some(start) = rest.find('"') {
                if let Some(end) = rest[start + 1..].find('"') {
                    current_id = Some(rest[start + 1..start + 1 + end].to_string());
                }
            }
            continue;
        }
        let trimmed = line.trim_start();
        if let Some(name) = trimmed.strip_prefix("Name:") {
            if let Some(id) = current_id.take() {
                if !SKIP.iter().any(|s| id.starts_with(s)) {
                    devices.push(DeviceDefinition { id, name: name.trim().to_string() });
                }
            }
        }
    }
    devices
}

pub fn list_installed_system_images() -> Vec<SystemImage> {
    let dir = sdk_root().join("system-images");
    let mut images = Vec::new();
    let api_dirs = match std::fs::read_dir(&dir) {
        Ok(d) => d,
        Err(_) => return images,
    };
    for api in api_dirs.flatten().filter(|e| e.path().is_dir()) {
        let api_name = api.file_name().to_string_lossy().into_owned();
        let api_num = api_name.replace("android-", "");
        let variants = match std::fs::read_dir(api.path()) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for variant in variants.flatten().filter(|e| e.path().is_dir()) {
            let variant_name = variant.file_name().to_string_lossy().into_owned();
            if let Ok(archs) = std::fs::read_dir(variant.path()) {
                for arch in archs.flatten().filter(|e| e.path().is_dir()) {
                    let arch_name = arch.file_name().to_string_lossy().into_owned();
                    images.push(SystemImage {
                        api: api_num.clone(),
                        package: format!("system-images;{api_name};{variant_name};{arch_name}"),
                        label: format!("API {api_num}  {variant_name}  ({arch_name})"),
                    });
                }
            }
        }
    }
    images.sort_by(|a, b| b.api.parse::<i32>().unwrap_or(0).cmp(&a.api.parse::<i32>().unwrap_or(0)));
    images
}

pub fn create_avd(name: &str, device_id: &str, system_image: &str) -> anyhow::Result<()> {
    let mut child = Command::new(find_avdmanager())
        .args(["create", "avd", "-n", name, "-k", system_image, "-d", device_id])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // avdmanager asks whether to use a custom hardware profile — answer "no".
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(b"no\n");
    }
    let out = child.wait_with_output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
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
    open_url_with_package(serial, url, None)
}

/// Open a URL via a VIEW intent, optionally constrained to `package` so the link
/// is delivered straight to that app instead of a browser/chooser.
pub fn open_url_with_package(serial: &str, url: &str, package: Option<&str>) -> anyhow::Result<()> {
    let adb = find_bin("adb");
    let mut args: Vec<&str> = vec!["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url];
    if let Some(p) = package {
        args.push(p);
    }
    let out = Command::new(&adb).args(&args).output()?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Whether `package` is installed on the device (`pm path` prints a path only
/// when it is).
pub fn app_installed(serial: &str, package: &str) -> bool {
    let adb = find_bin("adb");
    Command::new(&adb)
        .args(["-s", serial, "shell", "pm", "path", package])
        .output()
        .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false)
}

/// The package currently in the foreground (resumed), parsed from dumpsys.
pub fn foreground_package(serial: &str) -> Option<String> {
    let adb = find_bin("adb");
    let out = Command::new(&adb).args(["-s", serial, "shell", "dumpsys", "activity", "activities"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if line.contains("mResumedActivity") || line.contains("topResumedActivity") {
            // e.g. "... u0 com.example/.MainActivity t42}" → take the package.
            for tok in line.split_whitespace() {
                if let Some((pkg, _)) = tok.split_once('/') {
                    if pkg.contains('.') {
                        return Some(pkg.to_string());
                    }
                }
            }
        }
    }
    None
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
