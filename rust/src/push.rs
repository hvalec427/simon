//! FCM (HTTP v1 via service-account JWT) and APNs (ES256 JWT over HTTP/2)
//! senders. Mirrors the TypeScript `utils/fcm.ts`, `apns.ts`, `jwt.ts`.

use crate::pushconfig::{expand_path, ApnsConfig};
use anyhow::{bail, Result};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn ua_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().user_agent("simon-cli").build().expect("http client")
}

// ── FCM ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ServiceAccount {
    project_id: Option<String>,
    client_email: Option<String>,
    private_key: Option<String>,
    token_uri: Option<String>,
}

#[derive(Serialize)]
struct FcmClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

pub fn send_fcm(service_account_path: &str, token: &str, payload: Value) -> Result<()> {
    let raw = std::fs::read_to_string(expand_path(service_account_path))
        .map_err(|_| anyhow::anyhow!("Could not read the service-account file at {service_account_path}"))?;
    let sa: ServiceAccount = serde_json::from_str(&raw)?;
    let (project_id, client_email, private_key) = match (sa.project_id, sa.client_email, sa.private_key) {
        (Some(p), Some(c), Some(k)) => (p, c, k),
        _ => bail!("Service-account file is missing project_id, client_email, or private_key."),
    };
    let token_uri = sa.token_uri.unwrap_or_else(|| "https://oauth2.googleapis.com/token".into());

    let now = now_secs();
    let claims = FcmClaims { iss: &client_email, scope: FCM_SCOPE, aud: &token_uri, iat: now, exp: now + 3600 };
    let key = EncodingKey::from_rsa_pem(private_key.as_bytes()).map_err(|e| anyhow::anyhow!("bad service-account private_key: {e}"))?;
    let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)?;

    let client = ua_client();
    let auth = client
        .post(&token_uri)
        .form(&[("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"), ("assertion", &jwt)])
        .send()?;
    if !auth.status().is_success() {
        bail!("FCM auth failed ({}): {}", auth.status(), auth.text().unwrap_or_default().trim());
    }
    let access_token = auth
        .json::<Value>()?
        .get("access_token")
        .and_then(|t| t.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("FCM auth returned no access_token."))?;

    // Inject the token into the message body.
    let mut message = payload;
    if let Value::Object(ref mut map) = message {
        map.insert("token".into(), json!(token));
    } else {
        bail!("FCM payload must be a JSON object.");
    }

    let res = client
        .post(format!("https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"))
        .bearer_auth(&access_token)
        .json(&json!({ "message": message }))
        .send()?;
    if !res.status().is_success() {
        bail!("FCM send failed ({}): {}", res.status(), res.text().unwrap_or_default().trim());
    }
    Ok(())
}

// ── APNs ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ApnsClaims<'a> {
    iss: &'a str,
    iat: u64,
}

pub fn send_apns(cfg: &ApnsConfig, token: &str, aps: Value) -> Result<()> {
    let pem = std::fs::read_to_string(expand_path(&cfg.key_file))
        .map_err(|_| anyhow::anyhow!("Could not read the APNs key file at {}", cfg.key_file))?;
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(cfg.key_id.clone());
    let claims = ApnsClaims { iss: &cfg.team_id, iat: now_secs() };
    let key = EncodingKey::from_ec_pem(pem.as_bytes()).map_err(|e| anyhow::anyhow!("bad APNs key: {e}"))?;
    let jwt = encode(&header, &claims, &key)?;

    let host = if cfg.env.as_deref() == Some("production") { "api.push.apple.com" } else { "api.sandbox.push.apple.com" };
    // reqwest negotiates HTTP/2 via ALPN over TLS, which APNs requires.
    let res = ua_client()
        .post(format!("https://{host}/3/device/{token}"))
        .header("authorization", format!("bearer {jwt}"))
        .header("apns-topic", &cfg.bundle_id)
        .header("apns-push-type", "alert")
        .header("content-type", "application/json")
        .body(serde_json::to_string(&aps)?)
        .send()?;

    if res.status().as_u16() != 200 {
        let status = res.status();
        let body = res.text().unwrap_or_default();
        let reason = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("reason").and_then(|r| r.as_str()).map(String::from))
            .unwrap_or_else(|| body.trim().to_string());
        bail!("APNs send failed ({status}): {reason}");
    }
    Ok(())
}
