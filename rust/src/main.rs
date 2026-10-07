//! simon — manage iOS simulators, Android emulators, and physical devices.
//!
//! Rust port, in progress. Commands are being migrated from the TypeScript
//! implementation one slice at a time; `todo!`-style stubs mark what's pending.

mod android;
mod commands;
mod devices;
mod ios;

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
    }
}
