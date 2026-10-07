use crate::devices::{get_all_running, RunningDevice};
use crate::push::{send_apns, send_fcm};
use crate::pushconfig::{load_push_config, push_config_path, resolve_transport, Transport};
use inquire::Select;
use serde_json::{json, Value};
use std::process::Command;

fn aps_template() -> Value {
    json!({
        "aps": { "alert": { "title": "Notification title", "body": "Notification body" }, "sound": "default", "badge": 1 },
        "custom_data_1": "value1",
        "custom_data_2": "value2"
    })
}

fn fcm_template() -> Value {
    json!({
        "notification": { "title": "Notification title", "body": "Notification body" },
        "data": { "custom_data_1": "value1", "custom_data_2": "value2" },
        "apns": { "payload": { "aps": { "sound": "default", "badge": 1 } } }
    })
}

fn print_template(fcm: bool) {
    let t = if fcm { fcm_template() } else { aps_template() };
    println!("{}", serde_json::to_string_pretty(&t).unwrap());
}

pub fn run(payload: Option<String>, ios: Option<String>, bundle_id: Option<String>, template: bool, token: Option<String>, fcm: bool, apns: bool) {
    if template {
        print_template(fcm);
        return;
    }
    let payload = match payload {
        Some(p) => p,
        None => {
            eprintln!("Provide a payload file, or use --template to print an example.");
            std::process::exit(1);
        }
    };
    if !std::path::Path::new(&payload).exists() {
        eprintln!("Payload file not found: {payload}");
        std::process::exit(1);
    }

    let res = if let Some(tok) = token {
        send_to_token(&payload, &tok, fcm, apns)
    } else {
        send_to_simulator(&payload, ios, bundle_id)
    };
    if let Err(e) = res {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn send_to_token(payload: &str, token: &str, fcm: bool, apns: bool) -> anyhow::Result<()> {
    let cfg = load_push_config()?;
    let cfg = match cfg {
        Some(c) => c,
        None => {
            anyhow::bail!("No push config found at {}.\nCreate it from a template in the README (FCM or APNs).", push_config_path().display());
        }
    };
    let override_t = if fcm { Some(Transport::Fcm) } else if apns { Some(Transport::Apns) } else { None };
    let transport = resolve_transport(&cfg, override_t)?;
    let body: Value = serde_json::from_str(&std::fs::read_to_string(payload)?)
        .map_err(|_| anyhow::anyhow!("Could not parse {payload} as JSON."))?;

    match transport {
        Transport::Fcm => {
            eprintln!("Sending via FCM...");
            send_fcm(&cfg.fcm.unwrap().service_account, token, body)?;
            println!("Push sent via FCM.");
        }
        Transport::Apns => {
            eprintln!("Sending via APNs...");
            send_apns(&cfg.apns.unwrap(), token, body)?;
            println!("Push sent via APNs.");
        }
    }
    Ok(())
}

fn send_to_simulator(payload: &str, ios: Option<String>, bundle_id: Option<String>) -> anyhow::Result<()> {
    let name = ios.filter(|s| !s.is_empty());
    let sims: Vec<RunningDevice> = get_all_running(None)
        .into_iter()
        .filter(|d| matches!(d, RunningDevice::IosSim { .. }))
        .collect();

    if sims.is_empty() {
        anyhow::bail!("No iOS simulators running.\nBoot one with `simon launch -i`.");
    }

    let device = if let Some(n) = &name {
        sims.into_iter()
            .find(|d| d.name() == n || d.udid() == Some(n.as_str()))
            .ok_or_else(|| anyhow::anyhow!("iOS simulator \"{n}\" not found or not running."))?
    } else if sims.len() == 1 {
        sims.into_iter().next().unwrap()
    } else {
        Select::new("Select a simulator to push to:", sims).prompt().map_err(|_| anyhow::anyhow!("cancelled"))?
    };

    let udid = device.udid().unwrap_or("");
    let mut cmd = Command::new("xcrun");
    cmd.args(["simctl", "push", udid]);
    if let Some(b) = &bundle_id {
        cmd.arg(b);
    }
    cmd.arg(payload);
    let out = cmd.output()?;
    if !out.status.success() {
        anyhow::bail!(
            "{}\nIf the payload has no \"Simulator Target Bundle\" key, pass the app with -b <bundle-id>.",
            String::from_utf8_lossy(&out.stderr).trim().to_string()
        );
    }
    println!("Pushed to {}.", device.name());
    Ok(())
}
