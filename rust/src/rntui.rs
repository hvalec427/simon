//! Interactive `logs --rn` TUI (ratatui). Ported in a follow-up step; for now it
//! falls back to the plain stream so the command works end-to-end.

pub fn run(port: u16, name: Option<&str>) -> anyhow::Result<()> {
    crate::rn::stream_plain(port, name)
}
