use crate::commands::app_log::app_log;
use crate::commands::github::{
    github_delete_file, github_get_file, github_list_dir, github_put_file,
    github_put_file_with_retry, is_conflict_error,
};
use crate::commands::sync_log;
use crate::commands::identity::get_megaload_identity;
use crate::commands::player_data::{
    self, CharacterData, list_characters, read_character,
};
use crate::models::{
    SyncManifest, SyncModEntry, SyncProfileEntry,
    SyncSettings, SyncStatus, SyncThunderstoreMod,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYNC_SETTINGS_FILE: &str = "sync_settings.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn megaload_data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn get_sync_settings_path() -> PathBuf {
    megaload_data_dir().join(SYNC_SETTINGS_FILE)
}

fn load_sync_settings() -> SyncSettings {
    let path = get_sync_settings_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str(&data) {
                return settings;
            }
        }
    }
    SyncSettings {
        enabled: false,
        auto_sync: true,
        last_push: None,
        last_pull: None,
        machine_id: generate_machine_id(),
    }
}

fn save_sync_settings(settings: &SyncSettings) -> Result<(), String> {
    let dir = megaload_data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(get_sync_settings_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

fn generate_machine_id() -> String {
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
    let input = format!("{}@{}", user, hostname);
    format!("{:016x}", fnv1a_hash(input.as_bytes()))
}

/// Stable FNV-1a 64-bit hash — deterministic across restarts and platforms.
fn fnv1a_hash(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Stable hash of file contents using FNV-1a.
fn hash_file_contents(path: &Path) -> String {
    if let Ok(data) = fs::read(path) {
        format!("{:016x}", fnv1a_hash(&data))
    } else {
        String::new()
    }
}

fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    secs_to_iso(now)
}

// ---------------------------------------------------------------------------
// Bundle model — single file per profile with all state + config contents
// ---------------------------------------------------------------------------

/// Per-config entry. v2 bundles carry a `content` + `updated_at` (ISO-8601)
/// so concurrent edits to *different* .cfg files in the same profile no
/// longer drop one device's changes — the watermark picks the latest writer
/// per file. v1 bundles stored a bare string; `parse_bundle()` promotes them
/// using the bundle's top-level `last_updated` as the per-file fallback.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConfigEntry {
    pub content: String,
    pub updated_at: String,
}

/// Accepts either the legacy bare string ({"file.cfg": "<content>"}) or the
/// new struct shape ({"file.cfg": {"content": "...", "updated_at": "..."}}).
/// Stays in this enum until `parse_bundle()` normalises it.
#[derive(Deserialize)]
#[serde(untagged)]
enum ConfigContentRaw {
    Entry(ConfigEntry),
    Legacy(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncProfileBundle {
    pub profile_id: String,
    pub profile_name: String,
    pub last_updated: String,
    pub mods: Vec<SyncModEntry>,
    pub thunderstore_mods: Vec<SyncThunderstoreMod>,
    /// Config file contents keyed by filename (e.g. "MegaShot.cfg" → ConfigEntry).
    /// v2 schema. Legacy v1 bundles were `HashMap<String, String>` — see
    /// `parse_bundle()` for the back-compat fallback.
    pub configs: HashMap<String, ConfigEntry>,
    /// MegaTrainer state (trainer_state.json contents, if present), wrapped
    /// in a `ConfigEntry` so it gets the same per-file watermark treatment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trainer_state: Option<ConfigEntry>,
    /// Watermark for the mod set specifically — bumps only when mods/ts_mods
    /// actually change (see `mods_watermark`). Lets the merge pick the device
    /// that last *edited* the mod set rather than the one that pushed last.
    /// Defaults to empty on legacy bundles (treated as oldest).
    #[serde(default)]
    pub mods_updated_at: String,
}

/// Mirror of `SyncProfileBundle` whose configs/trainer_state are the raw
/// either-shape value. Internal — only used during deserialise.
#[derive(Deserialize)]
struct RawSyncProfileBundle {
    profile_id: String,
    profile_name: String,
    last_updated: String,
    #[serde(default)]
    mods: Vec<SyncModEntry>,
    #[serde(default)]
    thunderstore_mods: Vec<SyncThunderstoreMod>,
    #[serde(default)]
    configs: HashMap<String, ConfigContentRaw>,
    #[serde(default)]
    trainer_state: Option<ConfigContentRaw>,
    #[serde(default)]
    mods_updated_at: String,
}

/// Parse a bundle JSON, transparently promoting v1 (bare-string configs) to
/// v2 (per-file `ConfigEntry`) using the bundle's top-level `last_updated` as
/// the per-file fallback timestamp. Always returns the canonical v2 shape.
fn parse_bundle(content: &str) -> Result<SyncProfileBundle, String> {
    let raw: RawSyncProfileBundle = serde_json::from_str(content)
        .map_err(|e| format!("Bundle parse error: {}", e))?;
    let fallback = raw.last_updated.clone();
    let configs = raw
        .configs
        .into_iter()
        .map(|(k, v)| {
            let entry = match v {
                ConfigContentRaw::Entry(e) => e,
                ConfigContentRaw::Legacy(s) => ConfigEntry {
                    content: s,
                    updated_at: fallback.clone(),
                },
            };
            (k, entry)
        })
        .collect();
    let trainer_state = raw.trainer_state.map(|v| match v {
        ConfigContentRaw::Entry(e) => e,
        ConfigContentRaw::Legacy(s) => ConfigEntry {
            content: s,
            updated_at: fallback.clone(),
        },
    });
    // Legacy bundles (no mods_updated_at) fall back to the bundle-level
    // last_updated so they still carry a meaningful, non-empty mods watermark.
    let mods_updated_at = if raw.mods_updated_at.is_empty() {
        raw.last_updated.clone()
    } else {
        raw.mods_updated_at
    };
    Ok(SyncProfileBundle {
        profile_id: raw.profile_id,
        profile_name: raw.profile_name,
        last_updated: raw.last_updated,
        mods: raw.mods,
        thunderstore_mods: raw.thunderstore_mods,
        configs,
        trainer_state,
        mods_updated_at,
    })
}

/// Convert a filesystem mtime into an ISO-8601 timestamp suitable for use as
/// a `ConfigEntry.updated_at` watermark. Falls back to `iso_now()` when the
/// mtime is unavailable so brand-new files still carry a usable timestamp.
fn mtime_iso(path: &Path) -> String {
    let secs = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    match secs {
        Some(s) => secs_to_iso(s as i64),
        None => iso_now(),
    }
}

/// Format an absolute Unix-second timestamp as ISO-8601. Shared between
/// `iso_now`, `iso_days_ago`, and `mtime_iso`.
fn secs_to_iso(now: i64) -> String {
    let secs_per_day: i64 = 86400;
    let days = now.div_euclid(secs_per_day);
    let time_of_day = now.rem_euclid(secs_per_day);
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let mut y = 1970i64;
    let mut remaining = days;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md as i64 { m = i; break; }
        remaining -= md as i64;
    }
    let d = remaining + 1;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m + 1, d, hours, minutes, seconds)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
/// Inverse companion to `secs_to_iso` so we can turn a watermark back into a
/// Unix instant for mtime restamping.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Parse an ISO-8601 "YYYY-MM-DDTHH:MM:SSZ" stamp (the shape `iso_now`/
/// `mtime_iso` emit) back into Unix seconds. Lenient on the trailing zone.
fn iso_to_unix_secs(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }
    let num = |a: usize, n: usize| -> Option<i64> { s.get(a..a + n)?.trim().parse::<i64>().ok() };
    let y = num(0, 4)?;
    let mo = num(5, 2)?;
    let d = num(8, 2)?;
    let hh = num(11, 2)?;
    let mm = num(14, 2)?;
    let ss = num(17, 2)?;
    if !(1..=12).contains(&mo) {
        return None;
    }
    Some(days_from_civil(y, mo, d) * 86400 + hh * 3600 + mm * 60 + ss)
}

/// Set a file's mtime to match an ISO watermark. Used after a pull writes a
/// config so the freshly-written file no longer looks "newer" than its true
/// edit time — the same restamp trick the player-data path already uses.
fn restamp_file_mtime(path: &Path, iso: &str) {
    if let Some(secs) = iso_to_unix_secs(iso) {
        if secs >= 0 {
            let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs as u64);
            let _ = filetime::set_file_mtime(path, filetime::FileTime::from_system_time(when));
        }
    }
}

// ---------------------------------------------------------------------------
// Push dirty-tracking — in-memory, per run
// ---------------------------------------------------------------------------
//
// The 30s poll-push fires every cycle even when nothing changed locally. The
// no-op short-circuit inside `push_profile_bundle` still costs a GET (and the
// manifest compare costs another) to *discover* there's nothing to do. This
// cache lets an idle push skip those round-trips entirely: we remember the
// content signature we last confirmed in-sync, and if the current local
// snapshot still matches it, there is provably nothing to upload — a remote
// change would have been caught by `sync_check_remote_changed` → pull, which
// invalidates the cache. Lost on restart (then we GET once and re-cache).

#[derive(Default)]
struct PushCache {
    /// profile_id → bundle content signature last confirmed in-sync with cloud.
    bundle_sig: HashMap<String, String>,
    /// Manifest profile-list signature last confirmed in-sync with cloud.
    manifest_sig: Option<String>,
    /// profile_id → (mods fingerprint, ISO timestamp it last changed). Backs the
    /// honest mods watermark so "who edited the mod set last" wins the merge
    /// instead of "whoever pushed most recently".
    mods_rev: HashMap<String, (String, String)>,
}

fn push_cache() -> &'static std::sync::Mutex<PushCache> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<PushCache>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(PushCache::default()))
}

/// Forget cached push signatures for a profile (and the manifest) — called
/// after a pull so the next push reconciles against a clean slate.
fn invalidate_push_cache(profile_id: &str) {
    if let Ok(mut c) = push_cache().lock() {
        c.bundle_sig.remove(profile_id);
        c.manifest_sig = None;
    }
}

/// Stable fingerprint of a profile's installed mod set (enabled DLLs +
/// thunderstore tracking). Order-independent.
fn mods_fingerprint(mods: &[SyncModEntry], ts_mods: &[SyncThunderstoreMod]) -> String {
    let mut parts: Vec<String> = mods
        .iter()
        .map(|m| format!("{}:{}:{}", m.name, m.file_name, m.enabled))
        .collect();
    for t in ts_mods {
        parts.push(format!("ts:{}:{}", t.full_name, t.version));
    }
    parts.sort();
    format!("{:016x}", fnv1a_hash(parts.join("|").as_bytes()))
}

/// Resolve the mods watermark for a profile: reuse the cached timestamp while
/// the fingerprint is unchanged, bump to now the moment the set changes.
fn mods_watermark(profile_id: &str, mods: &[SyncModEntry], ts_mods: &[SyncThunderstoreMod]) -> String {
    let fp = mods_fingerprint(mods, ts_mods);
    let mut c = match push_cache().lock() {
        Ok(c) => c,
        Err(_) => return iso_now(),
    };
    match c.mods_rev.get(profile_id) {
        Some((cached_fp, ts)) if *cached_fp == fp => ts.clone(),
        _ => {
            let now = iso_now();
            c.mods_rev.insert(profile_id.to_string(), (fp, now.clone()));
            now
        }
    }
}

