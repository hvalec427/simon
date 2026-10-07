use crate::devices::{pick_installed, resolve_target, InstalledDevice};
use crate::{android, ios};
use inquire::Confirm;

pub fn run(ios_flag: Option<String>, android_flag: Option<String>, name_arg: Option<String>) {
    let (filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);
    let device = match pick_installed("Select a device to delete:", filter, name.as_deref(), false) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };

    let confirmed = Confirm::new(&format!("Delete {}? This can't be undone.", device.name()))
        .with_default(false)
        .prompt()
        .unwrap_or(false);
    if !confirmed {
        println!("Cancelled.");
        return;
    }

    // A running device must be stopped before it can be deleted.
    if device.running() {
        stop_running(&device);
    }

    println!("Deleting {}...", device.name());
    let res = match &device {
        InstalledDevice::IosSim { udid, .. } => ios::delete_simulator(udid),
        InstalledDevice::AndroidAvd { name, .. } => android::delete_avd(name),
    };
    match res {
        Ok(()) => println!("Done."),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

fn stop_running(device: &InstalledDevice) {
    match device {
        InstalledDevice::IosSim { udid, .. } => {
            let _ = ios::shutdown_simulator(udid);
        }
        InstalledDevice::AndroidAvd { name, .. } => {
            if let Some(e) = android::running_emulators().into_iter().find(|e| &e.name == name) {
                let _ = android::stop_emulator(&e.serial);
            }
        }
    }
}
