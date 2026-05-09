use crate::commands::app_log::app_log;
use crate::commands::security::{sanitize_path_component, validate_download_url};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;
use tauri::{AppHandle, Manager};

/// URL to the single manifest file — ONE request to check ALL mods.
/// Served by MegaWorker, which proxies the underlying release asset and
/// handles GitHub auth server-side.
const MANIFEST_URL: &str = "https://mega-api.lordrik.workers.dev/manifest";

/// MegaWorker base URL — used to rewrite `download_url` fields in the
/// manifest from `github.com/<owner>/<repo>/releases/download/<ver>/<file>`
/// into `mega-api.lordrik.workers.dev/mod/<repo>/<ver>/<file>` so DLL
/// downloads go through the Worker (which holds the GitHub PAT).
const WORKER_BASE: &str = "https://mega-api.lordrik.workers.dev";

/// Rewrite a manifest `download_url` from a GitHub release-asset URL into the
/// Worker proxy URL. Idempotent — returns input unchanged if already a Worker
/// URL or if it doesn't match the expected GitHub shape.
fn rewrite_to_worker_url(github_url: &str) -> String {
    if github_url.starts_with(WORKER_BASE) {
        return github_url.to_string();
    }
    // Expect: https://github.com/<owner>/<repo>/releases/download/<ver>/<file>
    if let Some(rest) = github_url.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() >= 6 && parts[2] == "releases" && parts[3] == "download" {
            let repo = parts[1];
            let version = parts[4];
            let file = parts[5..].join("/");
            return format!("{}/mod/{}/{}/{}", WORKER_BASE, repo, version, file);
        }
    }
    github_url.to_string()
}

/// Minimum seconds between update checks (5 minutes).
const CHECK_COOLDOWN_SECS: u64 = 300;

/// Manifest schema from the hosted JSON file.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct ModManifest {
    schema_version: u32,
    updated_at: String,
    mods: Vec<ManifestMod>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ManifestMod {
    name: String,
    version: String,
    download_url: String,
    dll_name: String,
    plugin_folder: String,
    description: Option<String>,
    #[serde(default)]
    hidden: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModUpdateInfo {
    pub name: String,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub download_url: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateCheckResult {
    pub mods: Vec<ModUpdateInfo>,
    pub total_updates: usize,
    pub from_cache: bool,
}

/// Cached check result stored on disk.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct CachedUpdateCheck {
    timestamp: u64,
    mods: Vec<ModUpdateInfo>,
}

fn megaload_dir() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|r| PathBuf::from(r).join("MegaLoad"))
}

/// Per-profile versions file: stored alongside BepInEx folder in the profile directory.
fn versions_file_for(bepinex_path: &str) -> PathBuf {
    PathBuf::from(bepinex_path)
        .parent()
        .map(|p| p.join("mod_versions.json"))
        .unwrap_or_else(|| {
            megaload_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("mod_versions.json")
        })
}

