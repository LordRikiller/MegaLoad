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
    RemovedProfile, SyncManifest, SyncModEntry, SyncProfileEntry,
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
        last_seen_remote_sync: None,
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

/// A mod tombstone — a mod that was uninstalled on some device. Carried in a
/// SEPARATE bundle field (`removed_mods`) rather than as a flag on SyncModEntry
/// so that older clients, which don't know the field, simply ignore it (they
/// keep the old "mods = present set" semantics) instead of mistaking a tombstone
/// for an installed mod. New clients uninstall these on pull when the tombstone
/// is newer than their local copy (mirror-uninstall).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemovedMod {
    pub name: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub source: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncProfileBundle {
    pub profile_id: String,
    pub profile_name: String,
    pub last_updated: String,
    pub mods: Vec<SyncModEntry>,
    /// Mod tombstones — mods removed on some device, for mirror-uninstall.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_mods: Vec<RemovedMod>,
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
    /// actually change (assigned by the persisted ledger in `snapshot_bundle`).
    /// Lets the merge pick the device that last *edited* the mod set rather than
    /// the one that pushed last. Defaults to empty on legacy bundles (oldest).
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
    removed_mods: Vec<RemovedMod>,
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
    // Seed each mod's per-mod watermark from the bundle-level watermark when a
    // pre-per-mod bundle (v1.10.62 and earlier) left it empty, so LWW has a
    // usable timestamp for legacy entries.
    let mods: Vec<SyncModEntry> = raw
        .mods
        .into_iter()
        .map(|mut m| {
            if m.updated_at.is_empty() {
                m.updated_at = mods_updated_at.clone();
            }
            m
        })
        .collect();
    let removed_mods: Vec<RemovedMod> = raw
        .removed_mods
        .into_iter()
        .map(|mut r| {
            if r.updated_at.is_empty() {
                r.updated_at = mods_updated_at.clone();
            }
            r
        })
        .collect();
    Ok(SyncProfileBundle {
        profile_id: raw.profile_id,
        profile_name: raw.profile_name,
        last_updated: raw.last_updated,
        mods,
        removed_mods,
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

// NOTE: the former mtime-restamp helpers (days_from_civil / iso_to_unix_secs /
// restamp_file_mtime) were removed with the mtime-based config merge. Config
// versioning no longer derives from filesystem mtime at all — see the
// persistent sync-state ledger below.

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

// ---------------------------------------------------------------------------
// Persistent per-profile sync-state ledger — the honest content watermark
// ---------------------------------------------------------------------------
//
// The old design derived a config's "edit time" from its filesystem mtime.
// mtime is bumped wholesale whenever BepInEx rewrites a `.cfg` on game launch
// (the ConfigPruner sweep, default-binding, format tidy-ups) or the file is
// copied — so the device that launched Valheim most recently owned the freshest
// mtimes and won EVERY per-file merge, pushing its *stale* configs over the
// other device's real edits (and rejecting inbound edits on pull). That is the
// root cause of "config changes don't sync PC-to-PC".
//
// This ledger records, per file, the hash of the content we last saw and the
// timestamp that content *actually* changed. `refresh_local_state`
// (folded into `snapshot_bundle`) bumps `updated_at` only when the hash
// genuinely changes, so a no-op BepInEx rewrite no longer moves the watermark.
// It is persisted to disk so it survives restarts — the mod watermark used to
// live in-memory and reset to `now` on every launch, which is the same class
// of bug for enabled/disabled state (whoever restarted last won the mod set).
//
// The on-wire bundle format is unchanged; only HOW `updated_at` is computed
// (and how the pull decides a winner) changes. Existing cloud bundles remain
// readable.

/// Per-file content revision: the hash we last saw + when that content changed.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
struct FileRev {
    hash: String,
    updated_at: String,
}

/// Per-mod revision: last-known state of one mod + when it last changed.
/// `removed = true` is a tombstone (the mod was uninstalled here). Keyed by mod
/// name in the ledger. Drives per-mod LWW so installs, uninstalls and enable
/// flips each propagate independently instead of an all-or-nothing mod list.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
struct ModRev {
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    removed: bool,
    updated_at: String,
}

/// Persistent honest-watermark ledger for one profile. Stored at
/// `%APPDATA%/MegaLoad/sync_state/<profile_id>.json`.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
struct ProfileSyncState {
    #[serde(default)]
    configs: HashMap<String, FileRev>,
    #[serde(default)]
    trainer_state: Option<FileRev>,
    /// Per-mod ledger keyed by mod name (present mods + tombstones).
    #[serde(default)]
    mods: HashMap<String, ModRev>,
}

fn sync_state_dir() -> PathBuf {
    megaload_data_dir().join("sync_state")
}

fn sync_state_path(profile_id: &str) -> PathBuf {
    // profile_id is normally a UUID; sanitise defensively for filesystem use.
    let safe: String = profile_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    sync_state_dir().join(format!("{}.json", safe))
}

fn load_profile_state(profile_id: &str) -> ProfileSyncState {
    let path = sync_state_path(profile_id);
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<ProfileSyncState>(&data) {
            return s;
        }
    }
    ProfileSyncState::default()
}

fn save_profile_state(profile_id: &str, state: &ProfileSyncState) {
    let dir = sync_state_dir();
    if fs::create_dir_all(&dir).is_ok() {
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(sync_state_path(profile_id), json);
        }
    }
}

/// Stable content hash of a string (FNV-1a). Used as the ledger's change key.
fn content_hash(s: &str) -> String {
    format!("{:016x}", fnv1a_hash(s.as_bytes()))
}

// ---------------------------------------------------------------------------
// Manifest (profile-list) ledger — honest per-profile watermarks + tombstones
// ---------------------------------------------------------------------------
//
// The sync manifest is the source of "which profiles exist". It used to be a
// whole-list last-writer-wins overwrite with no deletion signal, so deleting a
// profile on one device was reverted: the other device (which still had it)
// re-published it, and the pull auto-created it back. This ledger records each
// profile's last-known state + when it changed, and tombstones a profile the
// moment it disappears from the local list — exactly the mod-tombstone pattern,
// one level up. Persisted at `%APPDATA%/MegaLoad/sync_state/_manifest.json`.

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
struct ProfileLedgerEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    removed: bool,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
struct ManifestLedger {
    #[serde(default)]
    profiles: HashMap<String, ProfileLedgerEntry>,
}

fn manifest_ledger_path() -> PathBuf {
    sync_state_dir().join("_manifest.json")
}

fn load_manifest_ledger() -> ManifestLedger {
    if let Ok(data) = fs::read_to_string(manifest_ledger_path()) {
        if let Ok(l) = serde_json::from_str::<ManifestLedger>(&data) {
            return l;
        }
    }
    ManifestLedger::default()
}

fn save_manifest_ledger(led: &ManifestLedger) {
    let dir = sync_state_dir();
    if fs::create_dir_all(&dir).is_ok() {
        if let Ok(json) = serde_json::to_string_pretty(led) {
            let _ = fs::write(manifest_ledger_path(), json);
        }
    }
}

/// Reconcile the manifest ledger against the device's current profile list:
/// bump newly-seen profiles, tombstone profiles gone from the list, GC old
/// tombstones. Returns (present entries with watermarks, tombstones) for
/// building this device's manifest view. Only `name` drives the watermark bump
/// (not `is_active` — that's per-device and would otherwise churn the manifest).
fn reconcile_manifest_ledger(desired: &[SyncProfileEntry]) -> (Vec<SyncProfileEntry>, Vec<RemovedProfile>) {
    let mut led = load_manifest_ledger();
    let now = iso_now();
    let mut present_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut present: Vec<SyncProfileEntry> = Vec::new();
    for p in desired {
        present_ids.insert(p.id.clone());
        let updated_at = match led.profiles.get(&p.id) {
            Some(e) if !e.removed && e.name == p.name => e.updated_at.clone(),
            _ => now.clone(),
        };
        led.profiles.insert(
            p.id.clone(),
            ProfileLedgerEntry { name: p.name.clone(), removed: false, updated_at: updated_at.clone() },
        );
        present.push(SyncProfileEntry {
            id: p.id.clone(),
            name: p.name.clone(),
            is_active: p.is_active,
            is_linked: false,
            updated_at,
        });
    }
    for (id, e) in led.profiles.iter_mut() {
        if !present_ids.contains(id) && !e.removed {
            e.removed = true;
            e.updated_at = now.clone();
        }
    }
    let gc = iso_days_ago(TOMBSTONE_TTL_DAYS);
    led.profiles.retain(|_, e| !(e.removed && e.updated_at < gc));
    let removed: Vec<RemovedProfile> = led
        .profiles
        .iter()
        .filter(|(_, e)| e.removed)
        .map(|(id, e)| RemovedProfile { id: id.clone(), name: e.name.clone(), updated_at: e.updated_at.clone() })
        .collect();
    save_manifest_ledger(&led);
    (present, removed)
}

/// Seed per-profile watermarks on a remote manifest whose entries predate the
/// per-profile field (v1.10.64 and earlier), using the manifest's `last_sync`
/// so LWW has a sane (older-than-a-fresh-tombstone) timestamp for legacy rows.
fn seed_manifest_watermarks(m: &SyncManifest) -> (Vec<SyncProfileEntry>, Vec<RemovedProfile>) {
    let fallback = if m.last_sync.is_empty() { "1970-01-01T00:00:00Z".to_string() } else { m.last_sync.clone() };
    let present = m
        .profiles
        .iter()
        .map(|p| {
            let mut e = p.clone();
            if e.updated_at.is_empty() {
                e.updated_at = fallback.clone();
            }
            e
        })
        .collect();
    let removed = m
        .removed_profiles
        .iter()
        .map(|r| {
            let mut e = r.clone();
            if e.updated_at.is_empty() {
                e.updated_at = fallback.clone();
            }
            e
        })
        .collect();
    (present, removed)
}

/// Merge two profile-list views (present + tombstones) per-profile by watermark
/// — newest wins across present and removed; exact tie keeps the profile live
/// (don't delete on a clock tie). Returns (present, removed).
fn merge_manifest_profiles(
    local_present: &[SyncProfileEntry],
    local_removed: &[RemovedProfile],
    remote_present: &[SyncProfileEntry],
    remote_removed: &[RemovedProfile],
) -> (Vec<SyncProfileEntry>, Vec<RemovedProfile>) {
    let mut present_map: HashMap<String, SyncProfileEntry> = HashMap::new();
    for p in remote_present.iter().chain(local_present.iter()) {
        match present_map.get(&p.id) {
            Some(cur) if cur.updated_at >= p.updated_at => {}
            _ => {
                present_map.insert(p.id.clone(), p.clone());
            }
        }
    }
    let mut removed_map: HashMap<String, RemovedProfile> = HashMap::new();
    for r in remote_removed.iter().chain(local_removed.iter()) {
        match removed_map.get(&r.id) {
            Some(cur) if cur.updated_at >= r.updated_at => {}
            _ => {
                removed_map.insert(r.id.clone(), r.clone());
            }
        }
    }
    let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    ids.extend(present_map.keys().cloned());
    ids.extend(removed_map.keys().cloned());
    let mut out_present: Vec<SyncProfileEntry> = Vec::new();
    let mut out_removed: Vec<RemovedProfile> = Vec::new();
    for id in ids {
        match (present_map.get(&id), removed_map.get(&id)) {
            (Some(p), Some(r)) => {
                if r.updated_at > p.updated_at {
                    out_removed.push(r.clone());
                } else {
                    out_present.push(p.clone());
                }
            }
            (Some(p), None) => out_present.push(p.clone()),
            (None, Some(r)) => out_removed.push(r.clone()),
            (None, None) => {}
        }
    }
    out_present.sort_by(|a, b| a.id.cmp(&b.id));
    out_removed.sort_by(|a, b| a.id.cmp(&b.id));
    (out_present, out_removed)
}

// ---------------------------------------------------------------------------
// Profile snapshot — reads current local state into a bundle
// ---------------------------------------------------------------------------

/// Read current local state into a bundle, deriving each per-file `updated_at`
/// from the persistent ledger rather than filesystem mtime. This is the single
/// place the ledger is reconciled with disk: a file whose content hash is
/// unchanged keeps its stored watermark (immune to BepInEx-relaunch churn); a
/// genuinely changed file gets `updated_at = now`; a never-before-seen file is
/// seeded from its mtime (best-effort bootstrap for pre-existing files on the
/// first run after upgrade — from then on it tracks honestly).
fn snapshot_bundle(profile_id: &str, profile_name: &str, bepinex_path: &str) -> Result<SyncProfileBundle, String> {
    let bep = Path::new(bepinex_path);
    let mods = scan_profile_mods(bepinex_path)?;

    let ts_mods = read_thunderstore_tracking(bepinex_path);
    let now = iso_now();
    let mut state = load_profile_state(profile_id);

    // --- Configs: reconcile the ledger; honest watermark per file ---
    let config_dir = bep.join("config");
    let raw_configs = read_all_config_contents(bepinex_path);
    let mut configs: HashMap<String, ConfigEntry> = HashMap::new();
    for (name, content) in &raw_configs {
        let h = content_hash(content);
        let updated_at = match state.configs.get(name) {
            Some(rev) if rev.hash == h => rev.updated_at.clone(), // unchanged — keep watermark
            Some(_) => now.clone(),                               // content changed — bump
            None => mtime_iso(&config_dir.join(name)),            // first sight — seed from mtime
        };
        state
            .configs
            .insert(name.clone(), FileRev { hash: h, updated_at: updated_at.clone() });
        configs.insert(name.clone(), ConfigEntry { content: content.clone(), updated_at });
    }
    // Forget ledger entries for configs that no longer exist locally.
    state.configs.retain(|k, _| raw_configs.contains_key(k));

    // --- Trainer state: same treatment, single entry ---
    let trainer_state = match read_trainer_content(bepinex_path) {
        Some(content) => {
            let h = content_hash(&content);
            let updated_at = match &state.trainer_state {
                Some(rev) if rev.hash == h => rev.updated_at.clone(),
                Some(_) => now.clone(),
                None => {
                    let p = bep
                        .parent()
                        .unwrap_or_else(|| Path::new("."))
                        .join("trainer_state.json");
                    mtime_iso(&p)
                }
            };
            state.trainer_state = Some(FileRev { hash: h, updated_at: updated_at.clone() });
            Some(ConfigEntry { content, updated_at })
        }
        None => {
            state.trainer_state = None;
            None
        }
    };

    // --- Mods: per-mod honest watermark ledger (present entries + tombstones) ---
    // `mods` (from scan_profile_mods) is the current on-disk set. Reconcile it
    // against the ledger: a mod's watermark bumps only when it first appears,
    // is re-installed (was tombstoned), or its enabled state flips. A mod that
    // vanished from disk is tombstoned. Both propagate per-mod (mirror sync).
    let mut present_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut mods_out: Vec<SyncModEntry> = Vec::with_capacity(mods.len());
    for m in &mods {
        present_names.insert(m.name.clone());
        let updated_at = match state.mods.get(&m.name) {
            Some(rev) if !rev.removed && rev.enabled == m.enabled => rev.updated_at.clone(),
            _ => now.clone(), // new, re-installed (was tombstoned), or enabled flipped
        };
        state.mods.insert(
            m.name.clone(),
            ModRev {
                file_name: m.file_name.clone(),
                source: m.source.clone(),
                enabled: m.enabled,
                removed: false,
                updated_at: updated_at.clone(),
            },
        );
        let mut e = m.clone();
        e.updated_at = updated_at;
        mods_out.push(e);
    }
    // Tombstone mods the ledger knew as present but that are now gone from disk.
    for (name, rev) in state.mods.iter_mut() {
        if !present_names.contains(name) && !rev.removed {
            rev.removed = true;
            rev.updated_at = now.clone();
        }
    }
    // GC tombstones past the retention window so the ledger + bundle can't grow
    // without bound as mods come and go.
    let gc_cutoff = iso_days_ago(TOMBSTONE_TTL_DAYS);
    state.mods.retain(|_, rev| !(rev.removed && rev.updated_at < gc_cutoff));
    // Emit tombstones on the wire so peers can mirror the uninstall.
    let removed_mods: Vec<RemovedMod> = state
        .mods
        .iter()
        .filter(|(_, rev)| rev.removed)
        .map(|(name, rev)| RemovedMod {
            name: name.clone(),
            file_name: rev.file_name.clone(),
            enabled: rev.enabled,
            source: rev.source.clone(),
            updated_at: rev.updated_at.clone(),
        })
        .collect();
    // Bundle-level watermark kept for legacy readers = max across per-mod entries.
    let mods_updated_at = state
        .mods
        .values()
        .map(|r| r.updated_at.clone())
        .max()
        .unwrap_or_else(|| now.clone());

    save_profile_state(profile_id, &state);

    Ok(SyncProfileBundle {
        profile_id: profile_id.to_string(),
        profile_name: profile_name.to_string(),
        last_updated: now,
        mods: mods_out,
        removed_mods,
        thunderstore_mods: ts_mods,
        configs,
        trainer_state,
        mods_updated_at,
    })
}

/// Scan a profile's plugins/ + disabled_plugins/ into a mod list (enabled flag
/// set per directory). Shared by `snapshot_bundle` and the pull's post-toggle
/// fingerprint recompute.
fn scan_profile_mods(bepinex_path: &str) -> Result<Vec<SyncModEntry>, String> {
    let bep = Path::new(bepinex_path);
    let mut mods = Vec::new();
    let plugins_dir = bep.join("plugins");
    if plugins_dir.exists() {
        scan_mods_for_sync(&plugins_dir, true, &mut mods)?;
    }
    let disabled_dir = bep.join("disabled_plugins");
    if disabled_dir.exists() {
        scan_mods_for_sync(&disabled_dir, false, &mut mods)?;
    }
    Ok(mods)
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
                updated_at: String::new(), // assigned from the ledger in snapshot_bundle
            });
        } else if path.is_dir() {
            if let Some(dll) = find_dll_in_folder(&path) {
                let name = path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                mods.push(SyncModEntry {
                    name, file_name: dll, version: None, enabled, source: "thunderstore".to_string(),
                    updated_at: String::new(), // assigned from the ledger in snapshot_bundle
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

/// Read ALL .cfg files from config/ into a HashMap<filename, content>. The
/// per-file `updated_at` watermark is assigned by the ledger in
/// `snapshot_bundle`, not derived here — this just returns raw content keyed
/// by filename.
fn read_all_config_contents(bepinex_path: &str) -> HashMap<String, String> {
    let config_dir = Path::new(bepinex_path).join("config");
    let mut out = HashMap::new();
    if let Ok(entries) = fs::read_dir(&config_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.to_lowercase().ends_with(".cfg") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        out.insert(file_name, content);
                    }
                }
            }
        }
    }
    out
}

