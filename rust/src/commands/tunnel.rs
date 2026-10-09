use crate::goios::{ensure_go_ios, ensure_tunnel, stop_tunnel, tunnel_running};

pub fn run(action: Option<String>) {
    let act = action.unwrap_or_else(|| "status".to_string());
    let result: anyhow::Result<()> = (|| {
        match act.as_str() {
            "status" => {
                println!("iOS developer tunnel: {}", if tunnel_running() { "running" } else { "not running" });
            }
            "start" => {
                ensure_go_ios()?;
                if tunnel_running() {
                    println!("Tunnel already running.");
                } else {
                    ensure_tunnel()?;
                    println!("Tunnel started.");
                }
            }
            "stop" => {
                println!("{}", if stop_tunnel() { "Tunnel stopped." } else { "No tunnel was running." });
            }
            other => anyhow::bail!("Unknown action \"{other}\". Use: start, stop, or status."),
        }
        Ok(())
    })();
    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
