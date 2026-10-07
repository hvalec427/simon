use crate::android::{find_bin, sdk_root};
use crate::update::{current_version, latest_for_channel, load_channel};
use std::process::Command;

enum Status {
    Ok,
    Warn,
    Fail,
}

struct Check {
    status: Status,
    label: String,
    detail: Option<String>,
    fix: Option<String>,
}

fn try_exec(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

fn xcode_check() -> Check {
    match try_exec("xcode-select", &["-p"]) {
        None => Check { status: Status::Fail, label: "Xcode".into(), detail: Some("not found".into()), fix: Some("xcode-select --install".into()) },
        Some(dir) if dir.contains("CommandLineTools") => Check {
            status: Status::Warn,
            label: "Xcode".into(),
            detail: Some("Command Line Tools only (no full Xcode)".into()),
            fix: Some("Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app".into()),
        },
        Some(dir) => Check { status: Status::Ok, label: "Xcode".into(), detail: Some(dir), fix: None },
    }
}

fn xcrun_tool(tool: &str, warn_if_missing: bool, fix: Option<&str>) -> Check {
    match try_exec("xcrun", &["-f", tool]) {
        Some(p) => Check { status: Status::Ok, label: tool.into(), detail: Some(p), fix: None },
        None => Check {
            status: if warn_if_missing { Status::Warn } else { Status::Fail },
            label: tool.into(),
            detail: Some("not found".into()),
            fix: fix.map(String::from),
        },
    }
}

fn android_sdk_check() -> Check {
    let root = sdk_root();
    if root.exists() {
        Check { status: Status::Ok, label: "Android SDK".into(), detail: Some(root.to_string_lossy().into()), fix: None }
    } else {
        Check {
            status: Status::Fail,
            label: "Android SDK".into(),
            detail: Some(format!("not found at {}", root.display())),
            fix: Some("Install the Android SDK or set ANDROID_HOME".into()),
        }
    }
}

fn adb_check() -> Check {
    match try_exec(&find_bin("adb"), &["version"]) {
        Some(v) => Check { status: Status::Ok, label: "adb".into(), detail: v.lines().next().map(String::from), fix: None },
        None => Check { status: Status::Fail, label: "adb".into(), detail: Some("not found".into()), fix: Some("Install platform-tools (Android SDK)".into()) },
    }
}

fn emulator_check() -> Check {
    let emu = find_bin("emulator");
    if std::path::Path::new(&emu).exists() {
        Check { status: Status::Ok, label: "emulator".into(), detail: Some(emu), fix: None }
    } else {
        Check { status: Status::Warn, label: "emulator".into(), detail: Some("not found".into()), fix: Some("Install the emulator package via SDK Manager".into()) }
    }
}

fn version_check() -> Check {
    let current = current_version();
    let channel = load_channel();
    match latest_for_channel(channel) {
        Ok(latest) if latest.version != current => Check {
            status: Status::Warn,
            label: "simon".into(),
            detail: Some(format!("{current} (latest {} {})", channel.as_str(), latest.version)),
            fix: Some("simon update".into()),
        },
        Ok(_) => Check { status: Status::Ok, label: "simon".into(), detail: Some(format!("{current} (latest {})", channel.as_str())), fix: None },
        Err(_) => Check { status: Status::Warn, label: "simon".into(), detail: Some(format!("{current} (couldn't reach GitHub to check)")), fix: None },
    }
}

fn icon(s: &Status) -> &'static str {
    match s {
        Status::Ok => "✓",
        Status::Warn => "!",
        Status::Fail => "✗",
    }
}

fn print_check(c: &Check) {
    println!("  {}  {}{}", icon(&c.status), c.label, c.detail.as_deref().map(|d| format!("  {d}")).unwrap_or_default());
    if let Some(fix) = &c.fix {
        if !matches!(c.status, Status::Ok) {
            println!("       → {fix}");
        }
    }
}

pub fn run() {
    println!("\niOS\n{}", "─".repeat(50));
    for c in [xcode_check(), xcrun_tool("simctl", false, None), xcrun_tool("devicectl", true, Some("Needs full Xcode (for physical iOS devices)"))] {
        print_check(&c);
    }

    println!("\nAndroid\n{}", "─".repeat(50));
    for c in [android_sdk_check(), adb_check(), emulator_check()] {
        print_check(&c);
    }

    println!("\nGeneral\n{}", "─".repeat(50));
    print_check(&version_check());
    println!();
}