/// Read trainer_state.json content from the profile directory (parent of the
/// BepInEx path). Watermarking is handled by the ledger in `snapshot_bundle`.
fn read_trainer_content(bepinex_path: &str) -> Option<String> {
    let path = Path::new(bepinex_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("trainer_state.json");
    fs::read_to_string(&path).ok()
}

/// Write trainer_state.json to the profile directory (parent of BepInEx path).
fn write_trainer_state(bepinex_path: &str, content: &str) {
    let path = Path::new(bepinex_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("trainer_state.json");
    let _ = fs::write(&path, content);
}

/// Content-only signature of a bundle: hashes the CONFIG CONTENT + mod set and
/// excludes every watermark (`last_updated`, `mods_updated_at`, and the per-file
/// `updated_at`). Two snapshots with identical content but different edit-time
/// watermarks therefore hash the same, so:
///   * the push dirty-cache treats a BepInEx relaunch (which can reshuffle
///     watermarks but not content) as a no-op, and
///   * the "merged matches remote" short-circuit skips the PUT whenever the
///     content already agrees, regardless of whose watermark is newer.
/// Order-independent — configs and mods are sorted before hashing.
fn bundle_content_signature(bundle: &SyncProfileBundle) -> String {
    let mut parts: Vec<String> = Vec::new();

    let mut cfg: Vec<(&String, &ConfigEntry)> = bundle.configs.iter().collect();
    cfg.sort_by(|a, b| a.0.cmp(b.0));
    for (name, entry) in cfg {
        parts.push(format!("cfg:{}={}", name, content_hash(&entry.content)));
    }
    if let Some(t) = &bundle.trainer_state {
        parts.push(format!("trainer={}", content_hash(&t.content)));
    }

    let mut mods: Vec<String> = bundle
        .mods
        .iter()
        .map(|m| format!("mod:{}:{}:{}", m.name, m.file_name, m.enabled))
        .collect();
    mods.sort();
    parts.extend(mods);

    // Tombstones are content too — a new removal must trigger a push so the
    // uninstall mirrors to peers.
    let mut rm: Vec<String> = bundle
        .removed_mods
        .iter()
        .map(|r| format!("rm:{}", r.name))
        .collect();
    rm.sort();
    parts.extend(rm);

    let mut ts: Vec<String> = bundle
        .thunderstore_mods
        .iter()
        .map(|t| format!("ts:{}:{}", t.full_name, t.version))
        .collect();
    ts.sort();
    parts.extend(ts);

    format!("{:016x}", fnv1a_hash(parts.join("|").as_bytes()))
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
fn manifest_profiles_signature(present: &[SyncProfileEntry], removed: &[RemovedProfile]) -> String {
    // Content-only: id + name for present, id for tombstones. Excludes
    // `is_active` (per-device, would churn the manifest on every active-switch)
    // and `updated_at` (a watermark, not content).
    let mut parts: Vec<String> = present
        .iter()
        .map(|p| format!("p:{}:{}", p.id, p.name))
        .collect();
    for r in removed {
        parts.push(format!("rm:{}", r.id));
    }
    parts.sort();
    format!("{:016x}", fnv1a_hash(parts.join("|").as_bytes()))
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
    let desired: Vec<SyncProfileEntry> = profiles.iter().map(|p| SyncProfileEntry {
        id: p.id.clone(),
        name: p.name.clone(),
        is_active: p.is_active,
        is_linked: false,
        updated_at: String::new(),
    }).collect();
    // Reconcile the manifest ledger — bumps new profiles, tombstones any that
    // vanished from the local list. This is what turns a local delete into a
    // real, propagating event instead of a silent gap the peer re-fills.
    let (local_present, local_removed) = reconcile_manifest_ledger(&desired);
    let manifest_path = sync_manifest_path(user_id);
    let desired_sig = manifest_profiles_signature(&local_present, &local_removed);

    // Dirty-tracking: if no bundle changed and our cached manifest signature
    // still matches our local profile view, the cloud manifest is provably
    // current for our side — skip the GET+merge entirely. A peer's change is
    // still caught by `sync_check_remote_changed` → pull → invalidate.
    let cached_matches = bundles_changed == 0
        && push_cache()
            .lock()
            .ok()
            .and_then(|c| c.manifest_sig.clone())
            .as_deref()
            == Some(desired_sig.as_str());

    let mut manifest_pushed = false;
    if !cached_matches {
        // Fetch remote and MERGE per-profile (present + tombstones, LWW) so a
        // deletion here isn't clobbered by the peer's stale list, and the peer's
        // profiles we don't have locally aren't dropped.
        let remote_manifest = github_get_file(&manifest_path)
            .ok()
            .and_then(|(c, _)| serde_json::from_str::<SyncManifest>(c.trim_start_matches('\u{feff}')).ok());
        let (remote_present, remote_removed) = match &remote_manifest {
            Some(m) => seed_manifest_watermarks(m),
            None => (Vec::new(), Vec::new()),
        };
        let (merged_present, merged_removed) =
            merge_manifest_profiles(&local_present, &local_removed, &remote_present, &remote_removed);
        let merged_sig = manifest_profiles_signature(&merged_present, &merged_removed);
        let remote_sig = remote_manifest
            .as_ref()
            .map(|_| manifest_profiles_signature(&remote_present, &remote_removed));

        let manifest_needs_push = bundles_changed > 0 || remote_sig.as_deref() != Some(merged_sig.as_str());
        if manifest_needs_push {
            manifest_pushed = true;
            // Newly-created tombstones (removed here, not already removed remotely)
            // → also delete the orphaned cloud bundle so it can't be re-pulled.
            let remote_removed_ids: std::collections::HashSet<&str> =
                remote_removed.iter().map(|r| r.id.as_str()).collect();
            let newly_removed: Vec<String> = merged_removed
                .iter()
                .filter(|r| !remote_removed_ids.contains(r.id.as_str()))
                .map(|r| r.id.clone())
                .collect();

            let manifest = SyncManifest {
                user_id: user_id.clone(),
                last_sync: iso_now(),
                machine_id: settings.machine_id.clone(),
                profiles: merged_present.clone(),
                removed_profiles: merged_removed.clone(),
            };
            let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
            // 409-retry with re-merge: refetch remote, re-merge our local view,
            // rebuild bytes — so a concurrent peer change survives the retry.
            let path_for_retry = manifest_path.clone();
            let lp = local_present.clone();
            let lr = local_removed.clone();
            let mid = settings.machine_id.clone();
            let uid = user_id.clone();
            github_put_file_with_retry(
                &manifest_path,
                &format!("Sync — {}", identity.display_name),
                3,
                |attempt| {
                    if attempt == 1 {
                        let sha = github_get_file(&path_for_retry).ok().map(|(_, s)| s);
                        Ok((manifest_json.as_bytes().to_vec(), sha))
                    } else {
                        let (rp, rr, sha) = match github_get_file(&path_for_retry) {
                            Ok((c, s)) => {
                                let rm = serde_json::from_str::<SyncManifest>(c.trim_start_matches('\u{feff}')).ok();
                                let (rp, rr) = rm.as_ref().map(seed_manifest_watermarks).unwrap_or_default();
                                (rp, rr, Some(s))
                            }
                            Err(_) => (Vec::new(), Vec::new(), None),
                        };
                        let (mp, mrm) = merge_manifest_profiles(&lp, &lr, &rp, &rr);
                        let m = SyncManifest {
                            user_id: uid.clone(),
                            last_sync: iso_now(),
                            machine_id: mid.clone(),
                            profiles: mp,
                            removed_profiles: mrm,
                        };
                        let bytes = serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?.into_bytes();
                        Ok((bytes, sha))
                    }
                },
            )?;

            // Best-effort cleanup of orphaned bundles for freshly-removed profiles.
            for id in &newly_removed {
                let bpath = sync_bundle_path(&user_id, id);
                if let Ok((_, sha)) = github_get_file(&bpath) {
                    let _ = github_delete_file(&bpath, &sha, &format!("Sync remove profile bundle {} — {}", id, identity.display_name));
                    app_log(&format!("Sync: deleted orphaned cloud bundle for removed profile {}", id));
                }
            }
        }
    }
    let manifest_needs_push = manifest_pushed;

    // Cache our local profile-view signature so the next idle push can skip the
    // manifest GET+merge entirely.
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

/// Merge two mod sets (present entries + tombstones) per-mod by watermark. For
/// each mod name the newest `updated_at` wins across BOTH the present list and
/// the tombstone list — so an uninstall on one device beats a stale "present"
/// on the other (and vice-versa), and neither side's whole list can clobber the
/// other. On an exact-timestamp tie, present wins (keep the mod installed rather
/// than let an equal-instant tombstone delete it). Returns (present, removed).
fn merge_mod_sets(
    local_present: &[SyncModEntry],
    local_removed: &[RemovedMod],
    remote_present: &[SyncModEntry],
    remote_removed: &[RemovedMod],
) -> (Vec<SyncModEntry>, Vec<RemovedMod>) {
    // Best present entry per name (newer wins; remote processed first so an
    // exact tie keeps remote — cosmetic, content is equal on a tie anyway).
    let mut present_map: HashMap<String, SyncModEntry> = HashMap::new();
    for m in remote_present.iter().chain(local_present.iter()) {
        match present_map.get(&m.name) {
            Some(cur) if cur.updated_at >= m.updated_at => {}
            _ => {
                present_map.insert(m.name.clone(), m.clone());
            }
        }
    }
    let mut removed_map: HashMap<String, RemovedMod> = HashMap::new();
    for r in remote_removed.iter().chain(local_removed.iter()) {
        match removed_map.get(&r.name) {
            Some(cur) if cur.updated_at >= r.updated_at => {}
            _ => {
                removed_map.insert(r.name.clone(), r.clone());
            }
        }
    }

    let mut names: std::collections::HashSet<String> = std::collections::HashSet::new();
    names.extend(present_map.keys().cloned());
    names.extend(removed_map.keys().cloned());

    let mut out_present: Vec<SyncModEntry> = Vec::new();
    let mut out_removed: Vec<RemovedMod> = Vec::new();
    for name in names {
        match (present_map.get(&name), removed_map.get(&name)) {
            (Some(p), Some(r)) => {
                if r.updated_at > p.updated_at {
                    out_removed.push(r.clone());
                } else {
                    out_present.push(p.clone());
                }
            }
            (Some(p), None) => out_present.push(p.clone()),
            (None, Some(r)) => out_removed.push(r.clone()),
            (None, None) => {}
        }
    }
    out_present.sort_by(|a, b| a.name.cmp(&b.name));
    out_removed.sort_by(|a, b| a.name.cmp(&b.name));
    (out_present, out_removed)
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

    // Mods — per-mod union with tombstone LWW so install/uninstall/enable each
    // mirror independently. One side's stale whole list can no longer clobber
    // the other's real change (the bug that reinstalled + re-enabled a mod the
    // user had removed/disabled on the other device).
    let (mods, removed_mods) = merge_mod_sets(
        &local.mods,
        &local.removed_mods,
        &remote.mods,
        &remote.removed_mods,
    );

    // Thunderstore set + profile name still follow the bundle-level watermark
    // (ts mirror is a separate path; the name is cosmetic). Ties keep local.
    let local_meta_wins = local.mods_updated_at >= remote.mods_updated_at;
    let (ts_mods, profile_name) = if local_meta_wins {
        (local.thunderstore_mods, local.profile_name)
    } else {
        (remote.thunderstore_mods, remote.profile_name)
    };

    // Bundle-level watermark = max across the merged per-mod entries (legacy).
    let mods_updated_at = mods
        .iter()
        .map(|m| m.updated_at.clone())
        .chain(removed_mods.iter().map(|r| r.updated_at.clone()))
        .max()
        .unwrap_or_else(iso_now);

    SyncProfileBundle {
        profile_id: local.profile_id,
        profile_name,
        last_updated: iso_now(),
        mods,
        removed_mods,
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
            // Strip a leading UTF-8 BOM (U+FEFF) — serde_json otherwise rejects
            // it with "expected value at line 1 column 1". No-op when absent.
            serde_json::from_str(content.trim_start_matches('\u{feff}'))
                .map_err(|e| format!("Manifest parse error: {}", e))
        }
        Err(_) => Ok(SyncManifest {
            user_id: identity.user_id,
            last_sync: String::new(),
            machine_id: String::new(),
            profiles: Vec::new(),
            removed_profiles: Vec::new(),
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

    // Reconcile the ledger with disk FIRST. This assigns every local file an
    // honest watermark and, crucially, bumps any un-pushed local edit to `now`
    // — so a stale remote value cannot clobber a fresh local edit below. It
    // also gives us the current local mod set for the toggle pass.
    let local_bundle = snapshot_bundle(&profile_id, &remote.profile_name, &bepinex_path)?;
    let mut state = load_profile_state(&profile_id);

    // 2. Apply configs — remote wins a file only when its watermark is strictly
    //    newer than the honest local watermark recorded in the ledger. No
    //    filesystem mtime is consulted, so a BepInEx relaunch that merely
    //    re-touched the local .cfg can no longer reject an inbound edit (the
    //    root-cause bug), and a stale device can no longer push its old config
    //    back over a real edit.
    let config_dir = Path::new(&bepinex_path).join("config");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    let mut configs_updated: u32 = 0;
    for (file_name, remote_entry) in &remote.configs {
        let local_path = config_dir.join(file_name);
        let local_content = fs::read_to_string(&local_path).unwrap_or_default();
        let remote_hash = content_hash(&remote_entry.content);

        if local_content == remote_entry.content {
            // Already in agreement — record it in the ledger (adopt the higher
            // watermark) so we don't try to push the same content back.
            let entry = state.configs.entry(file_name.clone()).or_default();
            entry.hash = remote_hash;
            if remote_entry.updated_at > entry.updated_at {
                entry.updated_at = remote_entry.updated_at.clone();
            }
            continue;
        }

        let local_wm = state
            .configs
            .get(file_name)
            .map(|r| r.updated_at.clone())
            .unwrap_or_default();
        // Keep local when its watermark is newer or equal (equal ⇒ same instant,
        // prefer the copy already on disk). An empty local_wm means we have
        // never tracked this file, so let the genuine inbound copy land.
        if !local_wm.is_empty() && remote_entry.updated_at <= local_wm {
            app_log(&format!(
                "Sync pull: keep local {} (local wm {} >= remote {})",
                file_name, local_wm, remote_entry.updated_at
            ));
            continue;
        }

        fs::write(&local_path, &remote_entry.content).map_err(|e| e.to_string())?;
        state.configs.insert(
            file_name.clone(),
            FileRev { hash: remote_hash, updated_at: remote_entry.updated_at.clone() },
        );
        configs_updated += 1;
        app_log(&format!(
            "Sync pull config: {} (remote wm {})",
            file_name, remote_entry.updated_at
        ));
    }

    // 2b. Apply trainer state with the same ledger-watermark guard.
    if let Some(ref remote_trainer) = remote.trainer_state {
        let local_content = read_trainer_content(&bepinex_path).unwrap_or_default();
        let remote_hash = content_hash(&remote_trainer.content);
        if local_content == remote_trainer.content {
            let entry = state.trainer_state.get_or_insert_with(FileRev::default);
            entry.hash = remote_hash;
            if remote_trainer.updated_at > entry.updated_at {
                entry.updated_at = remote_trainer.updated_at.clone();
            }
        } else {
            let local_wm = state
                .trainer_state
                .as_ref()
                .map(|r| r.updated_at.clone())
                .unwrap_or_default();
            if local_wm.is_empty() || remote_trainer.updated_at > local_wm {
                write_trainer_state(&bepinex_path, &remote_trainer.content);
                state.trainer_state = Some(FileRev {
                    hash: remote_hash,
                    updated_at: remote_trainer.updated_at.clone(),
                });
                configs_updated += 1;
                app_log("Sync pull: trainer_state.json");
            }
        }
    }

    // 3. Mods — mirror install/uninstall/enable per-mod. For each remote entry
    //    (present or tombstone) apply it locally only when the remote's per-mod
    //    watermark is newer than what our ledger last recorded. The snapshot
    //    above already refreshed the ledger from disk, so a mod the user just
    //    installed/removed/toggled locally owns a fresh watermark and can't be
    //    reverted here.
    let mut toggled_mods: Vec<String> = Vec::new();
    let mut uninstalled_mods: Vec<String> = Vec::new();
    let mut to_install: Vec<(String, bool)> = Vec::new(); // (name, desired enabled)

    // Present mods from remote → install if missing, toggle if enabled differs.
    for rm in &remote.mods {
        let local_wm = state.mods.get(&rm.name).map(|r| r.updated_at.clone()).unwrap_or_default();
        if !local_wm.is_empty() && rm.updated_at <= local_wm {
            continue; // local is newer or equal — keep local, push will propagate
        }
        match local_bundle.mods.iter().find(|m| m.name == rm.name) {
            Some(local_mod) => {
                if local_mod.enabled != rm.enabled {
                    toggle_mod_sync(&bepinex_path, &rm.file_name, rm.enabled)?;
                    toggled_mods.push(rm.name.clone());
                }
                state.mods.insert(rm.name.clone(), ModRev {
                    file_name: rm.file_name.clone(),
                    source: rm.source.clone(),
                    enabled: rm.enabled,
                    removed: false,
                    updated_at: rm.updated_at.clone(),
                });
            }
            None => to_install.push((rm.name.clone(), rm.enabled)),
        }
    }

    // Tombstones from remote → uninstall locally if present and remote is newer
    // (mirror-uninstall). Reversible — the DLL re-downloads from the Worker.
    for rr in &remote.removed_mods {
        let local_wm = state.mods.get(&rr.name).map(|r| r.updated_at.clone()).unwrap_or_default();
        if !local_wm.is_empty() && rr.updated_at <= local_wm {
            continue; // local newer/equal — keep whatever we have
        }
        if let Some(local_mod) = local_bundle.mods.iter().find(|m| m.name == rr.name) {
            let folder = if local_mod.source == "thunderstore" {
                local_mod.name.clone()
            } else {
                String::new()
            };
            match crate::commands::mods::delete_mod(
                bepinex_path.clone(),
                folder,
                local_mod.file_name.clone(),
                local_mod.enabled,
            ) {
                Ok(_) => {
                    uninstalled_mods.push(rr.name.clone());
                    app_log(&format!("Sync pull: uninstalled {} (mirror)", rr.name));
                }
                Err(e) => app_log(&format!("Sync pull: failed to uninstall {}: {}", rr.name, e)),
            }
        }
        state.mods.insert(rr.name.clone(), ModRev {
            file_name: rr.file_name.clone(),
            source: rr.source.clone(),
            enabled: rr.enabled,
            removed: true,
            updated_at: rr.updated_at.clone(),
        });
    }

    // 4. Scoped installs — only the profile's missing mods, never the whole
    //    catalogue (the old sync_install_all_mods behaviour, which reinstalled
    //    every published mod and was what silently resurrected a deleted mod).
    let mut installed_mods: Vec<String> = Vec::new();
    let mut missing_mods: Vec<String> = Vec::new();
    if !to_install.is_empty() {
        let names: Vec<String> = to_install.iter().map(|(n, _)| n.clone()).collect();
        let installed = match crate::commands::updater::install_named_mods(&bepinex_path, &names) {
            Ok(v) => v,
            Err(e) => {
                app_log(&format!("Sync pull: install batch failed: {}", e));
                Vec::new()
            }
        };
        for (name, want_enabled) in &to_install {
            if installed.iter().any(|n| n == name) {
                // install_mod_update lands mods in plugins/ (enabled) — honour a
                // remote "disabled" by moving it to disabled_plugins/.
                if !want_enabled {
                    if let Some(fresh) =
                        scan_profile_mods(&bepinex_path)?.into_iter().find(|m| &m.name == name)
                    {
                        let _ = toggle_mod_sync(&bepinex_path, &fresh.file_name, false);
                    }
                }
                let rm = remote.mods.iter().find(|m| &m.name == name);
                state.mods.insert(name.clone(), ModRev {
                    file_name: rm.map(|m| m.file_name.clone()).unwrap_or_default(),
                    source: rm.map(|m| m.source.clone()).unwrap_or_default(),
                    enabled: *want_enabled,
                    removed: false,
                    updated_at: rm.map(|m| m.updated_at.clone()).unwrap_or_else(iso_now),
                });
                installed_mods.push(name.clone());
            } else {
                // Couldn't install (not in the manifest — e.g. a manual/local-only
                // mod). Surface it; leave the ledger untouched so a later pull
                // retries once it becomes installable.
                missing_mods.push(name.clone());
            }
        }
    }

    // Persist the reconciled ledger before returning.
    save_profile_state(&profile_id, &state);

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
        installed_mods,
        uninstalled_mods,
        configs_updated,
        missing_mods,
        thunderstore_mods: remote.thunderstore_mods,
        last_updated: remote.last_updated,
    };

    app_log(&format!(
        "Sync pull complete: {} configs, {} installed, {} uninstalled, {} toggled, {} missing",
        result.configs_updated,
        result.installed_mods.len(),
        result.uninstalled_mods.len(),
        result.toggled_mods.len(),
        result.missing_mods.len()
    ));

    let nothing_changed = result.configs_updated == 0
        && result.toggled_mods.is_empty()
        && result.installed_mods.is_empty()
        && result.uninstalled_mods.is_empty()
        && result.missing_mods.is_empty();
    if !nothing_changed {
        sync_log::emit(
            "PullBundle",
            "success",
            format!(
                "{}: {} configs, {} installed, {} uninstalled, {} toggled, {} missing",
                result.profile_name,
                result.configs_updated,
                result.installed_mods.len(),
                result.uninstalled_mods.len(),
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
    pub installed_mods: Vec<String>,
    pub uninstalled_mods: Vec<String>,
    pub configs_updated: u32,
    pub missing_mods: Vec<String>,
    pub thunderstore_mods: Vec<SyncThunderstoreMod>,
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
            // De-BOM defensively (a BOM'd manifest otherwise fails to parse and
            // we'd silently never pull).
            if let Ok(manifest) =
                serde_json::from_str::<SyncManifest>(content.trim_start_matches('\u{feff}'))
            {
                // Our own last write — nothing to pull.
                if manifest.machine_id == settings.machine_id {
                    return Ok(false);
                }
                // Clock-skew-proof: a *different* last_sync string than the one
                // we last reconciled means a peer changed something. Equality,
                // not `>`, so a device whose clock runs ahead can't mask a real
                // change (the old `manifest.last_sync > last_pull` compared the
                // pusher's clock against the puller's — a genuine bug).
                Ok(Some(manifest.last_sync.as_str()) != settings.last_seen_remote_sync.as_deref())
            } else {
                Ok(false)
            }
        }
        Err(_) => Ok(false),
    }
}

/// Record the remote manifest's `last_sync` value we just reconciled against.
/// Called by the frontend at the end of a successful pull pass so the next
/// `sync_check_remote_changed` compares by equality and stops re-pulling until
/// a peer bumps it again.
#[command]
pub fn sync_mark_remote_seen(last_sync: String) -> Result<(), String> {
    let mut settings = load_sync_settings();
    settings.last_seen_remote_sync = Some(last_sync);
    save_sync_settings(&settings)?;
    Ok(())
}

/// One-time "make this device canonical" for a profile: reconcile the ledger
/// with disk, then stamp EVERY tracked watermark (each config, trainer_state,
/// the mod set) to a single `now`. Every file on this device then wins its
/// per-file merge, so a subsequent push publishes this device's whole config
/// set as the truth and peers pull it — resolving the first-run divergence with
/// no per-file poking. It does NOT delete cloud configs this device lacks (a
/// mod installed only on the other device keeps its config); it only makes the
/// configs this device *has* authoritative. The caller should push afterwards.
#[command]
pub async fn sync_mark_profile_canonical(profile_id: String, bepinex_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync_mark_profile_canonical_impl(profile_id, bepinex_path))
        .await
        .map_err(|e| format!("sync_mark_profile_canonical task panicked: {}", e))?
}

fn sync_mark_profile_canonical_impl(profile_id: String, bepinex_path: String) -> Result<(), String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }
    // Reconcile the ledger with disk first (this also seeds any first-sight
    // files/mods), then stamp every watermark to a single `now` so nothing on
    // this device can lose a merge on content it currently holds.
    let _ = snapshot_bundle(&profile_id, "", &bepinex_path)?;
    let mut state = load_profile_state(&profile_id);
    let now = iso_now();

    // Tombstone any mod the CLOUD has but this device does not — that's what
    // makes "canonical" a true mirror: the peer uninstalls it. Without this, a
    // mod removed before this device started tracking (so it has no local
    // tombstone) would just get reinstalled from the peer's still-present copy.
    let identity = get_megaload_identity()?;
    if let Ok((content, _)) = github_get_file(&sync_bundle_path(&identity.user_id, &profile_id)) {
        if let Ok(remote) = parse_bundle(&content) {
            for rm in &remote.mods {
                let present_locally = state
                    .mods
                    .get(&rm.name)
                    .map(|r| !r.removed)
                    .unwrap_or(false);
                if !present_locally {
                    state.mods.insert(rm.name.clone(), ModRev {
                        file_name: rm.file_name.clone(),
                        source: rm.source.clone(),
                        enabled: rm.enabled,
                        removed: true,
                        updated_at: now.clone(),
                    });
                }
            }
        }
    }

    for rev in state.configs.values_mut() {
        rev.updated_at = now.clone();
    }
    if let Some(t) = state.trainer_state.as_mut() {
        t.updated_at = now.clone();
    }
    for rev in state.mods.values_mut() {
        rev.updated_at = now.clone();
    }
    let cfg_count = state.configs.len();
    let mod_count = state.mods.values().filter(|r| !r.removed).count();
    let tomb_count = state.mods.values().filter(|r| r.removed).count();
    save_profile_state(&profile_id, &state);
    // The next push must reconcile from scratch, not trust a cached signature.
    invalidate_push_cache(&profile_id);
    app_log(&format!(
        "Sync: marked profile {} canonical — {} configs, {} mods, {} tombstones stamped {}",
        profile_id, cfg_count, mod_count, tomb_count, now
    ));
    Ok(())
}

/// Apply profile tombstones from a pulled manifest — mirror-delete profiles the
/// peer removed. Called by the frontend during a pull (before the present-
/// profile loop). Guards: reconciles the local manifest ledger first so a
/// profile freshly (re)created here owns a newer watermark and can't be nuked
/// by a stale tombstone; only deletes when the tombstone is strictly newer than
/// our local copy; never deletes the last remaining profile. Returns the names
/// of profiles actually deleted (for the UI).
#[command]
pub async fn sync_apply_profile_tombstones(removed_json: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || sync_apply_profile_tombstones_impl(removed_json))
        .await
        .map_err(|e| format!("sync_apply_profile_tombstones task panicked: {}", e))?
}

fn sync_apply_profile_tombstones_impl(removed_json: String) -> Result<Vec<String>, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Ok(Vec::new());
    }
    let removed: Vec<RemovedProfile> = serde_json::from_str(&removed_json)
        .map_err(|e| format!("Invalid removed_profiles JSON: {}", e))?;
    if removed.is_empty() {
        return Ok(Vec::new());
    }

    // Reconcile the ledger with the CURRENT local profiles first, so anything
    // created/kept locally carries a fresh watermark before we compare.
    let store = crate::commands::profiles::get_profiles()?;
    let desired: Vec<SyncProfileEntry> = store
        .profiles
        .iter()
        .map(|p| SyncProfileEntry {
            id: p.id.clone(),
            name: p.name.clone(),
            is_active: store.active_profile.as_deref() == Some(p.id.as_str()),
            is_linked: false,
            updated_at: String::new(),
        })
        .collect();
    let _ = reconcile_manifest_ledger(&desired);
    let mut led = load_manifest_ledger();

    let mut deleted: Vec<String> = Vec::new();
    let mut remaining = store.profiles.len();
    for r in &removed {
        let exists = store.profiles.iter().any(|p| p.id == r.id);
        if !exists {
            // Already gone — just record the tombstone so our next push agrees.
            led.profiles.insert(
                r.id.clone(),
                ProfileLedgerEntry { name: r.name.clone(), removed: true, updated_at: r.updated_at.clone() },
            );
            continue;
        }
        // Safety: never let sync leave the app with zero profiles.
        if remaining <= 1 {
            app_log(&format!("Sync: skip mirror-delete of last profile {} ({})", r.name, r.id));
            continue;
        }
        // Only delete when the tombstone is strictly newer than our local copy.
        let local_wm = led
            .profiles
            .get(&r.id)
            .filter(|e| !e.removed)
            .map(|e| e.updated_at.clone())
            .unwrap_or_default();
        if !local_wm.is_empty() && r.updated_at <= local_wm {
            continue;
        }
        match crate::commands::profiles::delete_profile(r.id.clone()) {
            Ok(_) => {
                app_log(&format!("Sync: mirror-deleted profile {} ({})", r.name, r.id));
                deleted.push(if r.name.is_empty() { r.id.clone() } else { r.name.clone() });
                remaining -= 1;
                led.profiles.insert(
                    r.id.clone(),
                    ProfileLedgerEntry { name: r.name.clone(), removed: true, updated_at: r.updated_at.clone() },
                );
            }
            Err(e) => app_log(&format!("Sync: failed to mirror-delete profile {}: {}", r.id, e)),
        }
    }
    save_manifest_ledger(&led);
    if !deleted.is_empty() {
        // Local profile set changed — force the next push to re-merge cleanly.
        if let Ok(mut c) = push_cache().lock() {
            c.manifest_sig = None;
        }
        sync_log::emit(
            "MirrorDeleteProfiles",
            "success",
            format!("Removed {}: {}", deleted.len(), deleted.join(", ")),
        );
    }
    Ok(deleted)
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

// ---------------------------------------------------------------------------
// Theme sync — opt-in, blob-level last-writer-wins. The theme prefs are a tiny
// JSON object; the device that most recently changed the theme wins. Stored at
// sync/{user_id}/theme.json. Requires cloud sync to be enabled.
// ---------------------------------------------------------------------------

fn sync_theme_path(user_id: &str) -> String {
    format!("sync/{}/theme.json", user_id)
}

/// Pull the remote theme blob. Returns the raw JSON string, or the literal
/// "null" when no remote theme exists yet.
#[command]
pub async fn sync_pull_theme() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        let settings = load_sync_settings();
        if !settings.enabled {
            return Err("Cloud sync is not enabled".to_string());
        }
        let identity = get_megaload_identity()?;
        let remote_path = sync_theme_path(&identity.user_id);
        match github_get_file(&remote_path) {
            Ok((content, _)) => Ok(content),
            Err(e) if e.contains("404") => Ok("null".to_string()),
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| format!("Theme pull task panicked: {}", e))?
}