// ---------------------------------------------------------------------------
// Profile snapshot — reads current local state into a bundle
// ---------------------------------------------------------------------------

fn snapshot_bundle(profile_id: &str, profile_name: &str, bepinex_path: &str) -> Result<SyncProfileBundle, String> {
    let bep = Path::new(bepinex_path);
    let plugins_dir = bep.join("plugins");
    let disabled_dir = bep.join("disabled_plugins");

    let mut mods = Vec::new();
    if plugins_dir.exists() {
        scan_mods_for_sync(&plugins_dir, true, &mut mods)?;
    }
    if disabled_dir.exists() {
        scan_mods_for_sync(&disabled_dir, false, &mut mods)?;
    }

    let ts_mods = read_thunderstore_tracking(bepinex_path);
    let configs = read_all_configs(bepinex_path);
    let trainer_state = read_trainer_state(bepinex_path);
    let mods_updated_at = mods_watermark(profile_id, &mods, &ts_mods);

    Ok(SyncProfileBundle {
        profile_id: profile_id.to_string(),
        profile_name: profile_name.to_string(),
        last_updated: iso_now(),
        mods,
        thunderstore_mods: ts_mods,
        configs,
        trainer_state,
        mods_updated_at,
    })
}

fn scan_mods_for_sync(dir: &Path, enabled: bool, mods: &mut Vec<SyncModEntry>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_file() && file_name.to_lowercase().ends_with(".dll") {
            let name = file_name.trim_end_matches(".dll").trim_end_matches(".DLL").to_string();
            mods.push(SyncModEntry {
                name, file_name, version: None, enabled, source: "manual".to_string(),
            });
        } else if path.is_dir() {
            if let Some(dll) = find_dll_in_folder(&path) {
                let name = path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                mods.push(SyncModEntry {
                    name, file_name: dll, version: None, enabled, source: "thunderstore".to_string(),
                });
            }
        }
    }
    Ok(())
}

fn find_dll_in_folder(dir: &Path) -> Option<String> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().ends_with(".dll") {
                return Some(name);
            }
        }
    }
    None
}

fn read_thunderstore_tracking(bepinex_path: &str) -> Vec<SyncThunderstoreMod> {
    let profile_dir = Path::new(bepinex_path).parent().unwrap_or(Path::new("."));
    let ts_path = profile_dir.join("thunderstore_mods.json");
    if let Ok(data) = fs::read_to_string(&ts_path) {
        if let Ok(wrapped) = serde_json::from_str::<TsWrappedState>(&data) {
            return wrapped.mods.into_iter().map(|m| SyncThunderstoreMod {
                full_name: m.full_name, version: m.version, folder_name: m.folder_name,
            }).collect();
        }
        if let Ok(mods) = serde_json::from_str::<Vec<TsModEntry>>(&data) {
            return mods.into_iter().map(|m| SyncThunderstoreMod {
                full_name: m.full_name, version: m.version, folder_name: m.folder_name,
            }).collect();
        }
    }
    Vec::new()
}

#[derive(Deserialize)]
struct TsWrappedState { mods: Vec<TsModEntry> }

#[derive(Deserialize)]
struct TsModEntry { full_name: String, version: String, folder_name: String }

/// Read ALL .cfg files from config/ into a HashMap<filename, ConfigEntry>.
/// Each entry's `updated_at` reflects the file's mtime, so per-config merge
/// can pick the latest writer when two devices edit different .cfg files in
/// the same profile concurrently.
fn read_all_configs(bepinex_path: &str) -> HashMap<String, ConfigEntry> {
    let config_dir = Path::new(bepinex_path).join("config");
    let mut configs = HashMap::new();
    if let Ok(entries) = fs::read_dir(&config_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.to_lowercase().ends_with(".cfg") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        configs.insert(
                            file_name,
                            ConfigEntry {
                                content,
                                updated_at: mtime_iso(&path),
                            },
                        );
                    }
                }
            }
        }
    }
    configs
}

