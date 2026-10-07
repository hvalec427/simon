//! Push credential config (`~/.config/simon/push.json`). Mirrors the TypeScript
//! `utils/pushconfig.ts`.

use anyhow::{bail, Result};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct FcmConfig {
    #[serde(rename = "serviceAccount")]
    pub service_account: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApnsConfig {
    #[serde(rename = "keyFile")]
    pub key_file: String,
    #[serde(rename = "keyId")]
    pub key_id: String,
    #[serde(rename = "teamId")]
    pub team_id: String,
    #[serde(rename = "bundleId")]
    pub bundle_id: String,
    #[serde(default)]
    pub env: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PushConfig {
    #[serde(default)]
    pub transport: Option<String>,
    #[serde(default)]
    pub fcm: Option<FcmConfig>,
    #[serde(default)]
    pub apns: Option<ApnsConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Fcm,
    Apns,
}

pub fn push_config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".config/simon/push.json")
}

pub fn load_push_config() -> Result<Option<PushConfig>> {
    let p = push_config_path();
    if !p.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&p)?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|_| anyhow::anyhow!("Could not parse {} — is it valid JSON?", p.display()))
}

/// Pick the transport from an explicit override, else the config's default, else
/// whichever block is present.
pub fn resolve_transport(cfg: &PushConfig, override_t: Option<Transport>) -> Result<Transport> {
    let want = override_t.or_else(|| match cfg.transport.as_deref() {
        Some("fcm") => Some(Transport::Fcm),
        Some("apns") => Some(Transport::Apns),
        _ => None,
    });
    match want {
        Some(Transport::Fcm) => {
            if cfg.fcm.is_none() {
                bail!("FCM selected but there is no \"fcm\" block in push.json.");
            }
            Ok(Transport::Fcm)
        }
        Some(Transport::Apns) => {
            if cfg.apns.is_none() {
                bail!("APNs selected but there is no \"apns\" block in push.json.");
            }
            Ok(Transport::Apns)
        }
        None => {
            if cfg.fcm.is_some() && cfg.apns.is_some() {
                bail!("Both fcm and apns are configured — choose with --fcm or --apns, or set \"transport\" in push.json.");
            }
            if cfg.fcm.is_some() {
                Ok(Transport::Fcm)
            } else if cfg.apns.is_some() {
                Ok(Transport::Apns)
            } else {
                bail!("push.json has neither an \"fcm\" nor an \"apns\" block.")
            }
        }
    }
}

/// Expand a leading `~` and resolve to an absolute path.
pub fn expand_path(p: &str) -> PathBuf {
    let expanded = if let Some(rest) = p.strip_prefix('~') {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}{rest}")
    } else {
        p.to_string()
    };
    std::fs::canonicalize(&expanded).unwrap_or_else(|_| PathBuf::from(expanded))
}