/// Push the local theme blob (overwrite remote, 409-retry). Last writer wins,
/// which matches "the device you just changed the theme on".
#[command]
pub async fn sync_push_theme(blob_json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let settings = load_sync_settings();
        if !settings.enabled {
            return Err("Cloud sync is not enabled".to_string());
        }
        // Validate it's well-formed JSON before writing.
        let _: serde_json::Value = serde_json::from_str(&blob_json)
            .map_err(|e| format!("Invalid theme blob JSON: {}", e))?;
        let identity = get_megaload_identity()?;
        let remote_path = sync_theme_path(&identity.user_id);

        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let remote_sha = match github_get_file(&remote_path) {
                Ok((_, sha)) => Some(sha),
                Err(e) if e.contains("404") => None,
                Err(e) => return Err(e),
            };
            match github_put_file(
                &remote_path,
                blob_json.as_bytes(),
                &format!("Theme sync — {}", identity.display_name),
                remote_sha.as_deref(),
            ) {
                Ok(_) => {
                    app_log("Theme sync: pushed theme blob");
                    return Ok(());
                }
                Err(e) if e.contains("409") && attempt < MAX_PUSH_RETRIES => continue,
                Err(e) => return Err(e),
            }
        }
    })
    .await
    .map_err(|e| format!("Theme push task panicked: {}", e))?
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
        // Anchor timestamps to "now" so the tombstone stays inside the 30-day
        // GC window whenever the suite runs. The old hardcoded April-2026 dates
        // aged past the TTL and made this a time-bomb (it began failing once the
        // wall clock passed 30 days after those dates).
        let created = iso_days_ago(2);
        let t_old = iso_days_ago(1); // remote last live
        let t_new = iso_now(); // local delete — newer than remote
        let local = json!({
            "version": 1, "device_id": "a", "updated_at": t_new,
            "lists": [
                { "id": "L1", "name": "Foo", "createdAt": created,
                  "updatedAt": t_new, "deletedAt": t_new,
                  "items": [] }
            ]
        });
        let remote = json!({
            "version": 1, "device_id": "b", "updated_at": t_old,
            "lists": [
                { "id": "L1", "name": "Foo", "createdAt": created,
                  "updatedAt": t_old, "items": [] }
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
            removed_mods: vec![],
            thunderstore_mods: vec![],
            configs: map,
            trainer_state: None,
            mods_updated_at: last_updated.to_string(),
        }
    }

    fn mod_entry(name: &str, enabled: bool, updated_at: &str) -> SyncModEntry {
        SyncModEntry {
            name: name.to_string(),
            file_name: format!("{}.dll", name),
            version: None,
            enabled,
            source: "manual".to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    fn tombstone(name: &str, updated_at: &str) -> RemovedMod {
        RemovedMod {
            name: name.to_string(),
            file_name: format!("{}.dll", name),
            enabled: true,
            source: "manual".to_string(),
            updated_at: updated_at.to_string(),
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

    /// Mods union per-mod across devices — one on each side both survive (no
    /// all-or-nothing list clobber, which used to drop the mod only one device
    /// had).
    #[test]
    fn mods_union_per_mod_across_devices() {
        let mut local = make_bundle("default", "2026-04-25T00:00:10Z", &[]);
        local.mods.push(mod_entry("MegaShot", true, "2026-04-25T00:00:10Z"));
        let mut remote = make_bundle("default", "2026-04-25T00:00:05Z", &[]);
        remote.mods.push(mod_entry("MegaHoe", true, "2026-04-25T00:00:05Z"));
        let merged = merge_profile_bundle(local, remote);
        let names: Vec<String> = merged.mods.iter().map(|m| m.name.clone()).collect();
        assert!(names.contains(&"MegaShot".to_string()), "local mod must survive, got {:?}", names);
        assert!(names.contains(&"MegaHoe".to_string()), "remote mod must survive, got {:?}", names);
        assert_eq!(names.len(), 2);
    }

    /// A newer tombstone beats a stale "present" on the peer — the uninstall
    /// wins and the mod does NOT come back (the FarmBuild bug). And the reverse:
    /// a reinstall newer than a tombstone keeps the mod.
    #[test]
    fn mod_tombstone_beats_stale_present_and_vice_versa() {
        // Local removed FarmBuild at t=20; remote still has it present at t=05.
        let mut local = make_bundle("default", "2026-04-25T00:00:20Z", &[]);
        local.removed_mods.push(tombstone("FarmBuild", "2026-04-25T00:00:20Z"));
        let mut remote = make_bundle("default", "2026-04-25T00:00:05Z", &[]);
        remote.mods.push(mod_entry("FarmBuild", true, "2026-04-25T00:00:05Z"));
        let merged = merge_profile_bundle(local, remote);
        assert!(!merged.mods.iter().any(|m| m.name == "FarmBuild"),
            "removed mod must NOT be present after merge");
        assert!(merged.removed_mods.iter().any(|r| r.name == "FarmBuild"),
            "removal must carry as a tombstone");

        // Reverse: remote reinstalled it at t=30, local tombstone at t=20.
        let mut local2 = make_bundle("default", "2026-04-25T00:00:20Z", &[]);
        local2.removed_mods.push(tombstone("FarmBuild", "2026-04-25T00:00:20Z"));
        let mut remote2 = make_bundle("default", "2026-04-25T00:00:30Z", &[]);
        remote2.mods.push(mod_entry("FarmBuild", true, "2026-04-25T00:00:30Z"));
        let merged2 = merge_profile_bundle(local2, remote2);
        assert!(merged2.mods.iter().any(|m| m.name == "FarmBuild"),
            "a reinstall newer than the tombstone must keep the mod");
        assert!(!merged2.removed_mods.iter().any(|r| r.name == "FarmBuild"),
            "the stale tombstone must not linger once out-dated");
    }

    /// Per-mod enabled state is LWW: the newer enabled flip wins independently.
    #[test]
    fn mod_enabled_state_is_per_mod_lww() {
        let mut local = make_bundle("default", "2026-04-25T00:00:00Z", &[]);
        local.mods.push(mod_entry("MegaShot", false, "2026-04-25T00:00:20Z")); // disabled, newer
        let mut remote = make_bundle("default", "2026-04-25T00:00:00Z", &[]);
        remote.mods.push(mod_entry("MegaShot", true, "2026-04-25T00:00:05Z")); // enabled, older
        let merged = merge_profile_bundle(local, remote);
        let m = merged.mods.iter().find(|m| m.name == "MegaShot").unwrap();
        assert!(!m.enabled, "the newer disable must win");
    }

    /// The push short-circuit signature must be watermark-agnostic: two bundles
    /// with identical CONTENT but different edit-time watermarks (the churn a
    /// BepInEx relaunch used to produce) hash the same, so an idle poll-push
    /// doesn't fire a redundant PUT. A genuine content change still moves it.
    #[test]
    fn content_signature_ignores_watermarks() {
        let a = make_bundle(
            "default",
            "2026-04-25T00:00:10Z",
            &[("MegaShot.cfg", "shot=same", "2026-04-25T00:00:10Z")],
        );
        let b = make_bundle(
            "default",
            "2026-05-01T08:00:00Z",
            &[("MegaShot.cfg", "shot=same", "2026-05-01T07:00:00Z")],
        );
        assert_eq!(
            bundle_content_signature(&a),
            bundle_content_signature(&b),
            "identical content with different watermarks must share a signature"
        );

        let c = make_bundle(
            "default",
            "2026-04-25T00:00:10Z",
            &[("MegaShot.cfg", "shot=CHANGED", "2026-04-25T00:00:10Z")],
        );
        assert_ne!(
            bundle_content_signature(&a),
            bundle_content_signature(&c),
            "a real content change must change the signature"
        );
    }

    /// Profile deletion mirrors: a newer tombstone beats the peer's stale
    /// "present" profile (the bug where a deleted profile came back from the
    /// other device), and a newer recreate beats an older tombstone.
    #[test]
    fn profile_tombstone_beats_stale_present() {
        let present = |id: &str, wm: &str| SyncProfileEntry {
            id: id.to_string(),
            name: id.to_string(),
            is_active: false,
            is_linked: false,
            updated_at: wm.to_string(),
        };
        let tomb = |id: &str, wm: &str| RemovedProfile {
            id: id.to_string(),
            name: id.to_string(),
            updated_at: wm.to_string(),
        };
        // Local deleted P at t=20; remote still has it present at t=05.
        let (p_out, r_out) = merge_manifest_profiles(
            &[],
            &[tomb("P", "2026-04-25T00:00:20Z")],
            &[present("P", "2026-04-25T00:00:05Z")],
            &[],
        );
        assert!(!p_out.iter().any(|p| p.id == "P"), "deleted profile must not be present");
        assert!(r_out.iter().any(|r| r.id == "P"), "deletion must carry as a tombstone");

        // Reverse: remote recreated P at t=30, local tombstone t=20 → keep it.
        let (p2, r2) = merge_manifest_profiles(
            &[],
            &[tomb("P", "2026-04-25T00:00:20Z")],
            &[present("P", "2026-04-25T00:00:30Z")],
            &[],
        );
        assert!(p2.iter().any(|p| p.id == "P"), "a newer recreate must keep the profile");
        assert!(!r2.iter().any(|r| r.id == "P"), "the stale tombstone must not linger");
    }
}