/// Read trainer_state.json from the profile directory (parent of BepInEx path),
/// returning a `ConfigEntry` so it slots into the same per-file merge logic.
fn read_trainer_state(bepinex_path: &str) -> Option<ConfigEntry> {
    let path = Path::new(bepinex_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("trainer_state.json");
    fs::read_to_string(&path).ok().map(|content| ConfigEntry {
        content,
        updated_at: mtime_iso(&path),
    })
}

/// Write trainer_state.json to the profile directory (parent of BepInEx path).
fn write_trainer_state(bepinex_path: &str, content: &str) {
    let path = Path::new(bepinex_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("trainer_state.json");
    let _ = fs::write(&path, content);
}

/// Compute a single content hash of the entire bundle for quick change detection.
fn bundle_content_hash(bundle: &SyncProfileBundle) -> String {
    // Hash mods + configs together — if anything changed, hash changes
    let json = serde_json::to_string(bundle).unwrap_or_default();
    format!("{:016x}", fnv1a_hash(json.as_bytes()))
}

/// Bundle signature with watermark fields zeroed and mod arrays sorted so the
/// hash is stable across snapshot orderings. Used by the push short-circuit
/// to detect "merged matches remote" and skip the redundant PUT — this is what
/// makes the 30s poll-push loop cheap when nothing has changed. Both
/// `last_updated` and `mods_updated_at` are excluded: they are metadata that
/// can differ between devices with identical content, so including them would
/// trigger spurious pushes.
fn bundle_content_signature(bundle: &SyncProfileBundle) -> String {
    let mut b = bundle.clone();
    b.last_updated = String::new();
    b.mods_updated_at = String::new();
    b.mods.sort_by(|x, y| x.name.cmp(&y.name).then(x.file_name.cmp(&y.file_name)));
    b.thunderstore_mods.sort_by(|x, y| x.full_name.cmp(&y.full_name));
    bundle_content_hash(&b)
}

/// Stable signature of the profile list inside a manifest. Used by the
/// manifest-push short-circuit to skip the PUT when only `last_sync` would
/// move (peer devices key off `last_sync` to decide whether to pull, so a
/// frivolous bump triggers a useless pull on every peer's next poll).
///
/// Deliberately does NOT include `machine_id`: the remote manifest carries the
/// *other* device's id, so folding it in made local and remote signatures never
/// match, the PUT fired every poll, and the two devices ping-ponged full pulls
/// (re-installing mods) forever. The signature reflects profile *content* only.
fn manifest_profiles_signature(profiles: &[SyncProfileEntry]) -> String {
    let mut sorted: Vec<&SyncProfileEntry> = profiles.iter().collect();
    sorted.sort_by(|x, y| x.id.cmp(&y.id));
    let mut buf = String::with_capacity(sorted.len() * 64);
    for p in sorted {
        buf.push('|');
        buf.push_str(&p.id);
        buf.push(':');
        buf.push_str(&p.name);
        buf.push(':');
        buf.push(if p.is_active { 'A' } else { '-' });
        buf.push(if p.is_linked { 'L' } else { '-' });
    }
    format!("{:016x}", fnv1a_hash(buf.as_bytes()))
}

// ---------------------------------------------------------------------------
// GitHub sync paths
// ---------------------------------------------------------------------------

fn sync_manifest_path(user_id: &str) -> String {
    format!("sync/{}/sync-manifest.json", user_id)
}

fn sync_bundle_path(user_id: &str, profile_id: &str) -> String {
    format!("sync/{}/profiles/{}/bundle.json", user_id, profile_id)
}

// ---------------------------------------------------------------------------
// Tauri commands — Sync settings
// ---------------------------------------------------------------------------

#[command]
pub async fn sync_get_status() -> Result<SyncStatus, String> {
    tauri::async_runtime::spawn_blocking(sync_get_status_impl)
        .await
        .map_err(|e| format!("sync_get_status task panicked: {}", e))?
}

fn sync_get_status_impl() -> Result<SyncStatus, String> {
    let settings = load_sync_settings();

    let remote_profiles = if settings.enabled {
        if let Ok(identity) = get_megaload_identity() {
            match github_get_file(&sync_manifest_path(&identity.user_id)) {
                Ok((content, _)) => {
                    serde_json::from_str::<SyncManifest>(&content)
                        .map(|m| m.profiles)
                        .unwrap_or_default()
                }
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    Ok(SyncStatus {
        enabled: settings.enabled,
        last_push: settings.last_push,
        last_pull: settings.last_pull,
        syncing: false,
        error: None,
        remote_profiles,
    })
}

#[command]
pub fn sync_set_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = load_sync_settings();
    settings.enabled = enabled;
    save_sync_settings(&settings)?;
    app_log(&format!("Cloud sync {}", if enabled { "enabled" } else { "disabled" }));
    sync_log::emit(
        "ToggleEnabled",
        "success",
        if enabled { "Cloud sync enabled" } else { "Cloud sync disabled" },
    );
    Ok(())
}

#[command]
pub fn sync_set_auto_sync(auto_sync: bool) -> Result<(), String> {
    let mut settings = load_sync_settings();
    settings.auto_sync = auto_sync;
    save_sync_settings(&settings)?;
    app_log(&format!("Auto-sync {}", if auto_sync { "enabled" } else { "disabled" }));
    sync_log::emit(
        "ToggleAutoSync",
        "success",
        if auto_sync { "Auto-sync enabled" } else { "Auto-sync disabled" },
    );
    Ok(())
}

#[command]
pub fn sync_get_settings() -> Result<SyncSettings, String> {
    Ok(load_sync_settings())
}

// ---------------------------------------------------------------------------
// Push — bundled (local → cloud)
// ---------------------------------------------------------------------------

/// Push all profiles to the cloud. Each profile = 1 bundled JSON file.
/// Total API calls: 2 (manifest) + 2 per profile (GET SHA + PUT bundle).
#[command]
pub async fn sync_push_all(profiles_json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync_push_all_impl(profiles_json))
        .await
        .map_err(|e| format!("sync_push_all task panicked: {}", e))?
}

fn sync_push_all_impl(profiles_json: String) -> Result<(), String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        sync_log::emit("PushAll", "skipped", "Cloud sync disabled");
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;

    let profiles: Vec<ProfilePushInfo> = serde_json::from_str(&profiles_json)
        .map_err(|e| format!("Invalid profiles JSON: {}", e))?;

    app_log(&format!("Sync push: {} profiles", profiles.len()));

    // 1. Push each profile bundle first (GET SHA + maybe PUT per profile).
    //    `push_profile_bundle` now returns `true` only when a PUT actually
    //    fired — the no-op short-circuit makes idle poll-push cheap.
    let mut failed: Vec<String> = Vec::new();
    let mut bundles_changed: u32 = 0;
    for p in &profiles {
        match push_profile_bundle(user_id, &identity.display_name, p) {
            Ok(true) => bundles_changed += 1,
            Ok(false) => {}
            Err(e) => {
                app_log(&format!("Sync push failed for {}: {}", p.name, e));
                failed.push(p.name.clone());
            }
        }
    }

    // 2. Manifest push — only when something actually changed. Without this
    //    guard, every 30s poll-push would bump `last_sync` and trip every peer
    //    device's `sync_check_remote_changed` into a useless pull cycle,
    //    burning ~5 API calls per profile per peer per poll until the PAT
    //    hourly limit choked sync entirely.
    let desired_profiles: Vec<SyncProfileEntry> = profiles.iter().map(|p| SyncProfileEntry {
        id: p.id.clone(),
        name: p.name.clone(),
        is_active: p.is_active,
        is_linked: false,
    }).collect();
    let manifest_path = sync_manifest_path(user_id);
    let desired_sig = manifest_profiles_signature(&desired_profiles);

    // Dirty-tracking: if no bundle changed and our cached manifest signature
    // still matches the desired profile list, the cloud manifest is provably
    // current — skip the GET entirely. An idle poll-push then makes zero
    // manifest calls. The cache is cleared by any pull, so a peer's change is
    // still picked up via `sync_check_remote_changed` → pull → invalidate.
    let cached_matches = bundles_changed == 0
        && push_cache()
            .lock()
            .ok()
            .and_then(|c| c.manifest_sig.clone())
            .as_deref()
            == Some(desired_sig.as_str());

    let manifest_needs_push = if cached_matches {
        false
    } else {
        let remote_manifest_sig = github_get_file(&manifest_path)
            .ok()
            .and_then(|(c, _)| serde_json::from_str::<SyncManifest>(&c).ok())
            .map(|m| manifest_profiles_signature(&m.profiles));
        bundles_changed > 0 || remote_manifest_sig.as_deref() != Some(desired_sig.as_str())
    };

    if manifest_needs_push {
        let manifest = SyncManifest {
            user_id: user_id.clone(),
            last_sync: iso_now(),
            machine_id: settings.machine_id.clone(),
            profiles: desired_profiles,
        };
        let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        // 409-retry the manifest push — two devices changing profiles around the same time
        // used to drop one's update silently.
        github_put_file_with_retry(
            &manifest_path,
            &format!("Sync — {}", identity.display_name),
            3,
            |attempt| {
                let sha = if attempt == 1 {
                    github_get_file(&manifest_path).ok().map(|(_, s)| s)
                } else {
                    match github_get_file(&manifest_path) {
                        Ok((_, s)) => Some(s),
                        Err(_) => None,
                    }
                };
                Ok((manifest_json.as_bytes().to_vec(), sha))
            },
        )?;
    }

    // The cloud manifest now reflects our desired profile list (we either just
    // PUT it, or confirmed it already matched). Cache that so the next idle
    // push can skip the manifest GET.
    if let Ok(mut c) = push_cache().lock() {
        c.manifest_sig = Some(desired_sig.clone());
    }

    // 3. Update local settings
    let mut settings = load_sync_settings();
    settings.last_push = Some(iso_now());
    save_sync_settings(&settings)?;

    if manifest_needs_push {
        app_log(&format!("Sync push complete ({} bundles changed)", bundles_changed));
    } else {
        app_log("Sync push: no changes — skipped manifest");
    }
    if !failed.is_empty() {
        sync_log::emit(
            "PushAll",
            "failed",
            format!("{} failed: {}", failed.len(), failed.join(", ")),
        );
    } else if manifest_needs_push {
        sync_log::emit(
            "PushAll",
            "success",
            format!(
                "Pushed {} profile{} ({} changed)",
                profiles.len(),
                if profiles.len() == 1 { "" } else { "s" },
                bundles_changed,
            ),
        );
    }
    // Silent no-op when nothing changed — the 30s poll-push would otherwise
    // flood the user-visible Sync Log with empty rows.
    Ok(())
}

#[derive(Deserialize)]
struct ProfilePushInfo {
    id: String,
    name: String,
    bepinex_path: String,
    is_active: bool,
    #[allow(dead_code)]
    is_linked: bool,
}

/// Pick the bundle entry with the larger `updated_at`. Ties go to `b` so that
/// when both sides have identical timestamps, the most recently observed copy
/// wins — this matches the MegaList tie-break convention.
fn pick_config_entry(a: ConfigEntry, b: ConfigEntry) -> ConfigEntry {
    if b.updated_at >= a.updated_at { b } else { a }
}

/// Merge two bundles per-file. Configs are unioned by filename; on collision,
/// the newer `updated_at` wins. Mods + thunderstore_mods stay last-writer
/// (they describe an installed-state set, not freely-editable content), but the
/// canonical side is now decided by `mods_updated_at` — which only moves when
/// the set actually changes — rather than the bundle-level `last_updated`,
/// which always read "now" on the pushing device and so let local always win
/// (the thrash that reinstalled mods every cycle). Trainer state gets the same
/// per-entry watermark treatment as configs.
fn merge_profile_bundle(local: SyncProfileBundle, remote: SyncProfileBundle) -> SyncProfileBundle {
    // Per-file config merge — union by filename, pick by updated_at.
    let mut merged_configs: HashMap<String, ConfigEntry> = remote.configs;
    for (name, local_entry) in local.configs {
        match merged_configs.remove(&name) {
            Some(remote_entry) => {
                merged_configs.insert(name, pick_config_entry(remote_entry, local_entry));
            }
            None => {
                merged_configs.insert(name, local_entry);
            }
        }
    }

    // Trainer state — same watermark logic, only one entry.
    let merged_trainer = match (local.trainer_state, remote.trainer_state) {
        (Some(l), Some(r)) => Some(pick_config_entry(r, l)),
        (Some(l), None) => Some(l),
        (None, Some(r)) => Some(r),
        (None, None) => None,
    };

    // Mods/thunderstore_mods describe the active installed set. Pick the side
    // whose mod set changed most recently (mods_updated_at); ties keep local.
    let mods_local_wins = local.mods_updated_at >= remote.mods_updated_at;
    let (mods, ts_mods, profile_name, mods_updated_at) = if mods_local_wins {
        (local.mods, local.thunderstore_mods, local.profile_name, local.mods_updated_at)
    } else {
        (remote.mods, remote.thunderstore_mods, remote.profile_name, remote.mods_updated_at)
    };

    SyncProfileBundle {
        profile_id: local.profile_id,
        profile_name,
        last_updated: iso_now(),
        mods,
        thunderstore_mods: ts_mods,
        configs: merged_configs,
        trainer_state: merged_trainer,
        mods_updated_at,
    }
}

fn push_profile_bundle(user_id: &str, display_name: &str, profile: &ProfilePushInfo) -> Result<bool, String> {
    let local = snapshot_bundle(&profile.id, &profile.name, &profile.bepinex_path)?;
    let bundle_path = sync_bundle_path(user_id, &profile.id);

    // Dirty-tracking fast path: if the local snapshot is identical (by content
    // signature) to what we last confirmed in-sync with the cloud, there is
    // nothing to upload — skip the GET+merge+PUT entirely. A remote-side change
    // would have been caught by `sync_check_remote_changed` → pull, which clears
    // this cache, so we can't miss a peer's edit by short-circuiting here.
    let local_sig = bundle_content_signature(&local);
    if push_cache()
        .lock()
        .ok()
        .and_then(|c| c.bundle_sig.get(&profile.id).cloned())
        .as_deref()
        == Some(local_sig.as_str())
    {
        return Ok(false);
    }

    // Fetch remote (if any) so we can merge per-file rather than overwrite. Two
    // devices editing different .cfg files in the same profile previously
    // dropped one's edit on push — the bundle is one blob, last writer wins.
    // Now we union per-file by `updated_at`.
    let remote = match github_get_file(&bundle_path) {
        Ok((content, _)) => parse_bundle(&content).ok(),
        Err(_) => None,
    };

    // Defensive: refuse to overwrite a populated remote bundle with a clearly-empty
    // local one. Empty here = no mods, no thunderstore mods, no .cfg files. This catches
    // the "fresh-state-on-second-device wipes good remote" pattern that took out Lady
    // Emz's MegaLists.
    let local_is_empty = local.mods.is_empty()
        && local.thunderstore_mods.is_empty()
        && local.configs.is_empty();

    if local_is_empty {
        if let Some(ref r) = remote {
            let remote_has_data = !r.mods.is_empty()
                || !r.thunderstore_mods.is_empty()
                || !r.configs.is_empty();
            if remote_has_data {
                app_log(&format!(
                    "Sync push: refusing to overwrite populated remote bundle for {} \
                     with empty local (remote has {} mods, {} ts mods, {} configs)",
                    profile.name,
                    r.mods.len(),
                    r.thunderstore_mods.len(),
                    r.configs.len(),
                ));
                return Err(format!(
                    "Refusing empty bundle push for '{}' — remote has data. Pull first.",
                    profile.name
                ));
            }
        }
    }

    // Merge with remote (or use local as-is if no remote yet).
    let merged = match &remote {
        Some(r) => merge_profile_bundle(local, r.clone()),
        None => local,
    };

    // Short-circuit: skip the PUT when merged content matches remote (only
    // `last_updated` would have moved). Mirrors the MegaList no-op pattern —
    // makes the 30s poll-push loop near-free when nothing has actually changed
    // locally. Without this, every poll cycle burns ~2 API calls per profile.
    if let Some(ref r) = remote {
        if bundle_content_signature(&merged) == bundle_content_signature(r) {
            if let Ok(mut c) = push_cache().lock() {
                c.bundle_sig.insert(profile.id.clone(), local_sig.clone());
            }
            app_log(&format!(
                "Sync push: {} unchanged — skip PUT ({} mods, {} configs)",
                profile.name,
                merged.mods.len(),
                merged.configs.len(),
            ));
            return Ok(false);
        }
    }

    let bundle_json = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    let configs_count = merged.configs.len();
    let mods_count = merged.mods.len();

    // PUT with 409 retry — two debounced pushes racing each other (or another device)
    // used to silently lose one. Refetch SHA AND remerge on conflict so the push that
    // wins includes both sides' changes.
    let bundle_path_for_retry = bundle_path.clone();
    let local_for_retry = snapshot_bundle(&profile.id, &profile.name, &profile.bepinex_path)?;
    github_put_file_with_retry(
        &bundle_path,
        &format!("Sync {} — {}", profile.name, display_name),
        3,
        |attempt| {
            if attempt == 1 {
                let sha = github_get_file(&bundle_path_for_retry).ok().map(|(_, s)| s);
                Ok((bundle_json.as_bytes().to_vec(), sha))
            } else {
                // Conflict: another device pushed between our GET and PUT.
                // Refetch remote, remerge with our local snapshot, and try again
                // — that way the retry's bytes include the new remote changes.
                let (remote_json, sha) = github_get_file(&bundle_path_for_retry)
                    .map(|(c, s)| (Some(c), Some(s)))
                    .unwrap_or((None, None));
                let merged_bytes = match remote_json.and_then(|j| parse_bundle(&j).ok()) {
                    Some(r) => {
                        let m = merge_profile_bundle(local_for_retry.clone(), r);
                        serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?
                    }
                    None => bundle_json.clone(),
                };
                Ok((merged_bytes.into_bytes(), sha))
            }
        },
    )?;

    // Cloud now holds our merged content. Remember the local signature so the
    // next idle push (local unchanged) short-circuits without touching network.
    if let Ok(mut c) = push_cache().lock() {
        c.bundle_sig.insert(profile.id.clone(), local_sig.clone());
    }

    app_log(&format!(
        "Pushed bundle: {} ({} mods, {} configs)",
        profile.name, mods_count, configs_count
    ));
    Ok(true)
}

// Keep sync_push_profile for backwards compatibility (delegates to push_all pattern)
#[command]
pub async fn sync_push_profile(profile_id: String, profile_name: String, bepinex_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync_push_profile_impl(profile_id, profile_name, bepinex_path))
        .await
        .map_err(|e| format!("sync_push_profile task panicked: {}", e))?
}

fn sync_push_profile_impl(profile_id: String, profile_name: String, bepinex_path: String) -> Result<(), String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;

    let profile = ProfilePushInfo {
        id: profile_id,
        name: profile_name,
        bepinex_path,
        is_active: true,
        is_linked: false,
    };

    let _ = push_profile_bundle(user_id, &identity.display_name, &profile)?;

    let mut settings = load_sync_settings();
    settings.last_push = Some(iso_now());
    save_sync_settings(&settings)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Pull — bundled (cloud → local)
// ---------------------------------------------------------------------------

/// Pull the remote sync manifest.
#[command]
pub async fn sync_pull_manifest() -> Result<SyncManifest, String> {
    tauri::async_runtime::spawn_blocking(sync_pull_manifest_impl)
        .await
        .map_err(|e| format!("sync_pull_manifest task panicked: {}", e))?
}

fn sync_pull_manifest_impl() -> Result<SyncManifest, String> {
    let identity = get_megaload_identity()?;
    let path = sync_manifest_path(&identity.user_id);

    match github_get_file(&path) {
        Ok((content, _)) => {
            serde_json::from_str(&content).map_err(|e| format!("Manifest parse error: {}", e))
        }
        Err(_) => Ok(SyncManifest {
            user_id: identity.user_id,
            last_sync: String::new(),
            machine_id: String::new(),
            profiles: Vec::new(),
        }),
    }
}

/// Pull a single profile's bundle from the cloud and apply configs locally.
/// API calls: 1 GET bundle.
#[command]
pub async fn sync_pull_bundle(profile_id: String, bepinex_path: String) -> Result<SyncPullResult, String> {
    tauri::async_runtime::spawn_blocking(move || sync_pull_bundle_impl(profile_id, bepinex_path))
        .await
        .map_err(|e| format!("sync_pull_bundle task panicked: {}", e))?
}

fn sync_pull_bundle_impl(profile_id: String, bepinex_path: String) -> Result<SyncPullResult, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;

    app_log(&format!("Sync pull bundle: profile {}", profile_id));

    // 1. Fetch remote bundle (1 API call)
    let bundle_path = sync_bundle_path(user_id, &profile_id);
    let (content, _) = github_get_file(&bundle_path)
        .map_err(|_| format!("No cloud bundle found for profile {}", profile_id))?;
    let remote: SyncProfileBundle = parse_bundle(&content)?;

    // 2. Apply configs — only overwrite local when remote's per-file
    //    `updated_at` is newer (or equal) than local's mtime, OR the local
    //    file doesn't exist. A local edit made between push and pull is
    //    strictly newer than remote and must not be clobbered; the next push
    //    will then propagate it via per-config merge.
    let config_dir = Path::new(&bepinex_path).join("config");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    let mut configs_updated: u32 = 0;
    for (file_name, remote_entry) in &remote.configs {
        let local_path = config_dir.join(file_name);
        let local_exists = local_path.exists();
        let local_content = fs::read_to_string(&local_path).unwrap_or_default();
        if local_content == remote_entry.content {
            continue;
        }
        if local_exists {
            let local_mtime = mtime_iso(&local_path);
            if local_mtime > remote_entry.updated_at {
                app_log(&format!(
                    "Sync pull: skip {} — local mtime {} > remote {}",
                    file_name, local_mtime, remote_entry.updated_at
                ));
                continue;
            }
        }
        fs::write(&local_path, &remote_entry.content).map_err(|e| e.to_string())?;
        // Restamp the freshly-written file to the remote's edit time. Without
        // this, fs::write sets mtime = now, so the pulled file looks "newer"
        // than its true edit time and the NEXT pull's `local_mtime > remote`
        // guard wrongly skips a genuine remote update — the reason configs
        // stopped propagating device-to-device.
        restamp_file_mtime(&local_path, &remote_entry.updated_at);
        configs_updated += 1;
        app_log(&format!("Sync pull config: {}", file_name));
    }

    // 2b. Apply trainer state with the same per-entry watermark guard.
    if let Some(ref remote_trainer) = remote.trainer_state {
        let local_trainer = read_trainer_state(&bepinex_path);
        let local_content = local_trainer
            .as_ref()
            .map(|t| t.content.as_str())
            .unwrap_or("");
        let local_mtime = local_trainer
            .as_ref()
            .map(|t| t.updated_at.as_str())
            .unwrap_or("");
        if local_content != remote_trainer.content
            && (local_trainer.is_none() || local_mtime <= remote_trainer.updated_at.as_str())
        {
            write_trainer_state(&bepinex_path, &remote_trainer.content);
            let trainer_path = Path::new(&bepinex_path)
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("trainer_state.json");
            restamp_file_mtime(&trainer_path, &remote_trainer.updated_at);
            configs_updated += 1;
            app_log("Sync pull: trainer_state.json");
        }
    }

    // 3. Toggle mods (enabled/disabled)
    let local_bundle = snapshot_bundle(&profile_id, &remote.profile_name, &bepinex_path)?;
    let mut toggled_mods = Vec::new();
    for remote_mod in &remote.mods {
        if let Some(local_mod) = local_bundle.mods.iter().find(|m| m.name == remote_mod.name) {
            if local_mod.enabled != remote_mod.enabled {
                toggle_mod_sync(&bepinex_path, &remote_mod.file_name, remote_mod.enabled)?;
                toggled_mods.push(remote_mod.name.clone());
            }
        }
    }

    // 4. Find missing mods
    let missing_mods: Vec<String> = remote.mods.iter()
        .filter(|rm| !local_bundle.mods.iter().any(|lm| lm.name == rm.name))
        .map(|m| m.name.clone())
        .collect();

    // 5. Update local settings
    let mut settings = load_sync_settings();
    settings.last_pull = Some(iso_now());
    save_sync_settings(&settings)?;

    // We just changed local state from the cloud — forget the push dirty-cache
    // for this profile (and the manifest) so the next push reconciles against a
    // clean slate rather than trusting a now-stale signature.
    invalidate_push_cache(&profile_id);

    let result = SyncPullResult {
        profile_name: remote.profile_name,
        toggled_mods,
        configs_updated,
        missing_mods,
        last_updated: remote.last_updated,
    };

    app_log(&format!("Sync pull complete: {} configs, {} toggled, {} missing",
        result.configs_updated, result.toggled_mods.len(), result.missing_mods.len()));

    let nothing_changed = result.configs_updated == 0
        && result.toggled_mods.is_empty()
        && result.missing_mods.is_empty();
    if !nothing_changed {
        sync_log::emit(
            "PullBundle",
            "success",
            format!(
                "{}: {} configs, {} toggled, {} missing",
                result.profile_name,
                result.configs_updated,
                result.toggled_mods.len(),
                result.missing_mods.len()
            ),
        );
    }

    Ok(result)
}

