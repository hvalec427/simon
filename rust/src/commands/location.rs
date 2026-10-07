use crate::devices::{pick_running, resolve_target, RunningDevice};
use crate::goios::{ensure_go_ios, ensure_tunnel, ios_cmd, stop_tunnel};
use crate::{androidmock, ios};

fn parse_coords(coords: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = coords.split([',', ' ', '\t']).filter(|s| !s.is_empty()).collect();
    if parts.len() != 2 {
        return None;
    }
    let (lat, lon) = (parts[0], parts[1]);
    if lat.parse::<f64>().is_err() || lon.parse::<f64>().is_err() {
        return None;
    }
    Some((lat.to_string(), lon.to_string()))
}

pub fn run(
    coords: Option<String>,
    name_arg: Option<String>,
    ios_flag: Option<String>,
    android_flag: Option<String>,
    reset: bool,
) {
    let (filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);

    let parsed = if reset {
        None
    } else {
        match coords.as_deref().and_then(parse_coords) {
            Some(p) => Some(p),
            None => {
                eprintln!("Provide coordinates as \"lat,lon\", e.g. `simon location 51.5074,-0.1278` (or --reset).");
                std::process::exit(1);
            }
        }
    };

    let device = match pick_running("Select a device to set location on:", filter, name.as_deref(), false) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };

    let res: anyhow::Result<()> = (|| {
        match &device {
            RunningDevice::IosSim { udid, .. } => {
                if reset {
                    ios::clear_sim_location(udid)?;
                } else {
                    let (lat, lon) = parsed.as_ref().unwrap();
                    ios::set_sim_location(udid, lat, lon)?;
                }
            }
            RunningDevice::IosPhysical { udid, .. } => {
                ensure_go_ios()?;
                ensure_tunnel()?;
                if reset {
                    ios_cmd(&["resetlocation", &format!("--udid={udid}")])?;
                    if stop_tunnel() {
                        eprintln!("Stopped the iOS developer tunnel.");
                    }
                } else {
                    let (lat, lon) = parsed.as_ref().unwrap();
                    ios_cmd(&["setlocation", &format!("--lat={lat}"), &format!("--lon={lon}"), &format!("--udid={udid}")])?;
                }
            }
            RunningDevice::AndroidPhysical { serial, .. } => {
                if reset {
                    androidmock::reset_android_device_location(serial)?;
                } else {
                    let (lat, lon) = parsed.as_ref().unwrap();
                    androidmock::set_android_device_location(serial, lat, lon)?;
                }
            }
            RunningDevice::AndroidEmulator { serial, .. } => {
                if reset {
                    anyhow::bail!("Android emulators have no location reset — set a new location instead.");
                }
                let (lat, lon) = parsed.as_ref().unwrap();
                crate::android::emu_geo_fix(serial, lon, lat)?;
            }
        }
        Ok(())
    })();

    match res {
        Ok(()) => {
            if reset {
                println!("Cleared location on {}.", device.name());
            } else {
                let (lat, lon) = parsed.as_ref().unwrap();
                println!("Set {} to {}, {}.", device.name(), lat, lon);
            }
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
