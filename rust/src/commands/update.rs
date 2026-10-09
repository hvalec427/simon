use crate::update::*;
use std::cmp::Ordering;

pub fn run(stable: bool, nightly: bool, dev: bool, force: bool) {
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
        current_channel()
    };
    let switched = channel != current_channel();
    let current = current_version();

    let latest = match latest_for_channel(channel) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };

    let cmp = compare_versions(&latest.version, &current);
    if cmp == Ordering::Equal && !force {
        println!("Already on the latest {} version ({current}).", channel.as_str());
        return;
    }
    if cmp == Ordering::Less && !switched && !force {
        println!("The latest {} build ({}) is older than your installed {current} — not downgrading.", channel.as_str(), latest.version);
        println!("`simon update` will pick it up once a newer {} build is published, or use --force.", channel.as_str());
        return;
    }

    if cmp == Ordering::Less {
        println!("Installing {} ({}) — older than your current {current}{}.", latest.version, channel.as_str(), if switched { "" } else { ", forced" });
    } else if cmp == Ordering::Equal {
        println!("Reinstalling {} ({})...", latest.version, channel.as_str());
    } else {
        println!("Updating {current} → {} ({})...", latest.version, channel.as_str());
        if let Some(notes) = changelog_since(channel, &current) {
            println!("\nWhat's new ({current} → {}):\n{notes}\n", latest.version);
        }
    }

    let tmp = match download_binary(&latest.tag) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let target = install_target();
    let sudo_note = if needs_sudo(&target) { " (needs sudo — may prompt for your password)" } else { "" };
    println!("Installing to {}{sudo_note}...", target.display());
    if let Err(e) = install_binary(&tmp, &target) {
        eprintln!("{e}");
        std::process::exit(1);
    }
    let verb = match cmp {
        Ordering::Less => "Installed",
        Ordering::Equal => "Reinstalled",
        Ordering::Greater => "Updated to",
    };
    println!("{verb} {} ({}).", latest.version, channel.as_str());
}
