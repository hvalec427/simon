//! Send feedback to the feedbackBox service (`simon feedback`).
//! Request building and response parsing are pure functions; `send` is the
//! only part that touches the network.

use anyhow::{bail, Result};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::process::Command;
use std::time::Duration;

pub const DEFAULT_URL: &str = "https://feedbackbox.homelab.hvalec.com";
/// The ingest key baked in at build time (from `.env` locally, a repo secret in CI).
pub const BAKED_KEY: Option<&str> = option_env!("SIMON_FEEDBACK_KEY");

const UA: &str = "simon-cli";
const TIMEOUT: Duration = Duration::from_secs(15);
pub const TITLE_MAX: usize = 200;
pub const DESCRIPTION_MAX: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub url: String,
    pub key: String,
}

fn non_blank(v: Option<&str>) -> Option<String> {
    v.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Where to send and with which key: env overrides first, then the baked-in
/// key and the hardcoded URL.
pub fn resolve_config(env_url: Option<&str>, env_key: Option<&str>, baked_key: Option<&str>) -> Result<Config> {
    let url = non_blank(env_url).unwrap_or_else(|| DEFAULT_URL.to_string());
    let Some(key) = non_blank(env_key).or_else(|| non_blank(baked_key)) else {
        bail!(
            "Feedback isn't configured in this build of simon (no ingest key was baked in).\n\
             Set SIMON_FEEDBACK_KEY to an ingest key to send feedback anyway."
        );
    };
    Ok(Config { url, key })
}

/// The config from the environment and the baked-in key.
pub fn config() -> Result<Config> {
    let url = std::env::var("SIMON_FEEDBACK_URL").ok();
    let key = std::env::var("SIMON_FEEDBACK_KEY").ok();
    resolve_config(url.as_deref(), key.as_deref(), BAKED_KEY)
}

pub fn endpoint(base_url: &str) -> String {
    format!("{}/api/v1/feedback", base_url.trim_end_matches('/'))
}

/// The metadata attached to every report. Nothing beyond the tool and the
/// platform it runs on.
pub fn metadata(version: &str, channel: &str, os: &str, arch: &str, macos_version: Option<&str>) -> Value {
    let mut m = Map::new();
    m.insert("tool".into(), json!("simon"));
    m.insert("version".into(), json!(version));
    m.insert("channel".into(), json!(channel));
    m.insert("os".into(), json!(os));
    m.insert("arch".into(), json!(arch));
    if let Some(v) = macos_version {
        m.insert("macosVersion".into(), json!(v));
    }
    m.insert("source".into(), json!("cli"));
    Value::Object(m)
}

/// The metadata for the running binary.
pub fn current_metadata() -> Value {
    let macos = macos_version();
    metadata(&crate::update::current_version(), crate::update::current_channel().as_str(), std::env::consts::OS, std::env::consts::ARCH, macos.as_deref())
}

fn macos_version() -> Option<String> {
    let out = Command::new("sw_vers").arg("-productVersion").output().ok()?;
    if !out.status.success() {
        return None;
    }
    non_blank(Some(&String::from_utf8_lossy(&out.stdout)))
}

/// The request body, validated against the service's limits.
pub fn request_body(title: &str, description: &str, metadata: Value) -> Result<Value> {
    let title = title.trim();
    let description = description.trim();
    if title.is_empty() {
        bail!("A title is required.");
    }
    if title.chars().count() > TITLE_MAX {
        bail!("The title is too long ({} characters, max {TITLE_MAX}).", title.chars().count());
    }
    if description.chars().count() > DESCRIPTION_MAX {
        bail!("The description is too long ({} characters, max {DESCRIPTION_MAX}).", description.chars().count());
    }
    Ok(json!({ "title": title, "description": description, "metadata": metadata }))
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    #[serde(default)]
    pub id: String,
    pub number: u64,
    #[serde(default)]
    pub app_slug: String,
    pub url: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: String,
}

/// Interpret the service's reply: 201 with the created item, else `{error}`.
pub fn parse_response(status: u16, body: &str) -> Result<Created> {
    if (200..300).contains(&status) {
        return serde_json::from_str(body).map_err(|e| anyhow::anyhow!("Unexpected reply from feedbackBox ({status}): {e}"));
    }
    let detail = match serde_json::from_str::<ErrorBody>(body) {
        Ok(e) => e.error,
        Err(_) => {
            let t = body.trim();
            if t.is_empty() {
                "no details".to_string()
            } else {
                t.chars().take(200).collect()
            }
        }
    };
    let hint = match status {
        401 | 403 => " (the ingest key was rejected)",
        _ => "",
    };
    bail!("Sending feedback failed: {status}{hint}: {detail}")
}

/// POST the body to feedbackBox.
pub fn send(cfg: &Config, body: &Value) -> Result<Created> {
    let client = reqwest::blocking::Client::builder().user_agent(UA).timeout(TIMEOUT).build()?;
    let r = client
        .post(endpoint(&cfg.url))
        .bearer_auth(&cfg.key)
        .json(body)
        .send()
        .map_err(|e| anyhow::anyhow!("Could not reach feedbackBox at {}: {e}", cfg.url))?;
    let status = r.status().as_u16();
    let text = r.text()?;
    parse_response(status, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_prefers_env() {
        let c = resolve_config(Some("http://localhost:3000"), Some("fbi_env"), Some("fbi_baked")).unwrap();
        assert_eq!(c, Config { url: "http://localhost:3000".into(), key: "fbi_env".into() });
    }

    #[test]
    fn config_falls_back_to_baked_key_and_default_url() {
        let c = resolve_config(None, Some("  "), Some("fbi_baked")).unwrap();
        assert_eq!(c, Config { url: DEFAULT_URL.into(), key: "fbi_baked".into() });
    }

    #[test]
    fn config_without_key_errors() {
        let e = resolve_config(None, None, None).unwrap_err().to_string();
        assert!(e.contains("isn't configured in this build"), "{e}");
        assert!(resolve_config(None, Some(""), Some("")).is_err());
    }

    #[test]
    fn builds_endpoint() {
        assert_eq!(endpoint("https://feedbackbox.homelab.hvalec.com"), "https://feedbackbox.homelab.hvalec.com/api/v1/feedback");
        assert_eq!(endpoint("http://localhost:3000/"), "http://localhost:3000/api/v1/feedback");
    }

    #[test]
    fn metadata_has_only_the_agreed_fields() {
        let m = metadata("2.16.0", "stable", "macos", "aarch64", Some("15.1"));
        assert_eq!(m, json!({"tool":"simon","version":"2.16.0","channel":"stable","os":"macos","arch":"aarch64","macosVersion":"15.1","source":"cli"}));
        let m = metadata("2.16.0", "dev", "linux", "x86_64", None);
        assert!(m.get("macosVersion").is_none());
    }

    #[test]
    fn body_trims_and_validates() {
        let b = request_body("  Crash on launch \n", "\nsteps\n", json!({})).unwrap();
        assert_eq!(b, json!({"title":"Crash on launch","description":"steps","metadata":{}}));
        assert!(request_body("   ", "x", json!({})).is_err());
        assert!(request_body(&"a".repeat(TITLE_MAX), "", json!({})).is_ok());
        assert!(request_body(&"a".repeat(TITLE_MAX + 1), "", json!({})).is_err());
        assert!(request_body("t", &"d".repeat(DESCRIPTION_MAX + 1), json!({})).is_err());
    }

    #[test]
    fn parses_created() {
        let body = r#"{"id":"abc","number":7,"appSlug":"simon","url":"https://feedbackbox.homelab.hvalec.com/apps/simon/feedback/7","createdAt":"2026-11-10T10:00:00Z"}"#;
        let c = parse_response(201, body).unwrap();
        assert_eq!(c.number, 7);
        assert_eq!(c.app_slug, "simon");
        assert_eq!(c.url, "https://feedbackbox.homelab.hvalec.com/apps/simon/feedback/7");
    }

    #[test]
    fn parses_errors() {
        let e = parse_response(401, r#"{"error":"invalid key"}"#).unwrap_err().to_string();
        assert!(e.contains("401") && e.contains("ingest key was rejected") && e.contains("invalid key"), "{e}");
        let e = parse_response(502, "<html>Bad gateway</html>").unwrap_err().to_string();
        assert!(e.contains("502") && e.contains("Bad gateway"), "{e}");
        let e = parse_response(500, "").unwrap_err().to_string();
        assert!(e.contains("no details"), "{e}");
        assert!(parse_response(201, "not json").is_err());
    }
}
