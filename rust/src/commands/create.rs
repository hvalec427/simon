use crate::{android, ios};
use inquire::{Select, Text};

pub fn run(ios_flag: bool, android_flag: bool) {
    let target = if ios_flag {
        "ios"
    } else if android_flag {
        "android"
    } else {
        match Select::new("What do you want to create?", vec!["iOS simulator", "Android emulator"]).prompt() {
            Ok("iOS simulator") => "ios",
            Ok(_) => "android",
            Err(_) => return,
        }
    };

    let res = if target == "ios" { create_ios() } else { create_android() };
    if let Err(e) = res {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn create_ios() -> anyhow::Result<()> {
    let device_types = ios::list_device_types();
    if device_types.is_empty() {
        anyhow::bail!("No device types found. Make sure Xcode is installed.");
    }
    let runtimes = ios::list_runtimes();
    if runtimes.is_empty() {
        anyhow::bail!("No iOS runtimes found. Install one via Xcode → Settings → Platforms.");
    }

    let device = Select::new("Select device:", device_types).prompt().map_err(|_| anyhow::anyhow!("cancelled"))?;
    let runtime = Select::new("Select iOS version:", runtimes).prompt().map_err(|_| anyhow::anyhow!("cancelled"))?;

    let default_name = format!("{} ({})", device.name, runtime.version);
    let name = Text::new("Simulator name:").with_default(&default_name).prompt().map_err(|_| anyhow::anyhow!("cancelled"))?;

    println!("\nCreating \"{name}\"...");
    let udid = ios::create_simulator(&name, &device.identifier, &runtime.identifier)?;
    println!("Done — {name}");
    println!("UDID: {udid}");
    Ok(())
}

fn create_android() -> anyhow::Result<()> {
    let devices = android::list_device_definitions();
    if devices.is_empty() {
        anyhow::bail!("No device definitions found. Make sure Android SDK cmdline-tools are installed.");
    }
    let images = android::list_installed_system_images();
    if images.is_empty() {
        anyhow::bail!("No system images found. Install one via Android Studio → SDK Manager.");
    }

    let device = Select::new("Select device:", devices).prompt().map_err(|_| anyhow::anyhow!("cancelled"))?;
    let image = Select::new("Select Android version:", images).prompt().map_err(|_| anyhow::anyhow!("cancelled"))?;

    let default_name = format!("{} API {}", device.name, image.api).replace(' ', "_");
    let name = Text::new("Emulator name:")
        .with_default(&default_name)
        .with_validator(|v: &str| {
            if v.contains(' ') {
                Ok(inquire::validator::Validation::Invalid("AVD names cannot contain spaces".into()))
            } else {
                Ok(inquire::validator::Validation::Valid)
            }
        })
        .prompt()
        .map_err(|_| anyhow::anyhow!("cancelled"))?;

    println!("\nCreating \"{name}\"...");
    android::create_avd(&name, &device.id, &image.package)?;
    println!("Done — {name}");
    Ok(())
}
