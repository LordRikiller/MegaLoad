use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::commands::app_log::app_log;

const WORKER_BASE: &str = "https://mega-api.lordrik.workers.dev/data";

/// One remotely-served dataset: where it lives on the Worker, where we cache
/// it under %APPDATA%/MegaLoad/, and what shape a good payload has.
struct Dataset {
    name: &'static str,        // log label
    endpoint: &'static str,    // file under WORKER_BASE
    cache_file: &'static str,
    meta_file: &'static str,
    shape: Shape,
}

#[derive(Clone, Copy)]
enum Shape {
    /// Non-empty JSON array (the items).
    Array,
    /// JSON object with a numeric `schema` (the meta: facets, rollup rules, factories).
    SchemaObject,
}

const ITEMS: Dataset = Dataset {
    name: "valheim_data",
    endpoint: "valheim-items.json",
    cache_file: "valheim-items-cached.json",
    meta_file: "valheim-items-cached.meta.json",
    shape: Shape::Array,
};

const META: Dataset = Dataset {
    name: "valheim_meta",
    endpoint: "valheim-meta.json",
    cache_file: "valheim-meta-cached.json",
    meta_file: "valheim-meta-cached.meta.json",
    shape: Shape::SchemaObject,
};

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
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

#[derive(Serialize, Debug)]
pub struct CachedDataResult {
    pub version: String,
    pub body: String,
}

fn payload_ok(shape: Shape, value: &serde_json::Value) -> bool {
    match shape {
        Shape::Array => matches!(value, serde_json::Value::Array(arr) if !arr.is_empty()),
        Shape::SchemaObject => value
            .as_object()
            .and_then(|o| o.get("schema"))
            .map(|s| s.is_number())
            .unwrap_or(false),
    }
}

fn read_meta(ds: &Dataset) -> Option<CacheMeta> {
    let data = fs::read_to_string(megaload_dir().join(ds.meta_file)).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_meta(ds: &Dataset, meta: &CacheMeta) -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(dir.join(ds.meta_file), json).map_err(|e| format!("write meta: {}", e))
}

fn write_payload(ds: &Dataset, body: &str) -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    fs::write(dir.join(ds.cache_file), body).map_err(|e| format!("write payload: {}", e))
}

/// Pull one dataset from the MegaWorker. Sends the local version (if any) as
/// `?since=...` so the Worker can reply 304 when nothing changed. On 200,
/// validates the payload shape, then caches it before returning the body.
fn fetch_dataset(ds: &Dataset) -> FetchResult {
    let base = format!("{}/{}", WORKER_BASE, ds.endpoint);
    let local = read_meta(ds);
    let url = match &local {
        Some(m) if !m.version.is_empty() => format!("{}?since={}", base, m.version),
        _ => base,
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
            app_log(&format!("{}: 304 (version {})", ds.name, version));
            return FetchResult::Unchanged { version };
        }
        Err(e) => {
            app_log(&format!("{}: fetch failed: {}", ds.name, e));
            return FetchResult::Failed { error: e.to_string() };
        }
    };

    let version = resp.header("X-Data-Version").unwrap_or("").to_string();
    let etag = resp.header("ETag").unwrap_or("").trim_matches('"').to_string();
    let body = match resp.into_string() {
        Ok(b) => b,
        Err(e) => {
            app_log(&format!("{}: read body failed: {}", ds.name, e));
            return FetchResult::Failed { error: e.to_string() };
        }
    };

    // Refuse to overwrite a good cache with garbage from a misbehaving upstream.
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(v) if payload_ok(ds.shape, &v) => {}
        Ok(_) => {
            app_log(&format!("{}: payload has the wrong shape, ignoring", ds.name));
            return FetchResult::Failed {
                error: "Worker returned a payload of the wrong shape".to_string(),
            };
        }
        Err(e) => {
            app_log(&format!("{}: payload not valid JSON: {}", ds.name, e));
            return FetchResult::Failed { error: format!("Bad JSON from worker: {}", e) };
        }
    }

    if let Err(e) = write_payload(ds, &body) {
        app_log(&format!("{}: cache write failed: {}", ds.name, e));
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
    if let Err(e) = write_meta(ds, &meta) {
        app_log(&format!("{}: meta write failed: {}", ds.name, e));
    }

    app_log(&format!("{}: fetched version {} ({} bytes)", ds.name, version, body.len()));
    FetchResult::Updated {
        version,
        size: body.len() as u64,
        body,
    }
}

/// Read a cached payload + version (if the cache exists and is well-formed).
fn read_cached(ds: &Dataset) -> Option<CachedDataResult> {
    let meta = read_meta(ds)?;
    let body = fs::read_to_string(megaload_dir().join(ds.cache_file)).ok()?;
    // Don't ship a cache we can't parse — fall back to bundled.
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(v) if payload_ok(ds.shape, &v) => Some(CachedDataResult { version: meta.version, body }),
        _ => {
            app_log(&format!("{}: cached payload invalid, ignoring", ds.name));
            None
        }
    }
}

/// Pull the current Valheim item dataset from the MegaWorker.
#[command(async)]
pub fn fetch_valheim_data() -> FetchResult {
    fetch_dataset(&ITEMS)
}

/// Read the cached item payload + version. Used at startup so the frontend can
/// render cached data immediately while the network fetch is in flight.
#[command(async)]
pub fn read_cached_valheim_data() -> Option<CachedDataResult> {
    read_cached(&ITEMS)
}

/// Pull the Valheim meta (facets, rollup rules, factory tables).
#[command(async)]
pub fn fetch_valheim_meta() -> FetchResult {
    fetch_dataset(&META)
}

/// Read the cached meta payload + version.
#[command(async)]
pub fn read_cached_valheim_meta() -> Option<CachedDataResult> {
    read_cached(&META)
}
