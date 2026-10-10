//! Unified device model across iOS and Android, plus the discovery aggregators
//! the commands use. Mirrors the TypeScript `utils/devices.ts`.

use crate::{android, ios};
use anyhow::{bail, Result};
use inquire::Select;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Ios,
    Android,
}

/// A device that is currently running (booted sim/emulator or a plugged-in
/// physical device).
#[derive(Debug, Clone)]
pub enum RunningDevice {
    IosSim { name: String, udid: String, runtime: String },
    IosPhysical { name: String, udid: String, os_version: String },
    AndroidEmulator { name: String, serial: String },
    AndroidPhysical { name: String, serial: String },
}

impl RunningDevice {
    pub fn name(&self) -> &str {
        match self {
            RunningDevice::IosSim { name, .. }
            | RunningDevice::IosPhysical { name, .. }
            | RunningDevice::AndroidEmulator { name, .. }
            | RunningDevice::AndroidPhysical { name, .. } => name,
        }
    }

    pub fn platform(&self) -> Platform {
        match self {
            RunningDevice::IosSim { .. } | RunningDevice::IosPhysical { .. } => Platform::Ios,
            _ => Platform::Android,
        }
    }

    pub fn udid(&self) -> Option<&str> {
        match self {
            RunningDevice::IosSim { udid, .. } | RunningDevice::IosPhysical { udid, .. } => Some(udid),
            _ => None,
        }
    }

    pub fn serial(&self) -> Option<&str> {
        match self {
            RunningDevice::AndroidEmulator { serial, .. } | RunningDevice::AndroidPhysical { serial, .. } => Some(serial),
            _ => None,
        }
    }

    /// The id `--device` takes: udid on iOS, the AVD name for an emulator
    /// (its serial changes every boot), the adb serial for an Android phone.
    pub fn id(&self) -> &str {
        match self {
            RunningDevice::IosSim { udid, .. } | RunningDevice::IosPhysical { udid, .. } => udid,
            RunningDevice::AndroidEmulator { name, .. } => name,
            RunningDevice::AndroidPhysical { serial, .. } => serial,
        }
    }

    fn matches_id(&self, id: &str) -> bool {
        self.id() == id || self.serial() == Some(id)
    }

    pub fn label(&self) -> String {
        match self {
            RunningDevice::IosSim { name, runtime, .. } => format!("{name}  ({runtime} · simulator)"),
            RunningDevice::IosPhysical { name, os_version, .. } => format!("{name}  (iOS {os_version} · physical)"),
            RunningDevice::AndroidEmulator { name, .. } => format!("{name}  (emulator)"),
            RunningDevice::AndroidPhysical { name, .. } => format!("{name}  (physical)"),
        }
    }
}

/// An installed simulator/emulator (whether running or not).
#[derive(Debug, Clone)]
pub enum InstalledDevice {
    IosSim { name: String, udid: String, runtime: String, running: bool },
    AndroidAvd { name: String, running: bool },
}

impl InstalledDevice {
    pub fn name(&self) -> &str {
        match self {
            InstalledDevice::IosSim { name, .. } | InstalledDevice::AndroidAvd { name, .. } => name,
        }
    }

    /// See `RunningDevice::id`.
    pub fn id(&self) -> &str {
        match self {
            InstalledDevice::IosSim { udid, .. } => udid,
            InstalledDevice::AndroidAvd { name, .. } => name,
        }
    }

    pub fn running(&self) -> bool {
        match self {
            InstalledDevice::IosSim { running, .. } | InstalledDevice::AndroidAvd { running, .. } => *running,
        }
    }

    pub fn label(&self) -> String {
        let (base, running) = match self {
            InstalledDevice::IosSim { name, runtime, running, .. } => (format!("{name}  ({runtime} · simulator)"), *running),
            InstalledDevice::AndroidAvd { name, running } => (format!("{name}  (emulator)"), *running),
        };
        if running {
            format!("{base}  ● running")
        } else {
            base
        }
    }
}

impl std::fmt::Display for RunningDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

impl std::fmt::Display for InstalledDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// Map the -i/-a flags (each an optional name) and an optional positional name
/// to a platform filter + target name. A flag with a value, or a bare positional,
/// names a device; a bare flag just limits the platform.
pub fn resolve_target(ios: &Option<String>, android: &Option<String>, positional: Option<String>) -> (Option<Platform>, Option<String>) {
    let filter = if ios.is_some() {
        Some(Platform::Ios)
    } else if android.is_some() {
        Some(Platform::Android)
    } else {
        None
    };
    let name = ios
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| android.clone().filter(|s| !s.is_empty()))
        .or(positional);
    (filter, name)
}