/// Per-profile cache file: stored alongside BepInEx folder in the profile directory.
fn cache_file_for(bepinex_path: &str) -> PathBuf {
    PathBuf::from(bepinex_path)
        .parent()
        .map(|p| p.join("update_cache.json"))
        .unwrap_or_else(|| {
            megaload_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("update_cache.json")
        })
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn load_installed_versions(bepinex_path: &str) -> std::collections::HashMap<String, String> {
    let path = versions_file_for(bepinex_path);
    if let Ok(data) = fs::read_to_string(&path) {
        return serde_json::from_str(&data).unwrap_or_default();
    }
    // Migrate from legacy global versions file on first access
    let global = megaload_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mod_versions.json");
    if let Ok(data) = fs::read_to_string(&global) {
        if let Ok(versions) =
            serde_json::from_str::<std::collections::HashMap<String, String>>(&data)
        {
            if let Ok(json) = serde_json::to_string_pretty(&versions) {
                let _ = fs::write(&path, json);
            }
            app_log(&format!(
                "Migrated mod_versions.json to profile: {}",
                path.display()
            ));
            return versions;
        }
    }
    std::collections::HashMap::new()
}

fn save_installed_versions(
    bepinex_path: &str,
    versions: &std::collections::HashMap<String, String>,
) {
    let path = versions_file_for(bepinex_path);
    if let Ok(json) = serde_json::to_string_pretty(versions) {
        let _ = fs::write(&path, json);
    }
}

fn load_cache(bepinex_path: &str) -> Option<CachedUpdateCheck> {
    let path = cache_file_for(bepinex_path);
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_cache(bepinex_path: &str, mods: &[ModUpdateInfo]) {
    let cache = CachedUpdateCheck {
        timestamp: now_secs(),
        mods: mods.to_vec(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&cache) {
        let _ = fs::write(cache_file_for(bepinex_path), json);
    }
}

/// Fetch the mod manifest from MegaWorker — single request for all mod info.
/// `download_url` fields are rewritten to point at the Worker so DLL fetches
/// also go through it.
fn fetch_manifest() -> Result<ModManifest, String> {
    let resp = crate::commands::http::agent()
        .get(MANIFEST_URL)
        .set("User-Agent", concat!("MegaLoad/", env!("CARGO_PKG_VERSION")))
        .call()
        .map_err(|e| {
            let msg = format!("{}", e);
            if msg.contains("403") || msg.contains("429") {
                "Rate limited — try again later".to_string()
            } else {
                format!("Failed to fetch mod manifest: {}", msg)
            }
        })?;

    let body = resp
        .into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let mut manifest: ModManifest =
        serde_json::from_str(&body).map_err(|e| format!("Manifest parse error: {}", e))?;
    for m in manifest.mods.iter_mut() {
        m.download_url = rewrite_to_worker_url(&m.download_url);
    }
    Ok(manifest)
}

/// Build update info for each mod from the manifest.
fn evaluate_updates(
    manifest: &ModManifest,
    plugins_dir: &PathBuf,
    installed_versions: &std::collections::HashMap<String, String>,
) -> Vec<ModUpdateInfo> {
    // Derive disabled_plugins path (sibling of plugins/)
    let disabled_dir = plugins_dir.parent()
        .map(|p| p.join("disabled_plugins"))
        .unwrap_or_else(|| plugins_dir.join("..").join("disabled_plugins"));

    manifest
        .mods
        .iter()
        .map(|m| {
            let dll_path = plugins_dir.join(&m.plugin_folder).join(&m.dll_name);
            let disabled_path = disabled_dir.join(&m.plugin_folder).join(&m.dll_name);
            let is_installed = dll_path.exists();
            let is_disabled = disabled_path.exists();
            let iv = installed_versions.get(&m.name).cloned();
            let latest = m.version.trim_start_matches('v').to_string();

            // Don't flag updates for disabled mods — user deliberately disabled them
            let has_update = if !is_installed || is_disabled {
                false
            } else {
                match &iv {
                    Some(v) => v.trim_start_matches('v') != latest,
                    // Installed but no version recorded — flag for update (don't assume current)
                    None => {
                        app_log(&format!(
                            "{}: DLL exists but no version recorded — flagging for update",
                            m.name
                        ));
                        true
                    }
                }
            };

            ModUpdateInfo {
                name: m.name.clone(),
                installed_version: iv,
                latest_version: Some(latest),
                has_update,
                // Always include download_url so cached entries have it when re-evaluated
                download_url: Some(m.download_url.clone()),
                status: if is_disabled {
                    "disabled".to_string()
                } else if !is_installed {
                    "not-installed".to_string()
                } else if has_update {
                    "update-available".to_string()
                } else {
                    "up-to-date".to_string()
                },
                error: None,
            }
        })
        .collect()
}

fn clear_caches(bepinex_path: &str) {
    // Clear per-profile cache
    let _ = fs::remove_file(cache_file_for(bepinex_path));
    // Also clear legacy global caches
    if let Some(dir) = megaload_dir() {
        let _ = fs::remove_file(dir.join("update_cache.json"));
        let _ = fs::remove_file(dir.join("mod_manifest_cache.json"));
    }
}

/// Check all mods for updates. Uses cache if <15min old, otherwise ONE HTTP request.
/// When `force` is true, caches are cleared first to guarantee a fresh check.
#[command]
pub fn check_mod_updates(bepinex_path: String, force: bool) -> Result<UpdateCheckResult, String> {
    if force {
        app_log("Force-checking for mod updates (caches cleared)...");
        clear_caches(&bepinex_path);
    } else {
        app_log("Checking for mod updates...");
    }
    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let disabled_dir = PathBuf::from(&bepinex_path).join("disabled_plugins");
    let installed_versions = load_installed_versions(&bepinex_path);

    // Check cache first
    if let Some(cache) = load_cache(&bepinex_path) {
        let age = now_secs().saturating_sub(cache.timestamp);
        if age < CHECK_COOLDOWN_SECS {
            // Re-evaluate from cached latest versions against current installed state
            let mut mods = cache.mods;
            let mut total_updates = 0;
            for m in &mut mods {
                let folder = m.name.clone();
                let dll_name = format!("{}.dll", m.name);
                let dll_path = plugins_dir.join(&folder).join(&dll_name);
                let disabled_path = disabled_dir.join(&folder).join(&dll_name);
                let is_installed = dll_path.exists();
                let is_disabled = disabled_path.exists();
                let iv = installed_versions.get(&m.name).cloned();
                m.installed_version = iv.clone();
                if let Some(latest) = &m.latest_version {
                    // Don't flag updates for disabled mods
                    if is_disabled || !is_installed {
                        m.has_update = false;
                    } else if is_installed && iv.is_none() {
                        // Installed but no version recorded — flag for update
                        m.has_update = true;
                    } else {
                        m.has_update = is_installed
                            && iv
                                .as_deref()
                                .map(|v| v.trim_start_matches('v'))
                                != Some(latest.trim_start_matches('v'));
                    }
                    m.status = if is_disabled {
                        "disabled".to_string()
                    } else if !is_installed {
                        "not-installed".to_string()
                    } else if m.has_update {
                        "update-available".to_string()
                    } else {
                        "up-to-date".to_string()
                    };
                }
                if m.has_update {
                    total_updates += 1;
                }
            }
            return Ok(UpdateCheckResult {
                mods,
                total_updates,
                from_cache: true,
            });
        }
    }

    // Fresh check — single HTTP request
    let manifest = fetch_manifest()?;

    // Save manifest locally so get_mods can read descriptions
    if let Some(dir) = megaload_dir() {
        if let Ok(json) = serde_json::to_string_pretty(&manifest) {
            let _ = fs::write(dir.join("mod_manifest_cache.json"), json);
        }
    }

    let results = evaluate_updates(&manifest, &plugins_dir, &installed_versions);
    let total_updates = results.iter().filter(|m| m.has_update).count();

    save_cache(&bepinex_path, &results);

    app_log(&format!("Update check complete: {} mods checked, {} updates available", results.len(), total_updates));

    Ok(UpdateCheckResult {
        mods: results,
        total_updates,
        from_cache: false,
    })
}

/// Return the list of our starter mods from the manifest.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StarterMod {
    pub name: String,
    pub version: String,
    pub download_url: String,
    pub description: Option<String>,
}

#[command]
pub fn get_starter_mods() -> Result<Vec<StarterMod>, String> {
    let manifest = fetch_manifest()?;
    Ok(manifest
        .mods
        .into_iter()
        .filter(|m| !m.hidden)
        .map(|m| StarterMod {
            name: m.name,
            version: m.version,
            download_url: m.download_url,
            description: m.description,
        })
        .collect())
}

/// Install a single mod update by downloading the DLL.
#[command]
pub fn install_mod_update(
    bepinex_path: String,
    mod_name: String,
    download_url: String,
    version: String,
) -> Result<String, String> {
    // Validate download URL is HTTPS from an allowed host
    validate_download_url(&download_url)?;

    app_log(&format!("Downloading update for {} v{}", mod_name, version.trim_start_matches('v')));
    // Find mod info — try manifest first, fall back to name-based defaults
    let manifest = fetch_manifest().ok();
    let manifest_mod = manifest
        .as_ref()
        .and_then(|m| m.mods.iter().find(|mm| mm.name == mod_name));

    let plugin_folder = manifest_mod
        .map(|m| m.plugin_folder.clone())
        .unwrap_or_else(|| mod_name.clone());
    let dll_name = manifest_mod
        .map(|m| m.dll_name.clone())
        .unwrap_or_else(|| format!("{}.dll", mod_name));

    // Validate path components from manifest to prevent traversal
    sanitize_path_component(&plugin_folder)?;
    sanitize_path_component(&dll_name)?;

    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let disabled_dir = PathBuf::from(&bepinex_path).join("disabled_plugins");

    // Check if mod is disabled — if so, update in disabled_plugins/ to respect the user's choice
    let disabled_mod_dir = disabled_dir.join(&plugin_folder);
    let mod_dir = if disabled_mod_dir.exists() {
        app_log(&format!("{} is disabled — updating in disabled_plugins/", mod_name));
        disabled_mod_dir
    } else {
        let d = plugins_dir.join(&plugin_folder);
        if !d.exists() {
            fs::create_dir_all(&d).map_err(|e| format!("Failed to create dir: {}", e))?;
        }
        d
    };

    let dll_path = mod_dir.join(&dll_name);

    // Download the DLL via MegaWorker. The manifest's `download_url` was
    // rewritten in `fetch_manifest()` so we should already have a Worker URL,
    // but rewrite defensively in case a stale cached entry slipped through.
    let download_url = rewrite_to_worker_url(&download_url);
    let resp = crate::commands::http::agent()
        .get(&download_url)
        .set("User-Agent", concat!("MegaLoad/", env!("CARGO_PKG_VERSION")))
        .call()
        .map_err(|e| format!("Download failed for {}: {}", mod_name, e))?;

    let mut bytes: Vec<u8> = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Read error: {}", e))?;

    let mut file =
        fs::File::create(&dll_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    let mut versions = load_installed_versions(&bepinex_path);
    let old_version = versions.get(&mod_name).cloned();
    versions.insert(mod_name.clone(), version.clone());
    save_installed_versions(&bepinex_path, &versions);

    // Record in update log
    record_update("mod", &mod_name, old_version.as_deref(), &version);
    app_log(&format!("Updated {} to v{}", mod_name, version.trim_start_matches('v')));

    Ok(format!(
        "Updated {} to v{}",
        mod_name,
        version.trim_start_matches('v')
    ))
}

/// Check for updates and install all available updates in one go.
/// When `force` is true, caches are cleared first to guarantee a fresh check.
#[command]
pub fn auto_update_mods(bepinex_path: String, force: bool) -> Result<UpdateCheckResult, String> {
    app_log("Auto-update: checking and installing all available updates...");
    let check = check_mod_updates(bepinex_path.clone(), force)?;

    let mut updated_mods = check.mods.clone();

    for (i, mod_info) in check.mods.iter().enumerate() {
        if mod_info.has_update {
            if let (Some(url), Some(ver)) = (&mod_info.download_url, &mod_info.latest_version) {
                match install_mod_update(
                    bepinex_path.clone(),
                    mod_info.name.clone(),
                    url.clone(),
                    ver.clone(),
                ) {
                    Ok(_) => {
                        updated_mods[i].status = "updated".to_string();
                        updated_mods[i].has_update = false;
                        updated_mods[i].installed_version = Some(ver.clone());
                    }
                    Err(e) => {
                        updated_mods[i].status = "error".to_string();
                        updated_mods[i].error = Some(e);
                    }
                }
            } else {
                app_log(&format!(
                    "WARNING: {} flagged for update but missing download_url or version — skipping",
                    mod_info.name
                ));
            }
        }
    }

    let remaining = updated_mods.iter().filter(|m| m.has_update).count();
    Ok(UpdateCheckResult {
        mods: updated_mods,
        total_updates: remaining,
        from_cache: check.from_cache,
    })
}

/// Record the current version of a mod (used after manual install/build).
#[command]
pub fn set_mod_version(bepinex_path: String, mod_name: String, version: String) -> Result<(), String> {
    let mut versions = load_installed_versions(&bepinex_path);
    versions.insert(mod_name, version);
    save_installed_versions(&bepinex_path, &versions);
    Ok(())
}

// ── Bundled internal plugins ───────────────────────────────

/// Internal BepInEx plugins bundled as Tauri resources. The bundled DLL is the
/// floor: if the user drops a newer build into their profile's `plugins/<folder>/`
/// we keep their copy, so side-channel updates don't require a full MegaLoad
/// release. Versions are read live from the DLL's BepInPlugin attribute via
/// `read_bepinplugin_version`. Tuple: (folder, dll_name, bepin_guid).
const BUNDLED_PLUGINS: &[(&str, &str, &str)] = &[
    ("MegaDataExtractor", "MegaDataExtractor.dll", "com.mega.dataextractor"),
];

/// Scan a BepInEx plugin DLL for its [BepInPlugin(guid, name, version)] attribute
/// and return the version string. Works by locating the GUID (a unique and stable
/// key) in the .NET custom-attribute blob and walking past the length-prefixed
/// name to the length-prefixed version string. Returns None if the file can't be
/// read, the GUID isn't found, or the version isn't a plausible semver.
pub fn read_bepinplugin_version(dll_path: &Path, guid: &str) -> Option<String> {
    let bytes = fs::read(dll_path).ok()?;
    let guid_bytes = guid.as_bytes();
    // Find the GUID anywhere in the DLL (appears once as part of the attribute blob).
    let idx = bytes
        .windows(guid_bytes.len())
        .position(|w| w == guid_bytes)?;
    let mut p = idx + guid_bytes.len();
    if p >= bytes.len() { return None; }
    // SerString layout: compressed-int length prefix (one byte for len < 128) + UTF-8 bytes.
    let name_len = bytes[p] as usize;
    if name_len >= 128 { return None; } // guard against multi-byte compressed ints
    p += 1 + name_len;
    if p >= bytes.len() { return None; }
    let ver_len = bytes[p] as usize;
    if ver_len == 0 || ver_len >= 128 { return None; }
    p += 1;
    if p + ver_len > bytes.len() { return None; }
    let ver = std::str::from_utf8(&bytes[p..p + ver_len]).ok()?;
    if !ver.chars().all(|c| c.is_ascii_digit() || c == '.') { return None; }
    Some(ver.to_string())
}

/// Compare two dotted-numeric versions (e.g. "1.4.0" vs "1.10.2").
/// Missing segments are treated as 0, so "1.4" < "1.4.1".
fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').map(|s| s.parse::<u32>().unwrap_or(0)).collect()
    };
    let av = parse(a);
    let bv = parse(b);
    av.cmp(&bv)
}

/// Resolve the version for a bundled plugin. Prefers the user-installed DLL in
/// the active profile's plugins folder (if given) — that's what's actually
/// loaded at runtime. Falls back to the bundled resource DLL shipped with this
/// MegaLoad build. Returns None only if neither DLL is readable.
pub fn bundled_plugin_version_for_profile(
    app: &AppHandle,
    bepinex_path: Option<&Path>,
    mod_name: &str,
) -> Option<String> {
    let (folder, dll, guid) = BUNDLED_PLUGINS
        .iter()
        .find(|(folder, _, _)| *folder == mod_name)
        .copied()?;

    if let Some(bep) = bepinex_path {
        let installed = bep.join("plugins").join(folder).join(dll);
        if let Some(v) = read_bepinplugin_version(&installed, guid) {
            return Some(v);
        }
    }
    let resource = app.path().resolve(dll, tauri::path::BaseDirectory::Resource).ok()?;
    read_bepinplugin_version(&resource, guid)
}

/// List of bundled plugin folder names — used by the Mods scanner to know which
/// DLLs should be badged as "Bundled with MegaLoad".
pub fn bundled_plugin_names() -> impl Iterator<Item = &'static str> {
    BUNDLED_PLUGINS.iter().map(|(folder, _, _)| *folder)
}

