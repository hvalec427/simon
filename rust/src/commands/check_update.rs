use crate::update::*;
use std::cmp::Ordering;

pub fn run(stable: bool, nightly: bool, dev: bool) {
    if !platform_supported() {
        eprintln!("simon self-update is macOS-only (arm64/x64). Build from source on other platforms.");
        std::process::exit(1);
    }
    let channel = if dev {
        Channel::Dev
    } else if nightly {
        Channel::Nightly
    } else if stable {
        Channel::Stable
    } else {
        load_channel()
    };
    let current = current_version();

    let latest = match latest_for_channel(channel) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };

    let cmp = compare_versions(&latest.version, &current);
    println!("Channel:   {}", channel.as_str());
    println!("Installed: {current}");
    println!("Latest:    {}", latest.version);

    match cmp {
        Ordering::Equal => {
            println!("\nYou're up to date.");
        }
        Ordering::Less => {
            println!("\nThe latest {} build ({}) is older than your installed version.", channel.as_str(), latest.version);
            if stable || nightly || dev {
                let flag = if dev { " --dev" } else if nightly { " --nightly" } else { " --stable" };
                println!("Run `simon update{flag}` to switch to the {} channel (installs {}).", channel.as_str(), latest.version);
            }
        }
        Ordering::Greater => {
            if let Some(notes) = changelog_since(channel, &current) {
                println!("\nWhat's new ({current} → {}):\n{notes}", latest.version);
            }
            let flag = if dev { " --dev" } else if nightly { " --nightly" } else if stable { " --stable" } else { "" };
            println!("\nRun `simon update{flag}` to install.");
        }
    }
}
