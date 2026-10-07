use crate::android::find_bin;
use crate::devices::{pick_running, resolve_target, RunningDevice};
use crate::goios::{ensure_go_ios, ensure_tunnel};
use crate::rn;
use std::io::IsTerminal;
use std::process::Command;

#[allow(clippy::too_many_arguments)]
pub fn run(
    name_arg: Option<String>,
    ios_flag: Option<String>,
    android_flag: Option<String>,
    filter: Option<String>,
    app: Option<String>,
    rn_mode: bool,
    port: Option<u16>,
    print_ws: bool,
) {
    let (device_filter, name) = resolve_target(&ios_flag, &android_flag, name_arg);

    if rn_mode {
        let port = port.unwrap_or(8081);
        if print_ws {
            rn::print_inspector_ws(port, name.as_deref());
            return;
        }
        // Interactive TUI in a terminal; plain line stream when piped/redirected.
        let result = if std::io::stdout().is_terminal() {
            crate::rntui::run(port, name.as_deref())
        } else {
            rn::stream_plain(port, name.as_deref())
        };
        if let Err(e) = result {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }

    let device = match pick_running("Select a device to stream logs from:", device_filter, name.as_deref(), false) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    println!("Streaming logs from {}  (Ctrl+C to stop)\n", device.name());
    if let Err(e) = stream_native(&device, filter.as_deref(), app.as_deref()) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn ios_predicate(filter: Option<&str>, app: Option<&str>) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(a) = app {
        parts.push(format!("(process CONTAINS[c] \"{a}\" OR subsystem CONTAINS[c] \"{a}\")"));
    }
    if let Some(f) = filter {
        parts.push(format!("({f})"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" AND "))
    }
}

fn stream_native(device: &RunningDevice, filter: Option<&str>, app: Option<&str>) -> anyhow::Result<()> {
    match device {
        RunningDevice::IosSim { udid, .. } => {
            let mut args = vec!["simctl".into(), "spawn".into(), udid.clone(), "log".into(), "stream".into(), "--level".into(), "debug".into()];
            if let Some(p) = ios_predicate(filter, app) {
                args.push("--predicate".into());
                args.push(p);
            }
            Command::new("xcrun").args(&args).status()?;
        }
        RunningDevice::IosPhysical { udid, .. } => {
            ensure_go_ios()?;
            ensure_tunnel()?;
            let base = format!("ios syslog --udid {udid}");
            let cmd = match app {
                Some(a) => format!("{base} | grep -i -- \"{a}\""),
                None => base,
            };
            Command::new("sh").arg("-c").arg(cmd).status()?;
        }
        RunningDevice::AndroidEmulator { serial, .. } | RunningDevice::AndroidPhysical { serial, .. } => {
            let adb = find_bin("adb");
            let mut args: Vec<String> = vec!["-s".into(), serial.clone(), "logcat".into()];
            if let Some(a) = app {
                if let Some(pid) = android_pid(&adb, serial, a) {
                    args.push(format!("--pid={pid}"));
                } else {
                    eprintln!("App \"{a}\" isn't running — showing all logs.");
                }
            }
            if let Some(f) = filter {
                args.push("-e".into());
                args.push(f.to_string());
            }
            Command::new(&adb).args(&args).status()?;
        }
    }
    Ok(())
}

fn android_pid(adb: &str, serial: &str, app: &str) -> Option<String> {
    let out = Command::new(adb).args(["-s", serial, "shell", "pidof", "-s", app]).output().ok()?;
    let pid = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if pid.is_empty() {
        None
    } else {
        Some(pid)
    }
}