#[derive(Serialize, Clone, Debug)]
pub struct SyncPullResult {
    pub profile_name: String,
    pub toggled_mods: Vec<String>,
    pub configs_updated: u32,
    pub missing_mods: Vec<String>,
    pub last_updated: String,
}

/// Pull a profile's state (for Thunderstore mod info). Returns the bundle.
#[command]
pub async fn sync_pull_profile_state(profile_id: String) -> Result<SyncProfileBundle, String> {
    tauri::async_runtime::spawn_blocking(move || sync_pull_profile_state_impl(profile_id))
        .await
        .map_err(|e| format!("sync_pull_profile_state task panicked: {}", e))?
}

fn sync_pull_profile_state_impl(profile_id: String) -> Result<SyncProfileBundle, String> {
    let identity = get_megaload_identity()?;
    let bundle_path = sync_bundle_path(&identity.user_id, &profile_id);

    let (content, _) = github_get_file(&bundle_path)
        .map_err(|_| format!("No cloud bundle found for profile {}", profile_id))?;
    parse_bundle(&content)
}

// Legacy compat — sync_pull_configs delegates to bundle pull
#[command]
pub async fn sync_pull_configs(profile_id: String, bepinex_path: String) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || sync_pull_bundle_impl(profile_id, bepinex_path))
        .await
        .map_err(|e| format!("sync_pull_configs task panicked: {}", e))?
        .map(|r| r.configs_updated)
}

// Legacy compat — sync_pull_profile delegates to bundle pull
#[command]
pub async fn sync_pull_profile(profile_id: String, bepinex_path: String) -> Result<SyncPullResult, String> {
    tauri::async_runtime::spawn_blocking(move || sync_pull_bundle_impl(profile_id, bepinex_path))
        .await
        .map_err(|e| format!("sync_pull_profile task panicked: {}", e))?
}

/// Toggle a mod between plugins/ and disabled_plugins/ during sync.
fn toggle_mod_sync(bepinex_path: &str, file_name: &str, enable: bool) -> Result<(), String> {
    let bep = Path::new(bepinex_path);
    let plugins = bep.join("plugins");
    let disabled = bep.join("disabled_plugins");

    let (from_dir, to_dir) = if enable {
        (disabled, plugins)
    } else {
        (plugins, disabled)
    };

    let from_path = from_dir.join(file_name);
    if from_path.exists() {
        fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
        fs::rename(&from_path, to_dir.join(file_name)).map_err(|e| e.to_string())?;
        app_log(&format!("Sync toggle: {} → {}", file_name, if enable { "enabled" } else { "disabled" }));
    }
    let folder_name = file_name.trim_end_matches(".dll").trim_end_matches(".DLL");
    let from_folder = from_dir.join(folder_name);
    if from_folder.is_dir() {
        fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
        let to_folder = to_dir.join(folder_name);
        if !to_folder.exists() {
            fs::rename(&from_folder, &to_folder).map_err(|e| e.to_string())?;
            app_log(&format!("Sync toggle folder: {} → {}", folder_name, if enable { "enabled" } else { "disabled" }));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Change detection — polling
// ---------------------------------------------------------------------------

#[command]
pub async fn sync_check_remote_changed() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(sync_check_remote_changed_impl)
        .await
        .map_err(|e| format!("sync_check_remote_changed task panicked: {}", e))?
}

fn sync_check_remote_changed_impl() -> Result<bool, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Ok(false);
    }

    let identity = get_megaload_identity()?;
    let path = sync_manifest_path(&identity.user_id);

    match github_get_file(&path) {
        Ok((content, _)) => {
            if let Ok(manifest) = serde_json::from_str::<SyncManifest>(&content) {
                if manifest.machine_id != settings.machine_id {
                    if let Some(ref last_pull) = settings.last_pull {
                        Ok(manifest.last_sync > *last_pull)
                    } else {
                        Ok(true)
                    }
                } else {
                    Ok(false)
                }
            } else {
                Ok(false)
            }
        }
        Err(_) => Ok(false),
    }
}

