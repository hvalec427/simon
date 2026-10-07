use crate::devices::{pick_installed, resolve_target, InstalledDevice};
use crate::{android, ios};

pub fn run(ios_flag: Option<String>, android_flag: Option<String>, name_arg: Option<String>) {
    let (filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);
    let device = match pick_installed("Select a device to launch:", filter, name.as_deref(), false) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    println!("Launching {}...", device.name());
    let res = match &device {
        InstalledDevice::IosSim { udid, .. } => ios::boot_simulator(udid),
        InstalledDevice::AndroidAvd { name, .. } => android::launch_avd(name),
    };
    if let Err(e) = res {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
