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
            println!("  {}", d.label());
        }
    }
    if !android_devices.is_empty() {
        if !devices.iter().all(|d| matches!(d, InstalledDevice::AndroidAvd { .. })) {
            println!();
        }
        println!("Android emulators:");
        for d in android_devices {
            println!("  {}", d.label());
        }
    }
}
