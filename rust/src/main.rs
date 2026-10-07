//! simon — manage iOS simulators, Android emulators, and physical devices.
//!
//! Rust port, in progress. Commands are being migrated from the TypeScript
//! implementation one slice at a time; `todo!`-style stubs mark what's pending.

mod android;
mod androidmock;
mod commands;
mod devices;
mod goios;
mod ios;
mod update;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "simon", version, about = "Manage iOS simulators and Android emulators")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}


#[derive(Subcommand)]
enum Command {
    /// List all simulators and emulators
    List {
        /// Limit to iOS
        #[arg(short, long)]
        ios: bool,
        /// Limit to Android
        #[arg(short, long)]
        android: bool,
    },
    /// Show currently running simulators and emulators
    Running,
    /// Launch a simulator or emulator (picks from a list if no flag/name given)
    Launch {
        name: Option<String>,
        /// Limit to iOS (optionally name a simulator)
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        ios: Option<String>,
        /// Limit to Android (optionally name an emulator)
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        android: Option<String>,
    },
    /// Stop a running simulator or emulator
    Stop {
        name: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        ios: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        android: Option<String>,
    },
    /// Delete a simulator or emulator
    Delete {
        name: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        ios: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        android: Option<String>,
    },
    /// Erase all data on a simulator or emulator
    Wipe {
        name: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        ios: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        android: Option<String>,
    },
    /// Open a deep link on a running simulator, emulator, or physical device
    #[command(name = "open-link")]
    OpenLink {
        url: String,
        name: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        ios: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        android: Option<String>,
        /// Deliver straight to this app instead of routing via Safari (physical iOS)
        #[arg(short, long)]
        bundle_id: Option<String>,
        /// Cold-relaunch the app instead of warm-foregrounding it (physical iOS)
        #[arg(short, long)]
        restart: bool,
    },
    /// Set a simulated GPS location (coords as "lat,lon")
    Location {
        #[arg(allow_hyphen_values = true)]
        coords: Option<String>,
        name: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        ios: Option<String>,
        #[arg(short, long, num_args = 0..=1, default_missing_value = "")]
        android: Option<String>,
        /// Clear the simulated location
        #[arg(short, long)]
        reset: bool,
    },
    /// Manage the iOS developer tunnel (start | stop | status)
    Tunnel { action: Option<String> },
    /// Check your environment for the required tooling
    Doctor,
    /// Check whether a newer version of simon is available
    #[command(name = "check-update")]
    CheckUpdate {
        #[arg(long)]
        stable: bool,
        #[arg(long)]
        nightly: bool,
        #[arg(long)]
        dev: bool,
    },
    /// Update simon to the latest version (remembers the channel)
    Update {
        #[arg(long)]
        stable: bool,
        #[arg(long)]
        nightly: bool,
        #[arg(long)]
        dev: bool,
        /// Install the channel's latest even if it's the same or an older version
        #[arg(long)]
        force: bool,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::List { ios, android } => commands::list::run(ios, android),
        Command::Running => commands::running::run(),
        Command::Launch { ios, android, name } => commands::launch::run(ios, android, name),
        Command::Stop { ios, android, name } => commands::stop::run(ios, android, name),
        Command::Delete { ios, android, name } => commands::delete::run(ios, android, name),
        Command::Wipe { ios, android, name } => commands::wipe::run(ios, android, name),
        Command::OpenLink { url, name, ios, android, bundle_id, restart } => {
            commands::open_link::run(url, name, ios, android, bundle_id, restart)
        }
        Command::Location { coords, name, ios, android, reset } => {
            commands::location::run(coords, name, ios, android, reset)
        }
        Command::Tunnel { action } => commands::tunnel::run(action),
        Command::Doctor => commands::doctor::run(),
        Command::CheckUpdate { stable, nightly, dev } => commands::check_update::run(stable, nightly, dev),
        Command::Update { stable, nightly, dev, force } => commands::update::run(stable, nightly, dev, force),
    }
}
