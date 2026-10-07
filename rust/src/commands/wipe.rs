use crate::devices::{pick_installed, resolve_target, InstalledDevice};
use crate::{android, ios};
use inquire::Confirm;

pub fn run(ios_flag: Option<String>, android_flag: Option<String>, name_arg: Option<String>) {
    let (filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);
    // Running devices can't be wiped; they're hidden from the picker. A device
    // named explicitly is still found, and guarded below so the error is clear.
    let device = match pick_installed("Select a device to wipe:", filter, name.as_deref(), true) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };

    if device.running() {
        eprintln!("{} is running — stop it before wiping.", device.name());
        std::process::exit(1);
    }

    let confirmed = Confirm::new(&format!("Erase all data on {}? This can't be undone.", device.name()))
        .with_default(false)
        .prompt()
        .unwrap_or(false);
    if !confirmed {
        println!("Cancelled.");
        return;
    }

    println!("Wiping {}...", device.name());
    let res = match &device {
        InstalledDevice::IosSim { udid, .. } => ios::erase_simulator(udid),
        InstalledDevice::AndroidAvd { name, .. } => android::wipe_avd(name),
    };
    match res {
        Ok(()) => println!("Done."),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
