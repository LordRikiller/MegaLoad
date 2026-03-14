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

/// Minimum seconds between update checks (15 minutes).
const CHECK_COOLDOWN_SECS: u64 = 900;

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

fn versions_file_path() -> PathBuf {
    megaload_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mod_versions.json")
}

fn cache_file_path() -> PathBuf {
    megaload_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("update_cache.json")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn load_installed_versions() -> std::collections::HashMap<String, String> {
    let path = versions_file_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    }
}

fn save_installed_versions(versions: &std::collections::HashMap<String, String>) {
    let path = versions_file_path();
    if let Ok(json) = serde_json::to_string_pretty(versions) {
        let _ = fs::write(&path, json);
    }
}

fn load_cache() -> Option<CachedUpdateCheck> {
    let path = cache_file_path();
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_cache(mods: &[ModUpdateInfo]) {
    let cache = CachedUpdateCheck {
        timestamp: now_secs(),
        mods: mods.to_vec(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&cache) {
        let _ = fs::write(cache_file_path(), json);
    }
}

/// Fetch the mod manifest — a single HTTP request for all mod info.
fn fetch_manifest() -> Result<ModManifest, String> {
    let resp = ureq::get(MANIFEST_URL)
        .set("User-Agent", "MegaLoad/0.4.0")
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
                    None => true,
                }
            };

            ModUpdateInfo {
                name: m.name.clone(),
                installed_version: iv,
                latest_version: Some(latest),
                has_update,
                download_url: if has_update {
                    Some(m.download_url.clone())
                } else {
                    None
                },
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

/// Check all mods for updates. Uses cache if <15min old, otherwise ONE HTTP request.
#[command]
pub fn check_mod_updates(bepinex_path: String) -> Result<UpdateCheckResult, String> {
    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let installed_versions = load_installed_versions();

    // Check cache first
    if let Some(cache) = load_cache() {
        let age = now_secs().saturating_sub(cache.timestamp);
        if age < CHECK_COOLDOWN_SECS {
            // Re-evaluate from cached latest versions against current installed state
            let mut mods = cache.mods;
            let mut total_updates = 0;
            for m in &mut mods {
                let folder = m.name.clone(); // plugin_folder == name for our mods
                let dll_name = format!("{}.dll", m.name);
                let dll_path = plugins_dir.join(&folder).join(&dll_name);
                let is_installed = dll_path.exists();
                let iv = installed_versions.get(&m.name).cloned();
                m.installed_version = iv.clone();
                if let Some(latest) = &m.latest_version {
                    m.has_update = is_installed
                        && iv
                            .as_deref()
                            .map(|v| v.trim_start_matches('v'))
                            != Some(latest.trim_start_matches('v'));
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

    save_cache(&results);

    Ok(UpdateCheckResult {
        mods: results,
        total_updates,
        from_cache: false,
    })
}

/// Install a single mod update by downloading the DLL.
#[command]
pub fn install_mod_update(
    bepinex_path: String,
    mod_name: String,
    download_url: String,
    version: String,
) -> Result<String, String> {
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

    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let mod_dir = plugins_dir.join(&plugin_folder);

    if !mod_dir.exists() {
        fs::create_dir_all(&mod_dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    let dll_path = mod_dir.join(&dll_name);

    // Download the DLL (this is a direct file download, not an API call — no rate limit)
    let resp = ureq::get(&download_url)
        .set("User-Agent", "MegaLoad/0.4.0")
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

    let mut versions = load_installed_versions();
    versions.insert(mod_name.clone(), version.clone());
    save_installed_versions(&versions);

    Ok(format!(
        "Updated {} to v{}",
        mod_name,
        version.trim_start_matches('v')
    ))
}

/// Check for updates and install all available updates in one go.
#[command]
pub fn auto_update_mods(bepinex_path: String) -> Result<UpdateCheckResult, String> {
    let check = check_mod_updates(bepinex_path.clone())?;

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
pub fn set_mod_version(mod_name: String, version: String) -> Result<(), String> {
    let mut versions = load_installed_versions();
    versions.insert(mod_name, version);
    save_installed_versions(&versions);
    Ok(())
}
