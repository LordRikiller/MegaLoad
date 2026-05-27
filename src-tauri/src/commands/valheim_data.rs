use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::commands::app_log::app_log;

const WORKER_URL: &str = "https://mega-api.lordrik.workers.dev/data/valheim-items.json";

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn cache_path() -> PathBuf {
    megaload_dir().join("valheim-items-cached.json")
}

fn meta_path() -> PathBuf {
    megaload_dir().join("valheim-items-cached.meta.json")
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CacheMeta {
    pub version: String,
    pub etag: String,
    pub fetched_at: String,
    pub size: u64,
}

#[derive(Serialize, Debug)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FetchResult {
    /// Worker returned new data. Body + version are populated.
    Updated { version: String, body: String, size: u64 },
    /// Worker returned 304 — local cache is current.
    Unchanged { version: String },
    /// Network or HTTP error. Caller should fall back to cache then bundled.
    Failed { error: String },
}

fn read_meta() -> Option<CacheMeta> {
    let path = meta_path();
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_meta(meta: &CacheMeta) -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(meta_path(), json).map_err(|e| format!("write meta: {}", e))
}

fn write_payload(body: &str) -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    fs::write(cache_path(), body).map_err(|e| format!("write payload: {}", e))
}

/// Pull the current Valheim item dataset from the MegaWorker. Sends the local
/// version (if any) as `?since=...` so the Worker can reply 304 when nothing
/// changed. On 200, validates that the body parses as a JSON array, then
/// caches it to %APPDATA%/MegaLoad/valheim-items-cached.json before returning
/// the body to the frontend.
#[command]
pub fn fetch_valheim_data() -> FetchResult {
    let local = read_meta();
    let url = match &local {
        Some(m) if !m.version.is_empty() => format!("{}?since={}", WORKER_URL, m.version),
        _ => WORKER_URL.to_string(),
    };

    let agent = crate::commands::http::agent();
    let resp = match agent.get(&url).timeout(std::time::Duration::from_secs(10)).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(304, r)) => {
            // ureq surfaces non-2xx as ureq::Error::Status — handle 304 here as a normal case.
            let version = r
                .header("X-Data-Version")
                .map(String::from)
                .unwrap_or_else(|| local.as_ref().map(|m| m.version.clone()).unwrap_or_default());
            app_log(&format!("valheim_data: 304 (version {})", version));
            return FetchResult::Unchanged { version };
        }
        Err(e) => {
            app_log(&format!("valheim_data: fetch failed: {}", e));
            return FetchResult::Failed { error: e.to_string() };
        }
    };

    let version = resp.header("X-Data-Version").unwrap_or("").to_string();
    let etag = resp.header("ETag").unwrap_or("").trim_matches('"').to_string();
    let body = match resp.into_string() {
        Ok(b) => b,
        Err(e) => {
            app_log(&format!("valheim_data: read body failed: {}", e));
            return FetchResult::Failed { error: e.to_string() };
        }
    };

    // Sanity-check the payload parses as a JSON array. Refuse to overwrite a
    // good cache with garbage from a misbehaving upstream.
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
    match parsed {
        Ok(serde_json::Value::Array(arr)) if !arr.is_empty() => {}
        Ok(_) => {
            app_log("valheim_data: payload is not a non-empty JSON array, ignoring");
            return FetchResult::Failed {
                error: "Worker returned non-array or empty payload".to_string(),
            };
        }
        Err(e) => {
            app_log(&format!("valheim_data: payload not valid JSON: {}", e));
            return FetchResult::Failed { error: format!("Bad JSON from worker: {}", e) };
        }
    }

    if let Err(e) = write_payload(&body) {
        app_log(&format!("valheim_data: cache write failed: {}", e));
        // Still return Updated — the data is good even if we couldn't cache it.
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let meta = CacheMeta {
        version: version.clone(),
        etag,
        fetched_at: format!("epoch:{}", now),
        size: body.len() as u64,
    };
    if let Err(e) = write_meta(&meta) {
        app_log(&format!("valheim_data: meta write failed: {}", e));
    }

    app_log(&format!(
        "valheim_data: fetched version {} ({} bytes)",
        version,
        body.len()
    ));
    FetchResult::Updated {
        version,
        size: body.len() as u64,
        body,
    }
}

/// Read the cached payload + version (if cache exists). Used at startup so
/// the frontend can render cached data immediately while the network fetch
/// is in flight.
#[command]
pub fn read_cached_valheim_data() -> Option<CachedDataResult> {
    let meta = read_meta()?;
    let body = fs::read_to_string(cache_path()).ok()?;
    // Don't ship a cache we can't parse — fall back to bundled.
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
    if !matches!(parsed, Ok(serde_json::Value::Array(ref arr)) if !arr.is_empty()) {
        app_log("valheim_data: cached payload invalid, ignoring");
        return None;
    }
    Some(CachedDataResult {
        version: meta.version,
        body,
    })
}

#[derive(Serialize, Debug)]
pub struct CachedDataResult {
    pub version: String,
    pub body: String,
}
