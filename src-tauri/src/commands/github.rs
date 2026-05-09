use crate::commands::identity::{get_or_create_hmac_secret, read_admin_key};
use crate::commands::worker_auth::{
    admin_sig, bugs_contents_path, bugs_contents_url, bugs_git_url, unix_now, user_sig,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;

// ---------------------------------------------------------------------------
// MegaWorker proxy — replaces direct GitHub PAT use as of v1.10.38.
//
// Public function signatures match the pre-Worker API so the rest of the
// codebase (bugs.rs, sync.rs, identity.rs, chat.rs) doesn't need to change.
// Internally each function now talks to https://mega-api.lordrik.workers.dev
// instead of api.github.com — the Worker holds the GitHub PAT server-side
// and forwards requests after verifying our HMAC for writes.
// ---------------------------------------------------------------------------

pub const USER_AGENT: &str = concat!("MegaLoad/", env!("CARGO_PKG_VERSION"));

#[derive(Deserialize, Debug)]
struct GitHubContent {
    sha: String,
    content: Option<String>,
    #[serde(default)]
    encoding: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GitHubBlob {
    content: String,
    encoding: String,
}

/// Fetch a blob's base64 content via the Worker's `/bugs/git/blobs/<sha>` proxy.
/// Used as a fallback for blobs >1 MB where the Contents API truncates.
fn github_get_blob_base64(sha: &str) -> Result<String, String> {
    let url = bugs_git_url(&format!("blobs/{}", sha));
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Worker blob GET failed for {}: {}", sha, e))?;

    let body = resp
        .into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let blob: GitHubBlob = serde_json::from_str(&body)
        .map_err(|e| format!("Parse error for blob {}: {}", sha, e))?;
    if blob.encoding != "base64" {
        return Err(format!(
            "Unexpected blob encoding '{}' for sha {}",
            blob.encoding, sha
        ));
    }
    Ok(blob.content.replace('\n', "").replace('\r', ""))
}

/// Read a file from the MegaBugs repo via the Worker. Returns (decoded_content, sha).
pub fn github_get_file(path: &str) -> Result<(String, String), String> {
    let url = bugs_contents_url(path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Worker GET failed for {}: {}", path, e))?;

    let body = resp
        .into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let gc: GitHubContent =
        serde_json::from_str(&body).map_err(|e| format!("Parse error for {}: {}", path, e))?;

    let raw = gc
        .content
        .clone()
        .unwrap_or_default()
        .replace('\n', "")
        .replace('\r', "");

    // Contents API truncates blobs >1 MB: content is empty and encoding is "none".
    let encoding_is_base64 = gc
        .encoding
        .as_deref()
        .map(|e| e.eq_ignore_ascii_case("base64"))
        .unwrap_or(false);
    let raw = if raw.is_empty() || !encoding_is_base64 {
        github_get_blob_base64(&gc.sha)?
    } else {
        raw
    };

    let decoded = B64
        .decode(&raw)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    let text = String::from_utf8(decoded).map_err(|e| format!("UTF-8 error: {}", e))?;
    Ok((text, gc.sha))
}

/// Sign and send a PUT request to /bugs/contents/<path>. Body is the
/// JSON-serialised GitHub Contents API payload.
fn signed_put(path: &str, body: &str) -> Result<ureq::Response, String> {
    let (user_id, secret) = get_or_create_hmac_secret()?;
    let ts = unix_now();
    let sig = user_sig(&secret, "PUT", &bugs_contents_path(path), &ts, body.as_bytes())?;

    crate::commands::http::agent()
        .put(&bugs_contents_url(path))
        .set("User-Agent", USER_AGENT)
        .set("Content-Type", "application/json")
        .set("X-MegaLoad-User", &user_id)
        .set("X-MegaLoad-Timestamp", &ts)
        .set("X-MegaLoad-Sig", &sig)
        .send_string(body)
        .map_err(|e| format!("Worker PUT failed for {}: {}", path, e))
}

/// Sign and send a DELETE request. Uses admin HMAC if the local admin key
/// file is present; otherwise user HMAC. Worker accepts either.
fn signed_delete(path: &str, body: &str) -> Result<ureq::Response, String> {
    let ts = unix_now();
    let canonical_path = bugs_contents_path(path);
    let mut req = crate::commands::http::agent()
        .delete(&bugs_contents_url(path))
        .set("User-Agent", USER_AGENT)
        .set("Content-Type", "application/json")
        .set("X-MegaLoad-Timestamp", &ts);

    if let Some(admin_key) = read_admin_key() {
        let sig = admin_sig(&admin_key, "DELETE", &canonical_path, &ts, body.as_bytes())?;
        req = req.set("X-MegaLoad-Admin-Sig", &sig);
    } else {
        let (user_id, secret) = get_or_create_hmac_secret()?;
        let sig = user_sig(&secret, "DELETE", &canonical_path, &ts, body.as_bytes())?;
        req = req
            .set("X-MegaLoad-User", &user_id)
            .set("X-MegaLoad-Sig", &sig);
    }

    req.send_string(body)
        .map_err(|e| format!("Worker DELETE failed for {}: {}", path, e))
}

/// Create or update a file in the MegaBugs repo via the Worker.
pub fn github_put_file(
    path: &str,
    content: &[u8],
    message: &str,
    sha: Option<&str>,
) -> Result<String, String> {
    let encoded = B64.encode(content);
    let mut body = serde_json::json!({
        "message": message,
        "content": encoded,
    });
    if let Some(s) = sha {
        body["sha"] = serde_json::Value::String(s.to_string());
    }

    let resp = signed_put(path, &body.to_string())?;
    let resp_body = resp
        .into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&resp_body).map_err(|e| format!("Parse error: {}", e))?;
    let new_sha = parsed["content"]["sha"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(new_sha)
}

/// Returns true if a `github_put_file` error is a 409 Conflict — i.e. the SHA
/// we passed is stale because another client pushed a newer commit since we
/// fetched. The caller should refresh the SHA (via a fresh `github_get_file`)
/// and retry.
pub fn is_conflict_error(err: &str) -> bool {
    err.contains("409")
}

/// PUT a file with automatic 409 retry. Same shape as the pre-Worker version.
pub fn github_put_file_with_retry<F>(
    path: &str,
    message: &str,
    max_attempts: u32,
    mut prepare: F,
) -> Result<String, String>
where
    F: FnMut(u32) -> Result<(Vec<u8>, Option<String>), String>,
{
    let mut last_err = String::new();
    for attempt in 1..=max_attempts {
        let (content, sha) = prepare(attempt)?;
        match github_put_file(path, &content, message, sha.as_deref()) {
            Ok(new_sha) => return Ok(new_sha),
            Err(e) if is_conflict_error(&e) && attempt < max_attempts => {
                last_err = e;
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err(format!("PUT exhausted retries for {}: {}", path, last_err))
}

/// List files in a repo directory via the Worker.
pub fn github_list_dir(path: &str) -> Result<Vec<(String, String)>, String> {
    let url = bugs_contents_url(path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Worker GET dir failed for {}: {}", path, e))?;

    let body = resp
        .into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let items: Vec<serde_json::Value> = serde_json::from_str(&body)
        .map_err(|e| format!("Parse error for dir {}: {}", path, e))?;

    Ok(items
        .iter()
        .filter_map(|item| {
            let p = item["path"].as_str()?.to_string();
            let s = item["sha"].as_str()?.to_string();
            Some((p, s))
        })
        .collect())
}

/// Delete a file from the MegaBugs repo via the Worker.
pub fn github_delete_file(path: &str, sha: &str, message: &str) -> Result<(), String> {
    let body = serde_json::json!({
        "message": message,
        "sha": sha,
    })
    .to_string();
    signed_delete(path, &body)?;
    Ok(())
}

/// Read a file's raw base64 content without decoding. Used for binary attachments.
pub fn github_get_raw_base64(path: &str) -> Result<String, String> {
    let url = bugs_contents_url(path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Worker GET failed for {}: {}", path, e))?;

    let body = resp
        .into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let gc: GitHubContent =
        serde_json::from_str(&body).map_err(|e| format!("Parse error for {}: {}", path, e))?;

    let raw = gc
        .content
        .clone()
        .unwrap_or_default()
        .replace('\n', "")
        .replace('\r', "");

    let encoding_is_base64 = gc
        .encoding
        .as_deref()
        .map(|e| e.eq_ignore_ascii_case("base64"))
        .unwrap_or(false);
    if raw.is_empty() || !encoding_is_base64 {
        return github_get_blob_base64(&gc.sha);
    }

    Ok(raw)
}