// ---------------------------------------------------------------------------
// Player Data Sync (v2 — binary-safe, mtime-aware)
// ---------------------------------------------------------------------------
//
// The legacy format (v1) uploaded a parsed CharacterData JSON snapshot and
// provided no round-trip back to the Valheim save file. Pulls showed the
// remote in the UI but never wrote anything to disk, so the local `.fch`
// stayed stale. Auto-push on startup would then happily overwrite the cloud
// with the desktop's stale JSON — the exact "pushing when should be pulling"
// bug Milord reported.
//
// v2 stores the raw `.fch` bytes (base64) alongside the source file's mtime,
// and every push/pull decision is gated on comparing mtimes. Whichever side
// was most recently written wins. Pulling actually writes the bytes to the
// local `.fch` and restamps the mtime so the next reconcile doesn't ping-pong.
//
// Shape on GitHub:
//   {
//     "version": 2,
//     "name":        "Lagertha",
//     "mtime_secs":  1776492000,      // source .fch mtime at time of push
//     "source":      "MegaLoad/desktop",
//     "bytes_b64":   "<base64 .fch>",
//     "preview":     { ...CharacterData }   // optional; purely for GitHub UI readability
//   }

const PLAYER_SYNC_VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
struct PlayerSyncPayload {
    version: u32,
    name: String,
    mtime_secs: u64,
    source: String,
    bytes_b64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<CharacterData>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlayerReconcileSummary {
    pub pushed: u32,
    pub pulled: u32,
    pub skipped: u32,
    pub details: Vec<String>,
}

fn sync_character_path(user_id: &str, char_name: &str) -> String {
    format!("sync/{}/characters/{}.json", user_id, char_name)
}

fn push_source_label() -> String {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    format!("MegaLoad/{}", host)
}

fn build_payload(char_name: &str, path: &Path) -> Result<(PlayerSyncPayload, Vec<u8>, u64), String> {
    let (bytes, mtime) = player_data::read_fch_with_mtime(path)?;
    let preview = read_character(path.to_string_lossy().to_string()).ok();
    let payload = PlayerSyncPayload {
        version: PLAYER_SYNC_VERSION,
        name: char_name.to_string(),
        mtime_secs: mtime,
        source: push_source_label(),
        bytes_b64: B64.encode(&bytes),
        preview,
    };
    Ok((payload, bytes, mtime))
}

fn parse_remote(content: &str) -> Option<PlayerSyncPayload> {
    // v2 payload only. v1 rows don't carry the bytes, so we can't round-trip
    // them — silently skip and log. Any client on >= v2 will overwrite the
    // row with a v2 payload on the next local change.
    match serde_json::from_str::<PlayerSyncPayload>(content) {
        Ok(p) if p.version >= 2 => Some(p),
        _ => None,
    }
}

/// Push local .fch files to cloud. Only pushes a character when the local
/// file is strictly newer than the remote copy (or the remote doesn't exist).
#[command]
pub async fn sync_push_player_data() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(sync_push_player_data_impl)
        .await
        .map_err(|e| format!("Player sync task panicked: {}", e))?
}

fn sync_push_player_data_impl() -> Result<u32, String> {
    app_log("Sync push player data: starting");
    let settings = load_sync_settings();
    if !settings.enabled {
        app_log("Sync push player data: aborted — cloud sync disabled");
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;
    let characters = list_characters().map_err(|e| {
        app_log(&format!("Sync push: list_characters failed — {}", e));
        e
    })?;
    app_log(&format!("Sync push player data: found {} local characters", characters.len()));

    let mut pushed: u32 = 0;
    let mut skipped: u32 = 0;

    for summary in &characters {
        let local_path = PathBuf::from(&summary.path);
        let (payload, bytes, local_mtime) = match build_payload(&summary.name, &local_path) {
            Ok(t) => t,
            Err(e) => {
                app_log(&format!("Sync push: skipping {} — {}", summary.name, e));
                skipped += 1;
                continue;
            }
        };

        let remote_path = sync_character_path(user_id, &summary.name);
        let sha = match github_get_file(&remote_path) {
            Ok((content, sha)) => {
                if let Some(remote) = parse_remote(&content) {
                    // Content equality trumps mtime. Steam Cloud bumps the
                    // local .fch mtime on every download, so local can look
                    // "newer" than the cloud even when the bytes are identical.
                    // Skip and restamp the local mtime to match remote so
                    // future reconciles stop flagging a false local-newer.
                    if let Ok(remote_bytes) = B64.decode(remote.bytes_b64.as_bytes()) {
                        if remote_bytes == bytes {
                            if local_mtime != remote.mtime_secs {
                                let when = std::time::UNIX_EPOCH
                                    + std::time::Duration::from_secs(remote.mtime_secs);
                                let _ = filetime::set_file_mtime(
                                    &local_path,
                                    filetime::FileTime::from_system_time(when),
                                );
                                app_log(&format!(
                                    "Sync push: {} bytes match — restamped local mtime {} → {}",
                                    summary.name, local_mtime, remote.mtime_secs
                                ));
                            }
                            skipped += 1;
                            continue;
                        }
                    }
                    if remote.mtime_secs >= local_mtime {
                        app_log(&format!(
                            "Sync push: {} remote mtime {} >= local {} — skip",
                            summary.name, remote.mtime_secs, local_mtime
                        ));
                        skipped += 1;
                        continue;
                    }
                }
                Some(sha)
            }
            Err(_) => None, // remote doesn't exist yet
        };

        let body = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
        // 409-retry the character push too. The retry refetches the SHA so a concurrent
        // upload from another device doesn't make us silently fail.
        let body_bytes = body.as_bytes().to_vec();
        let initial_sha = sha.clone();
        let path_for_closure = remote_path.clone();
        let push_result = github_put_file_with_retry(
            &remote_path,
            &format!("Sync push {} (mtime {}) — {}", summary.name, local_mtime, identity.display_name),
            3,
            |attempt| {
                let sha = if attempt == 1 {
                    initial_sha.clone()
                } else {
                    match github_get_file(&path_for_closure) {
                        Ok((_, s)) => Some(s),
                        Err(_) => None,
                    }
                };
                Ok((body_bytes.clone(), sha))
            },
        );
        match push_result {
            Ok(_) => {
                pushed += 1;
                app_log(&format!("Sync push: uploaded {} (mtime {})", summary.name, local_mtime));
            }
            Err(e) => {
                app_log(&format!("Sync push failed for {}: {}", summary.name, e));
                if is_conflict_error(&e) {
                    // Surrender gracefully — let the next reconcile handle it rather than
                    // aborting the whole player-data push and missing the rest of the chars.
                    skipped += 1;
                    continue;
                }
                return Err(e);
            }
        }
    }

    app_log(&format!(
        "Sync push player data: {} pushed, {} skipped",
        pushed, skipped
    ));
    let result = if pushed == 0 && skipped > 0 { "noop" } else { "success" };
    sync_log::emit(
        "PushPlayerData",
        result,
        format!("{} pushed, {} skipped", pushed, skipped),
    );
    Ok(pushed)
}

/// Pull characters from cloud. Writes the raw .fch bytes to disk when the
/// remote mtime is strictly newer than any local copy (or the character
/// doesn't exist locally). Returns the number of characters that were
/// actually written, and a previews list for the UI to refresh from.
#[command]
pub async fn sync_pull_player_data() -> Result<Vec<CharacterData>, String> {
    tauri::async_runtime::spawn_blocking(|| sync_pull_player_data_impl().map(|r| r.1))
        .await
        .map_err(|e| format!("Player pull task panicked: {}", e))?
}

fn sync_pull_player_data_impl() -> Result<(PlayerReconcileSummary, Vec<CharacterData>), String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;
    let dir_path = format!("sync/{}/characters", user_id);

    let listing = match github_list_dir(&dir_path) {
        Ok(l) => l,
        Err(e) if e.contains("404") => {
            return Ok((PlayerReconcileSummary { pushed: 0, pulled: 0, skipped: 0, details: vec![] }, Vec::new()));
        }
        Err(e) => return Err(e),
    };

    let mut summary = PlayerReconcileSummary { pushed: 0, pulled: 0, skipped: 0, details: vec![] };
    let mut previews: Vec<CharacterData> = Vec::new();

    for (path, _sha) in &listing {
        if !path.ends_with(".json") { continue; }
        let (content, _) = match github_get_file(path) {
            Ok(x) => x,
            Err(e) => {
                app_log(&format!("Sync pull: failed to read {}: {}", path, e));
                continue;
            }
        };

        let remote = match parse_remote(&content) {
            Some(p) => p,
            None => {
                app_log(&format!("Sync pull: {} is legacy v1 (no bytes) — skip", path));
                summary.skipped += 1;
                summary.details.push(format!("{}: legacy v1, skipped", path));
                continue;
            }
        };

        // Resolve local path. If the character doesn't exist locally yet,
        // land it in the primary character dir (Steam Cloud if present).
        let local_path = match player_data::find_fch_path_for_name(&remote.name) {
            Some(p) => p,
            None => match player_data::get_primary_character_dir() {
                Some(dir) => dir.join(format!("{}.fch", remote.name)),
                None => {
                    app_log("Sync pull: no character directory available to write new character");
                    summary.skipped += 1;
                    summary.details.push(format!("{}: no local dir, skipped", remote.name));
                    continue;
                }
            },
        };

        let local_mtime = fs::metadata(&local_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let bytes = match B64.decode(remote.bytes_b64.as_bytes()) {
            Ok(b) => b,
            Err(e) => {
                app_log(&format!("Sync pull: base64 decode failed for {}: {}", remote.name, e));
                summary.skipped += 1;
                continue;
            }
        };

        // Byte-equality beats mtime. Steam Cloud rewrites local mtime on
        // download, so local can look newer even when bytes are identical.
        // When they match, restamp local mtime to remote so the push pass
        // doesn't then try to ship the same bytes back up.
        let local_bytes_match = fs::read(&local_path).ok().map(|lb| lb == bytes).unwrap_or(false);
        if local_bytes_match {
            if local_mtime != remote.mtime_secs {
                let when = std::time::UNIX_EPOCH
                    + std::time::Duration::from_secs(remote.mtime_secs);
                let _ = filetime::set_file_mtime(
                    &local_path,
                    filetime::FileTime::from_system_time(when),
                );
                app_log(&format!(
                    "Sync pull: {} bytes match — restamped local mtime {} → {}",
                    remote.name, local_mtime, remote.mtime_secs
                ));
            }
            summary.skipped += 1;
            if let Some(p) = remote.preview { previews.push(p); }
            continue;
        }

        if remote.mtime_secs <= local_mtime {
            app_log(&format!(
                "Sync pull: {} local mtime {} >= remote {} — skip",
                remote.name, local_mtime, remote.mtime_secs
            ));
            summary.skipped += 1;
            if let Some(p) = remote.preview { previews.push(p); }
            continue;
        }

        match player_data::write_fch_with_mtime(&local_path, &bytes, remote.mtime_secs) {
            Ok(_) => {
                summary.pulled += 1;
                summary.details.push(format!(
                    "{}: pulled (local {} → remote {})", remote.name, local_mtime, remote.mtime_secs
                ));
                app_log(&format!(
                    "Sync pull: wrote {} ({} bytes, mtime {})",
                    local_path.display(), bytes.len(), remote.mtime_secs
                ));
                // Re-parse after write so we return fresh preview data
                if let Ok(parsed) = read_character(local_path.to_string_lossy().to_string()) {
                    previews.push(parsed);
                } else if let Some(p) = remote.preview {
                    previews.push(p);
                }
            }
            Err(e) => {
                app_log(&format!("Sync pull: failed to write {}: {}", remote.name, e));
                summary.skipped += 1;
                summary.details.push(format!("{}: write failed — {}", remote.name, e));
            }
        }
    }

    app_log(&format!(
        "Sync pull player data: {} pulled, {} skipped",
        summary.pulled, summary.skipped
    ));
    if summary.pulled > 0 || summary.skipped > 0 {
        let result = if summary.pulled == 0 { "noop" } else { "success" };
        sync_log::emit(
            "PullPlayerData",
            result,
            format!("{} pulled, {} skipped", summary.pulled, summary.skipped),
        );
    }
    Ok((summary, previews))
}

/// Reconcile local + remote in a single pass: pull anything remote-newer,
/// then push anything local-newer. Use this on startup instead of the old
/// "initial push" which could clobber fresh remote data with stale local.
#[command]
pub async fn sync_reconcile_player_data() -> Result<PlayerReconcileSummary, String> {
    tauri::async_runtime::spawn_blocking(sync_reconcile_player_data_impl)
        .await
        .map_err(|e| format!("Player reconcile task panicked: {}", e))?
}

fn sync_reconcile_player_data_impl() -> Result<PlayerReconcileSummary, String> {
    app_log("Sync reconcile: starting");
    let (mut summary, _) = sync_pull_player_data_impl()?;
    let pushed = sync_push_player_data_impl()?;
    summary.pushed = pushed;
    app_log(&format!(
        "Sync reconcile: {} pulled, {} pushed, {} skipped",
        summary.pulled, summary.pushed, summary.skipped
    ));
    // Only emit reconcile rows when something actually moved or got skipped —
    // the 30s poll otherwise paints the user-visible Sync Log with "0 pulled,
    // 0 pushed, 0 skipped" rows that carry no diagnostic value. Diagnostics
    // still go to app_log above.
    if summary.pulled > 0 || summary.pushed > 0 || summary.skipped > 0 {
        let result = if summary.pulled == 0 && summary.pushed == 0 { "noop" } else { "success" };
        sync_log::emit(
            "ReconcilePlayerData",
            result,
            format!(
                "{} pulled, {} pushed, {} skipped",
                summary.pulled, summary.pushed, summary.skipped
            ),
        );
    }
    Ok(summary)
}

/// Delete a character's cloud copy. Manual-only — there's no auto-propagation
/// from local-disk deletions. A `.fch` vanishing locally just stops getting
/// pushed; it stays in the cloud until this command is invoked from the UI.
/// That's the propagation rule we landed on (msg-004 in MegaBugs ticket
/// 20260425-022017-3390a591) — auto-propagation was flagged as too risky
/// without a UI affirming intent, since a corrupt local file could otherwise
/// silently delete the cloud + peer copies.
#[command]
pub async fn sync_delete_player_data(character_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let settings = load_sync_settings();
        if !settings.enabled {
            return Err("Cloud sync is not enabled".to_string());
        }
        let identity = get_megaload_identity()?;
        let user_id = &identity.user_id;
        let path = sync_character_path(user_id, &character_name);

        // Need the file's SHA before we can delete via the GitHub Contents API.
        let (_, sha) = match github_get_file(&path) {
            Ok(t) => t,
            Err(e) if e.contains("404") => {
                app_log(&format!(
                    "Sync delete: {} already absent from cloud",
                    character_name
                ));
                sync_log::emit(
                    "DeletePlayerData",
                    "noop",
                    format!("{}: already absent from cloud", character_name),
                );
                return Ok(());
            }
            Err(e) => return Err(e),
        };

        github_delete_file(
            &path,
            &sha,
            &format!(
                "Sync delete {} — {}",
                character_name, identity.display_name
            ),
        )?;

        app_log(&format!(
            "Sync delete: removed cloud copy of {}",
            character_name
        ));
        sync_log::emit(
            "DeletePlayerData",
            "success",
            format!("Removed cloud copy of {}", character_name),
        );
        Ok(())
    })
    .await
    .map_err(|e| format!("Player delete task panicked: {}", e))?
}

