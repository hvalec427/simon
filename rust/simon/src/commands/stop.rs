use crate::devices::{pick_running, resolve_target, RunningDevice};
use crate::{android, ios};

pub fn run(ios_flag: Option<String>, android_flag: Option<String>, name_arg: Option<String>) {
    let (filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);
    // Physical devices can't be stopped, so they're excluded from the picker.
    let device = match pick_running("Select a device to stop:", filter, name.as_deref(), true) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    println!("Stopping {}...", device.name());
    let res = match &device {
        RunningDevice::IosSim { udid, .. } => ios::shutdown_simulator(udid),
        RunningDevice::AndroidEmulator { serial, .. } => android::stop_emulator(serial),
        _ => Err(anyhow::anyhow!("Physical devices can't be stopped.")),
    };
    match res {
        Ok(()) => println!("Done."),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
