use crate::devices::{get_all_installed, InstalledDevice, Platform};

pub fn run(ios: bool, android: bool) {
    let filter = match (ios, android) {
        (true, false) => Some(Platform::Ios),
        (false, true) => Some(Platform::Android),
        _ => None,
    };
    let devices = get_all_installed(filter);
    if devices.is_empty() {
        println!("No simulators or emulators found.");
        return;
    }

    let ios_devices: Vec<&InstalledDevice> =
        devices.iter().filter(|d| matches!(d, InstalledDevice::IosSim { .. })).collect();
    let android_devices: Vec<&InstalledDevice> =
        devices.iter().filter(|d| matches!(d, InstalledDevice::AndroidAvd { .. })).collect();

    if !ios_devices.is_empty() {
        println!("iOS simulators:");
        for d in ios_devices {
            println!("  {}", with_id(d.label(), d.name(), d.id()));
        }
    }
    if !android_devices.is_empty() {
        if !devices.iter().all(|d| matches!(d, InstalledDevice::AndroidAvd { .. })) {
            println!();
        }
        println!("Android emulators:");
        for d in android_devices {
            println!("  {}", with_id(d.label(), d.name(), d.id()));
        }
    }
}

/// A label followed by the device's `--device` id when it isn't its name.
pub fn with_id(label: String, name: &str, id: &str) -> String {
    if id == name {
        label
    } else {
        format!("{label}  · {id}")
    }
}
