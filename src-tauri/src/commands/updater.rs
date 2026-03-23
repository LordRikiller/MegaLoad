use crate::commands::app_log::app_log;
use crate::commands::security::{sanitize_path_component, validate_download_url};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

/// URL to the single manifest file — ONE request to check ALL mods.
/// Hosted as a release asset on the MegaLoad repo.
const MANIFEST_URL: &str =
    "https://github.com/ccmrik/MegaLoad/releases/latest/download/mod-manifest.json";

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

/// Fetch the mod manifest — a single HTTP request for all mod info.
fn fetch_manifest() -> Result<ModManifest, String> {
    let resp = crate::commands::http::agent().get(MANIFEST_URL)
        .set("User-Agent", "MegaLoad/0.15.3")
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
    serde_json::from_str(&body).map_err(|e| format!("Manifest parse error: {}", e))
}

/// Build update info for each mod from the manifest.
fn evaluate_updates(
    manifest: &ModManifest,
    plugins_dir: &PathBuf,
    installed_versions: &std::collections::HashMap<String, String>,
) -> Vec<ModUpdateInfo> {
    manifest
        .mods
        .iter()
        .map(|m| {
            let dll_path = plugins_dir.join(&m.plugin_folder).join(&m.dll_name);
            let is_installed = dll_path.exists();
            let iv = installed_versions.get(&m.name).cloned();
            let latest = m.version.trim_start_matches('v').to_string();

            let has_update = if !is_installed {
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
                status: if !is_installed {
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
                let is_installed = dll_path.exists();
                let iv = installed_versions.get(&m.name).cloned();
                m.installed_version = iv.clone();
                if let Some(latest) = &m.latest_version {
                    if is_installed && iv.is_none() {
                        // Installed but no version recorded — flag for update
                        m.has_update = true;
                    } else {
                        m.has_update = is_installed
                            && iv
                                .as_deref()
                                .map(|v| v.trim_start_matches('v'))
                                != Some(latest.trim_start_matches('v'));
                    }
                    m.status = if !is_installed {
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
    let mod_dir = plugins_dir.join(&plugin_folder);

    if !mod_dir.exists() {
        fs::create_dir_all(&mod_dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    let dll_path = mod_dir.join(&dll_name);

    // Download the DLL (this is a direct file download, not an API call — no rate limit)
    let resp = crate::commands::http::agent().get(&download_url)
        .set("User-Agent", "MegaLoad/0.15.3")
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
    versions.insert(mod_name.clone(), version.clone());
    save_installed_versions(&bepinex_path, &versions);
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