/// Pick an installed device: direct by name, auto when there's exactly one,
/// otherwise an interactive list.
pub fn pick_installed(message: &str, filter: Option<Platform>, name: Option<&str>, exclude_running: bool) -> Result<InstalledDevice> {
    let all = get_all_installed(filter);
    if all.is_empty() {
        bail!("No simulators or emulators found.");
    }
    // A name targets a device directly (searched across all, even if running).
    if let Some(n) = name {
        return pick_by(all, n, |d| d.id() == n, |d| d.name(), |d| d.id()).map_err(|e| anyhow::anyhow!("{e}"));
    }
    let pool: Vec<InstalledDevice> = if exclude_running { all.into_iter().filter(|d| !d.running()).collect() } else { all };
    if pool.is_empty() {
        bail!("No eligible simulators or emulators found.");
    }
    if pool.len() == 1 {
        return Ok(pool.into_iter().next().unwrap());
    }
    Select::new(message, pool).prompt().map_err(|_| anyhow::anyhow!("cancelled"))
}

/// Pick a running device, optionally excluding physical devices (they can't be
/// stopped from here).
pub fn pick_running(message: &str, filter: Option<Platform>, name: Option<&str>, exclude_physical: bool) -> Result<RunningDevice> {
    let mut all = get_all_running(filter);
    if exclude_physical {
        all.retain(|d| !matches!(d, RunningDevice::IosPhysical { .. } | RunningDevice::AndroidPhysical { .. }));
    }
    if all.is_empty() {
        bail!("No running simulators or devices found.");
    }
    if let Some(n) = name {
        return pick_by(all, n, |d| d.matches_id(n), |d| d.name(), |d| d.id()).map_err(|e| anyhow::anyhow!("{e} (or not running)"));
    }
    if all.len() == 1 {
        return Ok(all.into_iter().next().unwrap());
    }
    Select::new(message, all).prompt().map_err(|_| anyhow::anyhow!("cancelled"))
}

/// The device `n` names: an id match first, else the only one with that name.
fn pick_by<T>(all: Vec<T>, n: &str, by_id: impl Fn(&T) -> bool, name: impl Fn(&T) -> &str, id: impl Fn(&T) -> &str) -> Result<T> {
    if let Some(i) = all.iter().position(&by_id) {
        return Ok(all.into_iter().nth(i).unwrap());
    }
    let mut named: Vec<T> = all.into_iter().filter(|d| name(d) == n).collect();
    match named.len() {
        0 => bail!("Device \"{n}\" not found."),
        1 => Ok(named.remove(0)),
        _ => bail!("Several devices are named \"{n}\"; pass an id instead: {}", named.iter().map(&id).collect::<Vec<_>>().join(", ")),
    }
}

/// A device found by `find_device`.
#[derive(Debug, Clone)]
pub enum Found {
    Running(RunningDevice),
    /// A simulator or emulator that isn't booted.
    Stopped(InstalledDevice),
}

/// Resolve a `--device` value the same way in every tool: an iOS udid, an AVD
/// name, an adb serial, or a device name that only one device has. Running
/// devices win over stopped ones.
pub fn find_device(id: &str) -> Result<Found> {
    let ambiguous = |e: &anyhow::Error| e.to_string().starts_with("Several");
    match pick_by(get_all_running(None), id, |d| d.matches_id(id), |d| d.name(), |d| d.id()) {
        Ok(d) => return Ok(Found::Running(d)),
        Err(e) if ambiguous(&e) => return Err(e),
        Err(_) => {}
    }
    let stopped = get_all_installed(None).into_iter().filter(|d| !d.running()).collect();
    pick_by(stopped, id, |d| d.id() == id, |d| d.name(), |d| d.id())
        .map(Found::Stopped)
        .map_err(|e| if ambiguous(&e) { e } else { anyhow::anyhow!("No device \"{id}\" (an iOS udid, AVD name, adb serial or device name; see `simon list` and `simon running`).") })
}

pub fn get_all_running(filter: Option<Platform>) -> Vec<RunningDevice> {
    let mut out = Vec::new();
    if filter != Some(Platform::Android) {
        for s in ios::list_simulators().into_iter().filter(|s| s.state == "Booted") {
            out.push(RunningDevice::IosSim { name: s.name, udid: s.udid, runtime: s.runtime });
        }
        for d in ios::list_physical_ios_devices() {
            out.push(RunningDevice::IosPhysical { name: d.name, udid: d.udid, os_version: d.os_version });
        }
    }
    if filter != Some(Platform::Ios) {
        for e in android::running_emulators() {
            out.push(RunningDevice::AndroidEmulator { name: e.name, serial: e.serial });
        }
        for d in android::connected_android_devices() {
            out.push(RunningDevice::AndroidPhysical { name: d.model, serial: d.serial });
        }
    }
    out
}

pub fn get_all_installed(filter: Option<Platform>) -> Vec<InstalledDevice> {
    let mut out = Vec::new();
    if filter != Some(Platform::Android) {
        for s in ios::list_simulators() {
            let running = s.state == "Booted";
            out.push(InstalledDevice::IosSim { name: s.name, udid: s.udid, runtime: s.runtime, running });
        }
    }
    if filter != Some(Platform::Ios) {
        let running: std::collections::HashSet<String> = android::running_avd_names().into_iter().collect();
        for name in android::list_avds() {
            let is_running = running.contains(&name);
            out.push(InstalledDevice::AndroidAvd { name, running: is_running });
        }
    }
    out
}