// ---------------------------------------------------------------------------
// MegaList sync — merge-with-tombstones. Stale local can never wipe remote;
// it can only contribute additions. Concurrent pushes serialise via 409 retry.
// ---------------------------------------------------------------------------

const MEGA_LIST_VERSION: u32 = 1;
const TOMBSTONE_TTL_DAYS: i64 = 30;
const MAX_PUSH_RETRIES: u32 = 3;

fn sync_mega_list_path(user_id: &str) -> String {
    format!("sync/{}/lists.json", user_id)
}

/// Compute an ISO-8601 timestamp `n` days before now. Used as the GC cutoff.
fn iso_days_ago(days: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    secs_to_iso(now - days * 86400)
}

/// Pick the lexicographically larger of two optional strings (empty == "").
fn max_str(a: Option<&str>, b: Option<&str>) -> String {
    let a = a.unwrap_or("");
    let b = b.unwrap_or("");
    if a >= b { a.to_string() } else { b.to_string() }
}

/// Item watermark = max(updatedAt, addedAt, deletedAt). Used for per-item conflict tie-break.
fn item_watermark(it: &serde_json::Value) -> String {
    let updated = it.get("updatedAt").and_then(|v| v.as_str());
    let added = it.get("addedAt").and_then(|v| v.as_str());
    let deleted = it.get("deletedAt").and_then(|v| v.as_str());
    max_str(Some(&max_str(updated, added)), deleted)
}

/// List watermark = max(updatedAt, deletedAt).
fn list_watermark(l: &serde_json::Value) -> String {
    let updated = l.get("updatedAt").and_then(|v| v.as_str());
    let deleted = l.get("deletedAt").and_then(|v| v.as_str());
    max_str(updated, deleted)
}

/// Pick the item with the larger watermark; ties go to `b` (the incoming side).
fn pick_item(a: serde_json::Value, b: serde_json::Value) -> serde_json::Value {
    let wa = item_watermark(&a);
    let wb = item_watermark(&b);
    if wb >= wa { b } else { a }
}

/// Merge two list values. Items are unioned by `itemId` and per-item watermark
/// chooses the winner. Top-level fields (name, filterSnapshot, order, deletedAt)
/// come from the side with the larger list-level watermark, but items are
/// ALWAYS unioned so additions on either side persist.
fn merge_list(a: serde_json::Value, b: serde_json::Value, gc_cutoff: &str) -> serde_json::Value {
    let wa = list_watermark(&a);
    let wb = list_watermark(&b);
    let winner = if wb >= wa { &b } else { &a };

    // Build itemId → value map
    let empty: Vec<serde_json::Value> = vec![];
    let a_items = a.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
    let b_items = b.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);

    let mut by_id: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
    for it in a_items {
        if let Some(id) = it.get("itemId").and_then(|v| v.as_str()) {
            by_id.insert(id.to_string(), it.clone());
        }
    }
    for it in b_items {
        if let Some(id) = it.get("itemId").and_then(|v| v.as_str()) {
            match by_id.remove(id) {
                Some(prev) => {
                    by_id.insert(id.to_string(), pick_item(prev, it.clone()));
                }
                None => {
                    by_id.insert(id.to_string(), it.clone());
                }
            }
        }
    }

    // GC tombstoned items older than cutoff. A tombstone is older if its
    // deletedAt is < cutoff AND deletedAt >= updatedAt (i.e. the entity is
    // actually tombstoned, not just bearing a stale deletedAt).
    let mut merged_items: Vec<serde_json::Value> = by_id
        .into_values()
        .filter(|it| {
            let del = it.get("deletedAt").and_then(|v| v.as_str()).unwrap_or("");
            if del.is_empty() { return true; }
            let upd = it.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
            let added = it.get("addedAt").and_then(|v| v.as_str()).unwrap_or("");
            let last_live = if upd >= added { upd } else { added };
            // Keep if the tombstone is fresher than the cutoff OR if the entity is
            // live (deletedAt < last_live, meaning a more recent revival happened).
            del >= gc_cutoff || del < last_live
        })
        .collect();

    // Stable order — sort by addedAt then itemId so the JSON output is deterministic.
    merged_items.sort_by(|x, y| {
        let xa = x.get("addedAt").and_then(|v| v.as_str()).unwrap_or("");
        let ya = y.get("addedAt").and_then(|v| v.as_str()).unwrap_or("");
        xa.cmp(ya).then_with(|| {
            let xi = x.get("itemId").and_then(|v| v.as_str()).unwrap_or("");
            let yi = y.get("itemId").and_then(|v| v.as_str()).unwrap_or("");
            xi.cmp(yi)
        })
    });

    let mut merged = winner.clone();
    merged["items"] = serde_json::Value::Array(merged_items);
    merged
}

/// Merge two top-level blobs. Lists are unioned by `id`; per-list, `merge_list`
/// resolves. Tombstoned lists older than the cutoff are GC'd from the output.
/// Returns the merged blob with a fresh top-level updated_at.
fn merge_blobs(local: serde_json::Value, remote: serde_json::Value) -> serde_json::Value {
    let gc_cutoff = iso_days_ago(TOMBSTONE_TTL_DAYS);

    let empty: Vec<serde_json::Value> = vec![];
    let local_lists = local.get("lists").and_then(|v| v.as_array()).unwrap_or(&empty);
    let remote_lists = remote.get("lists").and_then(|v| v.as_array()).unwrap_or(&empty);

    let mut by_id: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
    for l in remote_lists {
        if let Some(id) = l.get("id").and_then(|v| v.as_str()) {
            by_id.insert(id.to_string(), l.clone());
        }
    }
    for l in local_lists {
        if let Some(id) = l.get("id").and_then(|v| v.as_str()) {
            match by_id.remove(id) {
                Some(remote_side) => {
                    by_id.insert(id.to_string(), merge_list(remote_side, l.clone(), &gc_cutoff));
                }
                None => {
                    // Even when only present on one side, run through merge_list against an
                    // empty stub so item-level GC still applies.
                    let stub = serde_json::json!({ "items": [] });
                    by_id.insert(id.to_string(), merge_list(stub, l.clone(), &gc_cutoff));
                }
            }
        }
    }
    // Lists that exist only in remote also need item-level GC.
    let mut remote_only: Vec<serde_json::Value> = Vec::new();
    for l in remote_lists {
        if let Some(id) = l.get("id").and_then(|v| v.as_str()) {
            if !by_id.contains_key(id) {
                let stub = serde_json::json!({ "items": [] });
                remote_only.push(merge_list(stub, l.clone(), &gc_cutoff));
            }
        }
    }
    let mut merged_lists: Vec<serde_json::Value> = by_id.into_values().chain(remote_only).collect();

    // GC list-level tombstones using the same logic as items.
    merged_lists.retain(|l| {
        let del = l.get("deletedAt").and_then(|v| v.as_str()).unwrap_or("");
        if del.is_empty() { return true; }
        let upd = l.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        del >= gc_cutoff.as_str() || del < upd
    });

    // Stable order by createdAt then id for deterministic JSON output.
    merged_lists.sort_by(|x, y| {
        let xc = x.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let yc = y.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        xc.cmp(yc).then_with(|| {
            let xi = x.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let yi = y.get("id").and_then(|v| v.as_str()).unwrap_or("");
            xi.cmp(yi)
        })
    });

    // updated_at = max watermark across all merged lists (including tombstoned),
    // bumped to now if anything changed. Use now to keep advancing forward.
    let updated_at = iso_now();
    let device_id = local.get("device_id").and_then(|v| v.as_str()).unwrap_or("");

    serde_json::json!({
        "version": MEGA_LIST_VERSION,
        "device_id": device_id,
        "updated_at": updated_at,
        "lists": merged_lists,
    })
}

