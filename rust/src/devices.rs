//! Unified device model across iOS and Android, plus the discovery aggregators
//! the commands use. Mirrors the TypeScript `utils/devices.ts`.

use crate::{android, ios};

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
