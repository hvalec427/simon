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
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::List { ios, android } => commands::list::run(ios, android),
        Command::Running => commands::running::run(),
    }
}
