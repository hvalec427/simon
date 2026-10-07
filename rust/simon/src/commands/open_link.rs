use crate::devices::{pick_running, resolve_target, RunningDevice};
use crate::{android, ios};

pub fn run(
    url: String,
    name_arg: Option<String>,
    ios_flag: Option<String>,
    android_flag: Option<String>,
    bundle_id: Option<String>,
    restart: bool,
) {
    let (filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);
    let device = match pick_running("Select a device to open the link on:", filter, name.as_deref(), false) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let res = match &device {
        RunningDevice::IosSim { udid, .. } => ios::open_url_on_simulator(udid, &url),
        RunningDevice::IosPhysical { udid, .. } => ios::open_url_on_physical_ios(udid, &url, bundle_id.as_deref(), restart),
        RunningDevice::AndroidEmulator { serial, .. } | RunningDevice::AndroidPhysical { serial, .. } => {
            android::open_url(serial, &url)
        }
    };
    match res {
        Ok(()) => println!("Opened on {}", device.name()),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
