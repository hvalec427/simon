//! Physical-Android location mocking via a tiny helper APK driven over adb.
//! Mirrors the TypeScript `utils/androidmock.ts`.

use crate::android::find_bin;
use anyhow::{bail, Result};
use std::process::Command;

const PKG: &str = "dev.simon.mocklocation";
const ACTIVITY: &str = "dev.simon.mocklocation/.MockLocationActivity";
const APK_URL: &str = "https://raw.githubusercontent.com/hvalec427/simon/master/android/simon-mock-location.apk";

fn adb(serial: &str, args: &[&str]) -> Result<String> {
    let adb = find_bin("adb");
    let out = Command::new(&adb).arg("-s").arg(serial).args(args).output()?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn helper_installed(serial: &str) -> bool {
    adb(serial, &["shell", "pm", "list", "packages", PKG]).map(|o| o.contains(PKG)).unwrap_or(false)
}

fn install_helper(serial: &str) -> Result<()> {
    eprintln!("Installing the mock-location helper app...");
    let tmp = std::env::temp_dir().join("simon-mock-location.apk");
    let ok = Command::new("curl")
        .args(["-fsSL", APK_URL, "-o"])
        .arg(&tmp)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        bail!(
            "Mock-location helper setup failed: could not download the helper APK.\n\
             You can build it yourself: cd android && ./gradlew assembleDebug, then `adb install` the APK."
        );
    }
    adb(serial, &["install", "-r", &tmp.to_string_lossy()])?;
    Ok(())
}

pub fn set_android_device_location(serial: &str, lat: &str, lon: &str) -> Result<()> {
    if !helper_installed(serial) {
        install_helper(serial)?;
    }
    if adb(serial, &["shell", "appops", "set", PKG, "android:mock_location", "allow"]).is_err() {
        bail!("Could not enable mock locations. Turn on Developer Options on the device, then try again.");
    }
    // Best-effort runtime permission grants (some devices auto-grant/disallow).
    let _ = adb(serial, &["shell", "pm", "grant", PKG, "android.permission.ACCESS_FINE_LOCATION"]);
    let _ = adb(serial, &["shell", "pm", "grant", PKG, "android.permission.ACCESS_COARSE_LOCATION"]);
    adb(serial, &["shell", "am", "start", "-n", ACTIVITY, "--es", "lat", lat, "--es", "lon", lon])?;
    Ok(())
}

pub fn reset_android_device_location(serial: &str) -> Result<()> {
    if !helper_installed(serial) {
        return Ok(());
    }
    let _ = adb(serial, &["shell", "am", "start", "-n", ACTIVITY, "--ez", "stop", "true"]);
    Ok(())
}
