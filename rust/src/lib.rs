//! simon — library surface for managing iOS simulators, Android emulators, and
//! physical devices. The `simon` binary (src/main.rs) is a thin CLI over this;
//! `metroctl` depends on this crate for device management.

pub mod android;
pub mod androidmock;
pub mod commands;
pub mod devices;
pub mod goios;
pub mod ios;
pub mod push;
pub mod pushconfig;
pub mod update;
