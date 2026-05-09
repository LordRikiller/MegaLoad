use crate::commands::app_log::app_log;
use crate::commands::identity::get_or_create_hmac_secret;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

pub const WORKER_BASE: &str = "https://mega-api.lordrik.workers.dev";

/// Current Unix time in seconds, as a string. Worker rejects timestamps that
/// are more than 5 min off its own clock.
pub fn unix_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn sha256_hex(body: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(body);
    hex::encode(h.finalize())
}

/// Canonical request string the Worker expects:
///   METHOD\nPATH\nTIMESTAMP\nSHA256_HEX(BODY)
fn canonical_request(method: &str, path: &str, ts: &str, body: &[u8]) -> String {
    format!("{}\n{}\n{}\n{}", method, path, ts, sha256_hex(body))
}

fn hmac_sha256_hex(secret: &str, data: &str) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("HMAC init failed: {}", e))?;
    mac.update(data.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

/// Compute the per-user signature for a write request.
pub fn user_sig(secret: &str, method: &str, path: &str, ts: &str, body: &[u8]) -> Result<String, String> {
    hmac_sha256_hex(secret, &canonical_request(method, path, ts, body))
}

/// Compute the owner (admin) signature for an owner-only request.
pub fn admin_sig(admin_key: &str, method: &str, path: &str, ts: &str, body: &[u8]) -> Result<String, String> {
    hmac_sha256_hex(admin_key, &canonical_request(method, path, ts, body))
}

/// Build a /bugs/contents/<path> URL.
pub fn bugs_contents_url(path: &str) -> String {
    format!("{}/bugs/contents/{}", WORKER_BASE, path)
}

/// Build a /bugs/git/<sub> URL.
pub fn bugs_git_url(sub: &str) -> String {
    format!("{}/bugs/git/{}", WORKER_BASE, sub)
}

/// Build the path component (METHOD\nPATH\n...) that the Worker validates.
/// MUST match the URL's pathname exactly.
pub fn bugs_contents_path(path: &str) -> String {
    format!("/bugs/contents/{}", path)
}

/// Register this install's HMAC secret with the Worker. Idempotent. Best-effort
/// — failures are logged but don't crash. Called once on app launch.
pub fn register_with_worker() -> Result<(), String> {
    let (user_id, secret) = get_or_create_hmac_secret()?;
    let body = serde_json::json!({
        "user_id": user_id,
        "hmac_secret": secret,
    })
    .to_string();
    let url = format!("{}/register", WORKER_BASE);
    let resp = crate::commands::http::agent()
        .post(&url)
        .set("Content-Type", "application/json")
        .set("User-Agent", concat!("MegaLoad/", env!("CARGO_PKG_VERSION")))
        .send_string(&body)
        .map_err(|e| format!("Register failed: {}", e))?;
    if resp.status() == 201 || resp.status() == 200 {
        app_log(&format!("Registered with MegaWorker as {}", user_id));
        Ok(())
    } else {
        Err(format!("Register returned status {}", resp.status()))
    }
}

/// Try to register on launch, log on failure but never abort.
pub fn register_with_worker_best_effort() {
    if let Err(e) = register_with_worker() {
        app_log(&format!("MegaWorker registration skipped: {}", e));
    }
}
