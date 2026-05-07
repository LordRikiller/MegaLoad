use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// GitHub token — XOR-obfuscated at compile time
// Set MEGABUGS_TOKEN_OBF env var before building, or leave blank for dev.
// ---------------------------------------------------------------------------
const OBFUSCATION_KEY: u8 = 0xAB;

pub const REPO: &str = "LordRikiller/MegaBugs";
pub const USER_AGENT: &str = concat!("MegaLoad/", env!("CARGO_PKG_VERSION"));

fn get_github_token() -> Option<String> {
    let obfuscated: &[u8] = match option_env!("MEGABUGS_TOKEN_OBF") {
        Some(s) => s.as_bytes(),
        None => return None,
    };
    let bytes: Vec<u8> = (0..obfuscated.len() / 2)
        .filter_map(|i| {
            u8::from_str_radix(
                &String::from_utf8_lossy(&obfuscated[i * 2..i * 2 + 2]),
                16,
            )
            .ok()
        })
        .map(|b| b ^ OBFUSCATION_KEY)
        .collect();
    String::from_utf8(bytes).ok()
}

fn get_github_token_dev() -> Option<String> {
    let home = std::env::var("USERPROFILE").ok()?;
    let path = Path::new(&home).join(".megaload").join("megabugs-token");
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

pub fn github_token() -> Result<String, String> {
    get_github_token()
        .or_else(get_github_token_dev)
        .ok_or_else(|| "No GitHub token configured".to_string())
}

// ---------------------------------------------------------------------------
// GitHub Contents API helpers
// ---------------------------------------------------------------------------

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

/// Fetch a blob's base64 content via the Git Data API. Used as a fallback for
/// blobs >1 MB where the Contents API returns `content: ""` and `encoding: "none"`.
fn github_get_blob_base64(sha: &str) -> Result<String, String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/git/blobs/{}", REPO, sha);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub blob GET failed for {}: {}", sha, e))?;

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

/// Read a file from the repo. Returns (content_string, sha).
pub fn github_get_file(path: &str) -> Result<(String, String), String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API GET failed for {}: {}", path, e))?;

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
    // Fall back to the Git Data API blob endpoint to fetch the full base64 payload.
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

/// Create or update a file in the repo.
pub fn github_put_file(
    path: &str,
    content: &[u8],
    message: &str,
    sha: Option<&str>,
) -> Result<String, String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let encoded = B64.encode(content);

    let mut body = serde_json::json!({
        "message": message,
        "content": encoded,
    });
    if let Some(s) = sha {
        body["sha"] = serde_json::Value::String(s.to_string());
    }

    let resp = crate::commands::http::agent()
        .put(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .send_string(&body.to_string())
        .map_err(|e| format!("GitHub API PUT failed for {}: {}", path, e))?;

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

/// PUT a file with automatic 409 retry. On stale-SHA the caller's `prepare`
/// closure is invoked to refetch the current SHA (and optionally re-derive
/// the content based on whatever now lives at `path`). Tries up to `max_attempts`
/// times before giving up.
///
/// `prepare` returns `(content_bytes, sha_to_send)`. On the first iteration the
/// caller can return `(initial_content, initial_sha)`; on retries the closure
/// must `github_get_file(path)` itself and return the new SHA along with whatever
/// content makes sense (e.g. re-merged, or the same payload if pure overwrite).
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

/// List files in a repo directory. Returns vec of (path, sha).
pub fn github_list_dir(path: &str) -> Result<Vec<(String, String)>, String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API GET dir failed for {}: {}", path, e))?;

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

/// Delete a file from the repo.
pub fn github_delete_file(path: &str, sha: &str, message: &str) -> Result<(), String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);

    let body = serde_json::json!({
        "message": message,
        "sha": sha,
    });

    crate::commands::http::agent()
        .delete(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .send_string(&body.to_string())
        .map_err(|e| format!("GitHub API DELETE failed for {}: {}", path, e))?;

    Ok(())
}

/// Read a file's raw base64 content without decoding. Used for binary attachments.
pub fn github_get_raw_base64(path: &str) -> Result<String, String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API GET failed for {}: {}", path, e))?;

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
    // Fall back to the Git Data API blob endpoint, which returns base64 regardless of size.
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