/// Compare two blobs for sync-relevant equality (ignores top-level updated_at
/// and device_id, which are bumped on every push). True == identical content.
fn blobs_content_equal(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    a.get("lists") == b.get("lists")
}

/// Merge `local_blob_json` against the remote, push the merged result with
/// 409-retry, and return the merged blob JSON. If the merged content matches
/// remote exactly, no PUT happens.
fn merge_and_push_mega_lists(local_blob_json: &str) -> Result<String, String> {
    let local: serde_json::Value = serde_json::from_str(local_blob_json)
        .map_err(|e| format!("Invalid local MegaList blob JSON: {}", e))?;

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;
    let remote_path = sync_mega_list_path(user_id);

    let mut attempt = 0u32;
    loop {
        attempt += 1;
        let (remote_json, remote_sha) = match github_get_file(&remote_path) {
            Ok((content, sha)) => (content, Some(sha)),
            Err(e) if e.contains("404") => {
                let empty = serde_json::json!({
                    "version": MEGA_LIST_VERSION,
                    "device_id": "",
                    "updated_at": "1970-01-01T00:00:00.000Z",
                    "lists": [],
                });
                (empty.to_string(), None)
            }
            Err(e) => return Err(e),
        };
        let remote: serde_json::Value = serde_json::from_str(&remote_json)
            .map_err(|e| format!("Invalid remote MegaList blob JSON: {}", e))?;

        let merged = merge_blobs(local.clone(), remote.clone());

        // No-op short-circuit: if the merge produced the same content as remote,
        // skip the PUT entirely so we don't churn git history with empty commits.
        if blobs_content_equal(&merged, &remote) {
            let list_count = merged.get("lists").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            app_log(&format!(
                "MegaList sync: merged content matches remote ({} lists) — no push",
                list_count
            ));
            // Deliberately NOT emitting a sync_log event for noop reconciles —
            // the 30s poll cadence floods the user-visible Sync Log with
            // "no changes" rows. Diagnostics still go to app_log above.
            return Ok(remote_json);
        }

        let merged_json = serde_json::to_string(&merged)
            .map_err(|e| format!("Serialise merged blob failed: {}", e))?;

        match github_put_file(
            &remote_path,
            merged_json.as_bytes(),
            &format!("MegaList sync — {}", identity.display_name),
            remote_sha.as_deref(),
        ) {
            Ok(_) => {
                let list_count = merged.get("lists").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                app_log(&format!(
                    "MegaList sync: pushed merged blob ({} lists, attempt {}/{})",
                    list_count, attempt, MAX_PUSH_RETRIES
                ));
                sync_log::emit(
                    "ReconcileMegaLists",
                    "success",
                    format!("Pushed merged blob — {} lists", list_count),
                );
                return Ok(merged_json);
            }
            Err(e) if e.contains("409") && attempt < MAX_PUSH_RETRIES => {
                // Concurrent push from another device — refetch + remerge + retry.
                app_log(&format!(
                    "MegaList sync: 409 conflict on attempt {} — retrying with fresh remote",
                    attempt
                ));
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Push the local MegaList blob via merge-with-tombstones.
/// Returns true if the remote was actually updated, false if the merged content
/// already matched remote (no-op short-circuit). Kept for back-compat; new code
/// should use `sync_reconcile_mega_lists` which returns the merged blob.
#[command]
pub async fn sync_push_mega_lists(blob_json: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let settings = load_sync_settings();
        if !settings.enabled {
            return Err("Cloud sync is not enabled".to_string());
        }
        let merged_json = merge_and_push_mega_lists(&blob_json)?;
        // Compare merged result to input; if identical (modulo top-level updated_at), no push.
        let local: serde_json::Value = serde_json::from_str(&blob_json).unwrap_or(serde_json::json!({}));
        let merged: serde_json::Value = serde_json::from_str(&merged_json).unwrap_or(serde_json::json!({}));
        Ok(!blobs_content_equal(&local, &merged))
    })
    .await
    .map_err(|e| format!("MegaList push task panicked: {}", e))?
}

/// Pull the remote MegaList blob. Returns the raw JSON string so the
/// frontend can deserialize into its own TS types. Returns an empty-blob
/// JSON when no remote file exists. Note: this does NOT merge — for sync use
/// `sync_reconcile_mega_lists` which is merge-aware.
#[command]
pub async fn sync_pull_mega_lists() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(sync_pull_mega_lists_impl)
        .await
        .map_err(|e| format!("MegaList pull task panicked: {}", e))?
}

fn sync_pull_mega_lists_impl() -> Result<String, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;
    let remote_path = sync_mega_list_path(user_id);

    match github_get_file(&remote_path) {
        Ok((content, _)) => {
            let list_count = serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|v| v.get("lists").and_then(|a| a.as_array()).map(|a| a.len()))
                .unwrap_or(0);
            app_log("MegaList pull: fetched remote blob");
            sync_log::emit(
                "PullMegaLists",
                "success",
                format!("Fetched remote blob — {} lists", list_count),
            );
            Ok(content)
        }
        Err(e) if e.contains("404") => {
            app_log("MegaList pull: no remote blob yet");
            sync_log::emit("PullMegaLists", "noop", "No remote blob yet");
            let empty = serde_json::json!({
                "version": MEGA_LIST_VERSION,
                "device_id": settings.machine_id,
                "updated_at": "1970-01-01T00:00:00.000Z",
                "lists": [],
            });
            Ok(empty.to_string())
        }
        Err(e) => Err(e),
    }
}

/// Reconcile: caller sends local blob, we fetch remote, merge, push merged
/// back (with 409-retry), and return the merged blob. The caller MUST
/// overwrite its local store with the returned blob — no more "did remote win"
/// branching, the merge is the answer.
#[command]
pub async fn sync_reconcile_mega_lists(local_blob_json: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let settings = load_sync_settings();
        if !settings.enabled {
            return Err("Cloud sync is not enabled".to_string());
        }
        merge_and_push_mega_lists(&local_blob_json)
    })
    .await
    .map_err(|e| format!("MegaList reconcile task panicked: {}", e))?
}

#[cfg(test)]
mod megalist_merge_tests {
    use super::*;
    use serde_json::json;