/// Outcome of a single bundled-plugin deploy attempt.
#[derive(Serialize, Deserialize, Clone)]
pub struct PluginDeployOutcome {
    pub folder: String,
    pub dll: String,
    /// "installed" (fresh drop), "upgraded" (overwrote older), "kept"
    /// (installed ≥ bundled), "resource_missing" (bundled resource not found,
    /// dev mode), "failed" (fs::copy errored — most often a file lock while
    /// Valheim's running).
    pub action: String,
    pub installed_version: Option<String>,
    pub bundled_version: Option<String>,
    pub error: Option<String>,
}

/// Aggregated result of `deploy_bundled_plugins`. Gives the UI enough detail
/// to surface failures instead of silently swallowing them.
#[derive(Serialize, Deserialize, Clone)]
pub struct DeployBundledResult {
    pub outcomes: Vec<PluginDeployOutcome>,
    pub success_count: u32,
    pub failure_count: u32,
}

/// Deploy bundled internal plugins to the active profile's BepInEx/plugins folder.
/// A user-installed DLL with an equal or higher version than the bundled resource
/// is left untouched, so drop-in upgrades from outside MegaLoad survive profile
/// activation. Only older or missing DLLs are overwritten.
///
/// Returns per-plugin outcomes so the frontend can toast on failure — previously
/// errors were swallowed via `.catch(console.warn)` in the sidebar and stale DLLs
/// could linger invisibly (e.g. when Valheim held a file lock during deploy).
#[command]
pub fn deploy_bundled_plugins(app: AppHandle, bepinex_path: String) -> Result<DeployBundledResult, String> {
    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let mut outcomes = Vec::with_capacity(BUNDLED_PLUGINS.len());

    for &(folder, dll, guid) in BUNDLED_PLUGINS {
        let dest_dir = plugins_dir.join(folder);
        let dest_dll = dest_dir.join(dll);

        let resource = app
            .path()
            .resolve(dll, tauri::path::BaseDirectory::Resource);
        let source: PathBuf = match resource {
            Ok(p) if p.exists() => p,
            _ => {
                app_log(&format!("[deploy] {} bundled resource not found (dev mode?) — skipping", dll));
                outcomes.push(PluginDeployOutcome {
                    folder: folder.into(),
                    dll: dll.into(),
                    action: "resource_missing".into(),
                    installed_version: None,
                    bundled_version: None,
                    error: None,
                });
                continue;
            }
        };

        let bundled_ver = read_bepinplugin_version(&source, guid);
        let installed_ver = if dest_dll.exists() {
            read_bepinplugin_version(&dest_dll, guid)
        } else {
            None
        };

        if let (Some(inst), Some(bund)) = (&installed_ver, &bundled_ver) {
            if compare_versions(inst, bund) != Ordering::Less {
                app_log(&format!(
                    "[deploy] keeping user-installed {} v{} (bundled v{})",
                    dll, inst, bund
                ));
                outcomes.push(PluginDeployOutcome {
                    folder: folder.into(),
                    dll: dll.into(),
                    action: "kept".into(),
                    installed_version: Some(inst.clone()),
                    bundled_version: Some(bund.clone()),
                    error: None,
                });
                continue;
            }
        }

        if let Err(e) = fs::create_dir_all(&dest_dir) {
            app_log(&format!("[deploy] failed to create {} dir: {}", dll, e));
            outcomes.push(PluginDeployOutcome {
                folder: folder.into(),
                dll: dll.into(),
                action: "failed".into(),
                installed_version: installed_ver.clone(),
                bundled_version: bundled_ver.clone(),
                error: Some(format!("create_dir_all: {}", e)),
            });
            continue;
        }

        match fs::copy(&source, &dest_dll) {
            Ok(_) => {
                let bv = bundled_ver.as_deref().unwrap_or("?");
                let (msg, action) = match installed_ver.as_deref() {
                    Some(i) => (format!("[deploy] upgraded {} v{} -> bundled v{}", dll, i, bv), "upgraded"),
                    None => (format!("[deploy] installed bundled {} v{}", dll, bv), "installed"),
                };
                app_log(&msg);
                outcomes.push(PluginDeployOutcome {
                    folder: folder.into(),
                    dll: dll.into(),
                    action: action.into(),
                    installed_version: installed_ver.clone(),
                    bundled_version: bundled_ver.clone(),
                    error: None,
                });
            }
            Err(e) => {
                // Most common failure: Valheim (or its BepInEx) holds the DLL open
                // while we try to overwrite. Make this loud — ERROR on the installed
                // DLL staying stale was how we spent an afternoon chasing a v1.2.0
                // vs v1.4.3 mismatch with no log surface.
                app_log(&format!("[deploy] FAILED to copy {}: {} (is Valheim running?)", dll, e));
                outcomes.push(PluginDeployOutcome {
                    folder: folder.into(),
                    dll: dll.into(),
                    action: "failed".into(),
                    installed_version: installed_ver.clone(),
                    bundled_version: bundled_ver.clone(),
                    error: Some(e.to_string()),
                });
            }
        }
    }

    let failure_count = outcomes.iter().filter(|o| o.action == "failed").count() as u32;
    let success_count = outcomes.len() as u32 - failure_count;
    Ok(DeployBundledResult {
        outcomes,
        success_count,
        failure_count,
    })
}

/// Install ALL mods from the manifest that don't exist locally.
/// Used during sync pull to fully replicate a profile on a new machine.
#[command]
pub fn sync_install_all_mods(bepinex_path: String) -> Result<u32, String> {
    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let manifest = fetch_manifest()?;
    let mut installed: u32 = 0;

    for m in &manifest.mods {
        let dll_path = plugins_dir.join(&m.plugin_folder).join(&m.dll_name);
        if dll_path.exists() {
            continue; // Already installed
        }

        app_log(&format!("Sync: installing {} v{}", m.name, m.version));
        match install_mod_update(
            bepinex_path.clone(),
            m.name.clone(),
            m.download_url.clone(),
            m.version.clone(),
        ) {
            Ok(_) => installed += 1,
            Err(e) => app_log(&format!("Sync: failed to install {}: {}", m.name, e)),
        }
    }

    app_log(&format!("Sync: installed {} mods from manifest", installed));
    Ok(installed)
}

// ── Update Log ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateLogEntry {
    pub timestamp: String,
    pub update_type: String, // "mod" or "app"
    pub name: String,
    pub from_version: Option<String>,
    pub to_version: String,
}

fn update_log_path() -> PathBuf {
    megaload_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("update_log.json")
}

fn load_update_log() -> Vec<UpdateLogEntry> {
    let path = update_log_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn save_update_log(entries: &[UpdateLogEntry]) {
    let path = update_log_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = fs::write(&path, json);
    }
}

pub fn record_update(update_type: &str, name: &str, from_version: Option<&str>, to_version: &str) {
    let mut entries = load_update_log();
    entries.push(UpdateLogEntry {
        timestamp: iso_now(),
        update_type: update_type.to_string(),
        name: name.to_string(),
        from_version: from_version.map(|s| s.to_string()),
        to_version: to_version.to_string(),
    });
    // Keep last 200 entries
    if entries.len() > 200 {
        entries = entries.split_off(entries.len() - 200);
    }
    save_update_log(&entries);
}

fn iso_now() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs_per_day: u64 = 86400;
    let days = now / secs_per_day;
    let time_of_day = now % secs_per_day;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let mut y = 1970i64;
    let mut remaining = days as i64;
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

/// Read the update log for the frontend.
#[command]
pub fn get_update_log() -> Result<Vec<UpdateLogEntry>, String> {
    Ok(load_update_log())
}

/// Record an app update from the frontend.
#[command]
pub fn record_app_update(from_version: String, to_version: String) -> Result<(), String> {
    record_update("app", "MegaLoad", Some(&from_version), &to_version);
    app_log(&format!("App updated: v{} → v{}", from_version, to_version));
    Ok(())
}