    fn list_ids(blob: &serde_json::Value) -> Vec<String> {
        blob.get("lists")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|l| l.get("id").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn item_ids(list: &serde_json::Value) -> Vec<String> {
        list.get("items")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|it| it.get("itemId").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The Lady Emz scenario: laptop has 24 lists, desktop has 3 lists, neither
    /// shares any list IDs. After merge, all 27 must survive — neither side
    /// can wipe the other.
    #[test]
    fn empty_local_cannot_wipe_populated_remote() {
        let local = json!({
            "version": 1, "device_id": "desktop", "updated_at": "2026-04-25T00:00:00Z",
            "lists": [
                { "id": "new-1", "name": "Plantable", "createdAt": "2026-04-24T00:00:00Z",
                  "updatedAt": "2026-04-25T00:00:00Z", "items": [] },
                { "id": "new-2", "name": "Building", "createdAt": "2026-04-24T00:00:00Z",
                  "updatedAt": "2026-04-25T00:00:00Z", "items": [] }
            ]
        });
        let remote = json!({
            "version": 1, "device_id": "laptop", "updated_at": "2026-04-23T08:54:30Z",
            "lists": [
                { "id": "old-1", "name": "Mead", "createdAt": "2026-04-19T00:00:00Z",
                  "updatedAt": "2026-04-23T08:54:00Z", "items": [] },
                { "id": "old-2", "name": "Pet Food", "createdAt": "2026-04-19T00:00:00Z",
                  "updatedAt": "2026-04-23T08:54:00Z", "items": [] }
            ]
        });
        let merged = merge_blobs(local, remote);
        let ids = list_ids(&merged);
        assert!(ids.contains(&"old-1".to_string()), "old-1 must survive merge");
        assert!(ids.contains(&"old-2".to_string()), "old-2 must survive merge");
        assert!(ids.contains(&"new-1".to_string()), "new-1 must survive merge");
        assert!(ids.contains(&"new-2".to_string()), "new-2 must survive merge");
        assert_eq!(ids.len(), 4);
    }

    /// Tombstones win against older live state — a delete on one device must
    /// propagate to the other. But a tombstone older than its peer's update
    /// loses (because the peer revived/edited the entity later).
    #[test]
    fn tombstone_propagates_when_newer() {
        // Local deletes the list at t=10
        let local = json!({
            "version": 1, "device_id": "a", "updated_at": "2026-04-25T00:00:10Z",
            "lists": [
                { "id": "L1", "name": "Foo", "createdAt": "2026-04-25T00:00:00Z",
                  "updatedAt": "2026-04-25T00:00:10Z", "deletedAt": "2026-04-25T00:00:10Z",
                  "items": [] }
            ]
        });
        // Remote still has the live list, last seen at t=5
        let remote = json!({
            "version": 1, "device_id": "b", "updated_at": "2026-04-25T00:00:05Z",
            "lists": [
                { "id": "L1", "name": "Foo", "createdAt": "2026-04-25T00:00:00Z",
                  "updatedAt": "2026-04-25T00:00:05Z", "items": [] }
            ]
        });
        let merged = merge_blobs(local, remote);
        let l = &merged.get("lists").unwrap().as_array().unwrap()[0];
        assert!(l.get("deletedAt").and_then(|v| v.as_str()).is_some(),
            "merged list should carry the tombstone");
    }

    /// Concurrent item edits union — no item gets dropped just because the
    /// other side didn't have it yet.
    #[test]
    fn item_edits_union_per_list() {
        let local = json!({
            "version": 1, "device_id": "a", "updated_at": "2026-04-25T00:00:10Z",
            "lists": [{
                "id": "L1", "name": "Stuff", "createdAt": "2026-04-25T00:00:00Z",
                "updatedAt": "2026-04-25T00:00:10Z",
                "items": [
                    { "itemId": "item-A", "checked": false, "addedAt": "2026-04-25T00:00:01Z",
                      "updatedAt": "2026-04-25T00:00:01Z", "source": "manual" },
                    { "itemId": "item-B", "checked": true, "addedAt": "2026-04-25T00:00:10Z",
                      "updatedAt": "2026-04-25T00:00:10Z", "source": "manual" }
                ]
            }]
        });
        let remote = json!({
            "version": 1, "device_id": "b", "updated_at": "2026-04-25T00:00:08Z",
            "lists": [{
                "id": "L1", "name": "Stuff", "createdAt": "2026-04-25T00:00:00Z",
                "updatedAt": "2026-04-25T00:00:08Z",
                "items": [
                    { "itemId": "item-A", "checked": false, "addedAt": "2026-04-25T00:00:01Z",
                      "updatedAt": "2026-04-25T00:00:01Z", "source": "manual" },
                    { "itemId": "item-C", "checked": false, "addedAt": "2026-04-25T00:00:08Z",
                      "updatedAt": "2026-04-25T00:00:08Z", "source": "manual" }
                ]
            }]
        });
        let merged = merge_blobs(local, remote);
        let l = &merged.get("lists").unwrap().as_array().unwrap()[0];
        let ids = item_ids(l);
        assert!(ids.contains(&"item-A".to_string()));
        assert!(ids.contains(&"item-B".to_string()), "B must survive (only on local)");
        assert!(ids.contains(&"item-C".to_string()), "C must survive (only on remote)");
        assert_eq!(ids.len(), 3);
    }

    /// Tombstones older than the GC cutoff get dropped from the merged blob —
    /// otherwise the blob grows forever as users delete lists.
    #[test]
    fn old_tombstones_get_gc_collected() {
        // Tombstone from 60 days ago is well past the 30-day TTL.
        let old_tomb = "2026-02-01T00:00:00Z";
        let local = json!({
            "version": 1, "device_id": "a", "updated_at": "2026-04-25T00:00:00Z",
            "lists": [
                { "id": "L1", "name": "Old", "createdAt": "2026-01-01T00:00:00Z",
                  "updatedAt": old_tomb, "deletedAt": old_tomb, "items": [] }
            ]
        });
        let remote = json!({
            "version": 1, "device_id": "b", "updated_at": "2026-04-24T00:00:00Z",
            "lists": []
        });
        let merged = merge_blobs(local, remote);
        let ids = list_ids(&merged);
        assert!(!ids.contains(&"L1".to_string()),
            "old tombstoned list should be GC'd, got {:?}", ids);
    }

    /// Push-no-op short-circuit: when local content already matches remote
    /// (same lists, same items, only updated_at differs), the merged blob
    /// equals remote and we don't need a redundant PUT.
    #[test]
    fn identical_content_no_op() {
        let lists = json!([
            { "id": "L1", "name": "Foo", "createdAt": "2026-04-25T00:00:00Z",
              "updatedAt": "2026-04-25T00:00:05Z",
              "items": [
                  { "itemId": "x", "checked": false, "addedAt": "2026-04-25T00:00:00Z",
                    "updatedAt": "2026-04-25T00:00:00Z", "source": "manual" }
              ] }
        ]);
        let local = json!({
            "version": 1, "device_id": "a", "updated_at": "2026-04-25T01:00:00Z",
            "lists": lists.clone()
        });
        let remote = json!({
            "version": 1, "device_id": "b", "updated_at": "2026-04-25T00:30:00Z",
            "lists": lists
        });
        let merged = merge_blobs(local, remote.clone());
        assert!(blobs_content_equal(&merged, &remote),
            "merged content should equal remote content when nothing changed");
    }
}

#[cfg(test)]
mod profile_bundle_merge_tests {
    use super::*;

    fn make_bundle(
        name: &str,
        last_updated: &str,
        configs: &[(&str, &str, &str)],
    ) -> SyncProfileBundle {
        let mut map = HashMap::new();
        for (file, content, ts) in configs {
            map.insert(
                file.to_string(),
                ConfigEntry {
                    content: content.to_string(),
                    updated_at: ts.to_string(),
                },
            );
        }
        SyncProfileBundle {
            profile_id: "p1".to_string(),
            profile_name: name.to_string(),
            last_updated: last_updated.to_string(),
            mods: vec![],
            thunderstore_mods: vec![],
            configs: map,
            trainer_state: None,
            mods_updated_at: last_updated.to_string(),
        }
    }

    /// Two devices each edit a *different* .cfg file in the same profile,
    /// concurrently. Before the per-config merge fix, the second push
    /// overwrote the first's edit because the bundle was a single blob.
    /// After the fix, both edits must survive the merge.
    #[test]
    fn concurrent_edits_to_different_cfg_files_both_survive() {
        let local = make_bundle(
            "default",
            "2026-04-25T00:00:10Z",
            &[
                ("MegaShot.cfg", "shot=local-edit", "2026-04-25T00:00:10Z"),
                ("MegaHoe.cfg",  "hoe=remote-edit", "2026-04-25T00:00:05Z"),
            ],
        );
        let remote = make_bundle(
            "default",
            "2026-04-25T00:00:08Z",
            &[
                ("MegaShot.cfg", "shot=old",         "2026-04-25T00:00:01Z"),
                ("MegaHoe.cfg",  "hoe=remote-edit",  "2026-04-25T00:00:05Z"),
                ("MegaQoL.cfg",  "qol=remote-only",  "2026-04-25T00:00:02Z"),
            ],
        );
        let merged = merge_profile_bundle(local, remote);
        assert_eq!(merged.configs.get("MegaShot.cfg").unwrap().content, "shot=local-edit",
            "local's newer edit must win for MegaShot.cfg");
        assert_eq!(merged.configs.get("MegaHoe.cfg").unwrap().content, "hoe=remote-edit",
            "MegaHoe.cfg unchanged — equal-watermark tie keeps remote");
        assert_eq!(merged.configs.get("MegaQoL.cfg").unwrap().content, "qol=remote-only",
            "remote-only file must NOT be dropped from merged bundle");
        assert_eq!(merged.configs.len(), 3);
    }

    /// Reverse direction: remote has the newer edit for a file local hasn't
    /// touched. Remote must win for that file even though local's
    /// bundle-level last_updated is fresher (because local just got around
    /// to pushing some other unrelated change).
    #[test]
    fn remote_newer_per_file_beats_local_bundle_timestamp() {
        let local = make_bundle(
            "default",
            "2026-04-25T01:00:00Z",
            &[("MegaShot.cfg", "shot=stale-local", "2026-04-25T00:00:01Z")],
        );
        let remote = make_bundle(
            "default",
            "2026-04-25T00:30:00Z",
            &[("MegaShot.cfg", "shot=fresh-remote", "2026-04-25T00:25:00Z")],
        );
        let merged = merge_profile_bundle(local, remote);
        assert_eq!(merged.configs.get("MegaShot.cfg").unwrap().content, "shot=fresh-remote",
            "per-file watermark beats bundle-level last_updated");
    }

    /// v1 bundles (bare-string configs) round-trip through the v2 schema by
    /// promoting each entry with the bundle-level `last_updated` as fallback.
    /// A device that hasn't been upgraded yet can still publish a v1 bundle
    /// and the v2 client must read it without exploding.
    #[test]
    fn legacy_v1_bundle_promotes_to_v2_on_parse() {
        let v1_json = r#"{
            "profile_id": "p1",
            "profile_name": "default",
            "last_updated": "2026-04-25T00:00:00Z",
            "mods": [],
            "thunderstore_mods": [],
            "configs": {
                "MegaShot.cfg": "shot=v1-data",
                "MegaHoe.cfg": "hoe=v1-data"
            },
            "trainer_state": "{\"opens\":3}"
        }"#;
        let parsed = parse_bundle(v1_json).expect("v1 parse must succeed");
        assert_eq!(parsed.configs.len(), 2);
        let shot = parsed.configs.get("MegaShot.cfg").expect("MegaShot present");
        assert_eq!(shot.content, "shot=v1-data");
        assert_eq!(shot.updated_at, "2026-04-25T00:00:00Z",
            "v1 entry must inherit bundle's last_updated as the fallback watermark");
        let trainer = parsed.trainer_state.expect("trainer state present");
        assert_eq!(trainer.content, "{\"opens\":3}");
        assert_eq!(trainer.updated_at, "2026-04-25T00:00:00Z");
    }

    /// v2 bundles parse without losing the per-file timestamps.
    #[test]
    fn v2_bundle_parses_with_per_file_timestamps() {
        let v2_json = r#"{
            "profile_id": "p1",
            "profile_name": "default",
            "last_updated": "2026-04-25T00:00:00Z",
            "mods": [],
            "thunderstore_mods": [],
            "configs": {
                "MegaShot.cfg": { "content": "shot=v2", "updated_at": "2026-04-25T00:00:05Z" }
            }
        }"#;
        let parsed = parse_bundle(v2_json).expect("v2 parse must succeed");
        let shot = parsed.configs.get("MegaShot.cfg").expect("MegaShot present");
        assert_eq!(shot.content, "shot=v2");
        assert_eq!(shot.updated_at, "2026-04-25T00:00:05Z",
            "v2 per-file updated_at must round-trip exactly");
    }

    /// Trainer state is single-keyed but uses the same per-entry watermark.
    /// Whichever side has the newer timestamp wins.
    #[test]
    fn trainer_state_picks_by_watermark() {
        let mut local = make_bundle("default", "2026-04-25T00:00:00Z", &[]);
        local.trainer_state = Some(ConfigEntry {
            content: "{\"opens\":5}".to_string(),
            updated_at: "2026-04-25T00:00:10Z".to_string(),
        });
        let mut remote = make_bundle("default", "2026-04-25T00:00:00Z", &[]);
        remote.trainer_state = Some(ConfigEntry {
            content: "{\"opens\":2}".to_string(),
            updated_at: "2026-04-25T00:00:01Z".to_string(),
        });
        let merged = merge_profile_bundle(local, remote);
        let t = merged.trainer_state.expect("trainer state present");
        assert_eq!(t.content, "{\"opens\":5}", "newer trainer state must win");
    }

    /// The merged bundle's mods array follows the bundle-level last_updated
    /// (mods describe the active installed set, not freely-editable content).
    /// Local newer ⇒ local mods wins.
    #[test]
    fn mods_follow_bundle_level_watermark() {
        let mut local = make_bundle("default", "2026-04-25T00:00:10Z", &[]);
        local.mods.push(SyncModEntry {
            name: "MegaShot".to_string(),
            file_name: "MegaShot.dll".to_string(),
            version: None,
            enabled: true,
            source: "manual".to_string(),
        });
        let mut remote = make_bundle("default", "2026-04-25T00:00:05Z", &[]);
        remote.mods.push(SyncModEntry {
            name: "MegaHoe".to_string(),
            file_name: "MegaHoe.dll".to_string(),
            version: None,
            enabled: true,
            source: "manual".to_string(),
        });
        let merged = merge_profile_bundle(local, remote);
        let names: Vec<String> = merged.mods.iter().map(|m| m.name.clone()).collect();
        assert!(names.contains(&"MegaShot".to_string()),
            "local-newer bundle's mod set must win, got {:?}", names);
        assert!(!names.contains(&"MegaHoe".to_string()),
            "stale remote mod set must NOT contribute, got {:?}", names);
    }
}
