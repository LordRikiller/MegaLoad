use crate::commands::app_log::app_log;
use crate::commands::security::{sanitize_path_component, validate_download_url};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;
use zip::ZipArchive;

/// Thunderstore API for Valheim packages.
const TS_API_URL: &str = "https://thunderstore.io/c/valheim/api/v1/package/";

/// Cache lifetime in seconds (15 minutes).
const CACHE_TTL_SECS: u64 = 900;

// ── Types ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThunderstorePackage {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub package_url: String,
    pub rating_score: i32,
    pub is_deprecated: bool,
    pub is_pinned: bool,
    pub categories: Vec<String>,
    pub versions: Vec<ThunderstoreVersion>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThunderstoreVersion {
    pub name: String,
    pub full_name: String,
    pub version_number: String,
    pub download_url: String,
    pub downloads: u64,
    pub description: String,
    pub icon: String,
    pub dependencies: Vec<String>,
    pub date_created: String,
    pub file_size: u64,
    pub website_url: String,
    pub is_active: bool,
}

/// Slim representation sent to the frontend (full package list can be huge).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThunderstoreListItem {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub version: String,
    pub description: String,
    pub downloads: u64,
    pub rating: i32,
    pub icon: String,
    pub categories: Vec<String>,
    pub is_deprecated: bool,
    pub date_updated: String,
    pub dependency_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThunderstoreModDetail {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub description: String,
    pub icon: String,
    pub rating: i32,
    pub is_deprecated: bool,
    pub categories: Vec<String>,
    pub website_url: String,
    pub versions: Vec<ThunderstoreVersionDetail>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThunderstoreVersionDetail {
    pub version_number: String,
    pub download_url: String,
    pub downloads: u64,
    pub description: String,
    pub dependencies: Vec<String>,
    pub date_created: String,
    pub file_size: u64,
}

// ── Cache ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct PackageCache {
    timestamp: u64,
    packages: Vec<ThunderstorePackage>,
}

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn cache_path() -> PathBuf {
    megaload_dir().join("thunderstore_cache.json")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn load_cache() -> Option<Vec<ThunderstorePackage>> {
    let data = fs::read_to_string(cache_path()).ok()?;
    let cache: PackageCache = serde_json::from_str(&data).ok()?;
    if now_secs().saturating_sub(cache.timestamp) < CACHE_TTL_SECS {
        Some(cache.packages)
    } else {
        None
    }
}

fn save_cache(packages: &[ThunderstorePackage]) {
    let cache = PackageCache {
        timestamp: now_secs(),
        packages: packages.to_vec(),
    };
    if let Ok(json) = serde_json::to_string(&cache) {
        let dir = megaload_dir();
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(cache_path(), json);
    }
}

// ── API ────────────────────────────────────────────────────

fn fetch_packages() -> Result<Vec<ThunderstorePackage>, String> {
    if let Some(cached) = load_cache() {
        return Ok(cached);
    }

    app_log("Fetching Thunderstore package list...");
    let resp = ureq::get(TS_API_URL)
        .set("User-Agent", "MegaLoad/0.13.3")
        .set("Accept", "application/json")
        .call()
        .map_err(|e| format!("Thunderstore API error: {}", e))?;

    let body = {
        let mut buf = Vec::new();
        resp.into_reader()
            .read_to_end(&mut buf)
            .map_err(|e| format!("Read error: {}", e))?;
        String::from_utf8(buf).map_err(|e| format!("UTF-8 error: {}", e))?
    };

    let packages: Vec<ThunderstorePackage> =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    save_cache(&packages);
    app_log(&format!(
        "Fetched {} Thunderstore packages",
        packages.len()
    ));
    Ok(packages)
}

// ── Commands ───────────────────────────────────────────────

/// Browse/search Thunderstore mods. Returns a slim list for the UI.
#[command]
pub fn search_thunderstore(
    query: Option<String>,
    category: Option<String>,
    page: Option<usize>,
    per_page: Option<usize>,
) -> Result<ThunderstoreSearchResult, String> {
    let packages = fetch_packages()?;
    let per_page = per_page.unwrap_or(20).min(100);
    let page = page.unwrap_or(0);

    let query_lower = query
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let cat_lower = category
        .as_deref()
        .unwrap_or("")
        .to_lowercase();

    // Filter
    let filtered: Vec<&ThunderstorePackage> = packages
        .iter()
        .filter(|p| {
            // Skip deprecated unless explicitly searching
            if p.is_deprecated && query_lower.is_empty() {
                return false;
            }
            // Category filter
            if !cat_lower.is_empty()
                && !p
                    .categories
                    .iter()
                    .any(|c| c.to_lowercase().contains(&cat_lower))
            {
                return false;
            }
            // Text search
            if !query_lower.is_empty() {
                let latest = p.versions.first();
                let desc = latest
                    .map(|v| v.description.to_lowercase())
                    .unwrap_or_default();
                let matches = p.name.to_lowercase().contains(&query_lower)
                    || p.owner.to_lowercase().contains(&query_lower)
                    || p.full_name.to_lowercase().contains(&query_lower)
                    || desc.contains(&query_lower);
                if !matches {
                    return false;
                }
            }
            true
        })
        .collect();

    let total = filtered.len();

    // Sort by downloads (most popular first)
    let mut sorted = filtered;
    sorted.sort_by(|a, b| {
        let a_dl = a.versions.first().map(|v| v.downloads).unwrap_or(0);
        let b_dl = b.versions.first().map(|v| v.downloads).unwrap_or(0);
        b_dl.cmp(&a_dl)
    });

    // Paginate
    let start = page * per_page;
    let items: Vec<ThunderstoreListItem> = sorted
        .into_iter()
        .skip(start)
        .take(per_page)
        .filter_map(|p| {
            let latest = p.versions.first()?;
            Some(ThunderstoreListItem {
                full_name: p.full_name.clone(),
                name: p.name.clone(),
                owner: p.owner.clone(),
                version: latest.version_number.clone(),
                description: latest.description.clone(),
                downloads: latest.downloads,
                rating: p.rating_score,
                icon: latest.icon.clone(),
                categories: p.categories.clone(),
                is_deprecated: p.is_deprecated,
                date_updated: latest.date_created.clone(),
                dependency_count: latest.dependencies.len(),
            })
        })
        .collect();

    Ok(ThunderstoreSearchResult {
        items,
        total,
        page,
        per_page,
    })
}

#[derive(Serialize, Clone, Debug)]
pub struct ThunderstoreSearchResult {
    pub items: Vec<ThunderstoreListItem>,
    pub total: usize,
    pub page: usize,
    pub per_page: usize,
}

/// Get detailed info for a specific Thunderstore package.
#[command]
pub fn get_thunderstore_detail(full_name: String) -> Result<ThunderstoreModDetail, String> {
    let packages = fetch_packages()?;
    let pkg = packages
        .iter()
        .find(|p| p.full_name == full_name)
        .ok_or_else(|| format!("Package not found: {}", full_name))?;

    let latest = pkg
        .versions
        .first()
        .ok_or("No versions available")?;

    Ok(ThunderstoreModDetail {
        full_name: pkg.full_name.clone(),
        name: pkg.name.clone(),
        owner: pkg.owner.clone(),
        description: latest.description.clone(),
        icon: latest.icon.clone(),
        rating: pkg.rating_score,
        is_deprecated: pkg.is_deprecated,
        categories: pkg.categories.clone(),
        website_url: latest.website_url.clone(),
        versions: pkg
            .versions
            .iter()
            .take(10) // Only send last 10 versions
            .map(|v| ThunderstoreVersionDetail {
                version_number: v.version_number.clone(),
                download_url: v.download_url.clone(),
                downloads: v.downloads,
                description: v.description.clone(),
                dependencies: v.dependencies.clone(),
                date_created: v.date_created.clone(),
                file_size: v.file_size,
            })
            .collect(),
    })
}

/// Get all unique categories from Thunderstore.
#[command]
pub fn get_thunderstore_categories() -> Result<Vec<String>, String> {
    let packages = fetch_packages()?;
    let mut cats: Vec<String> = packages
        .iter()
        .flat_map(|p| p.categories.iter().cloned())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    cats.sort();
    Ok(cats)
}

/// Install a mod from Thunderstore into the active profile.
/// Downloads the zip, extracts DLLs into plugins/<folder_name>/.
#[command]
pub fn install_thunderstore_mod(
    bepinex_path: String,
    full_name: String,
    download_url: String,
    version: String,
) -> Result<String, String> {
    app_log(&format!(
        "Installing Thunderstore mod: {} v{}",
        full_name, version
    ));

    // Validate download URL
    validate_download_url(&download_url)?;

    // 1. Download the zip
    let bytes = download_ts_file(&download_url)?;

    // 2. Extract into the profile's plugins directory
    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let mod_folder_name = full_name.replace('/', "-"); // e.g. "Author-ModName"

    // Validate the derived folder name
    sanitize_path_component(&mod_folder_name)?;
    let mod_dir = plugins_dir.join(&mod_folder_name);

    extract_thunderstore_zip(&bytes, &mod_dir)?;

    // 3. Track the installed version
    save_ts_installed_mod(&bepinex_path, &full_name, &version, &mod_folder_name);

    app_log(&format!("Installed {} v{}", full_name, version));
    Ok(format!("Installed {} v{}", full_name, version))
}

/// Update an already-installed Thunderstore mod.
#[command]
pub fn update_thunderstore_mod(
    bepinex_path: String,
    full_name: String,
    download_url: String,
    version: String,
    folder_name: String,
) -> Result<String, String> {
    app_log(&format!(
        "Updating Thunderstore mod: {} to v{}",
        full_name, version
    ));

    // Validate download URL and folder name
    validate_download_url(&download_url)?;
    sanitize_path_component(&folder_name)?;

    let bytes = download_ts_file(&download_url)?;
    let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
    let mod_dir = plugins_dir.join(&folder_name);

    // Remove old files before extracting new version
    if mod_dir.exists() {
        let _ = fs::remove_dir_all(&mod_dir);
    }

    extract_thunderstore_zip(&bytes, &mod_dir)?;
    save_ts_installed_mod(&bepinex_path, &full_name, &version, &folder_name);

    app_log(&format!("Updated {} to v{}", full_name, version));
    Ok(format!("Updated {} to v{}", full_name, version))
}

/// Get list of Thunderstore mods installed in the current profile.
#[command]
pub fn get_installed_thunderstore_mods(
    bepinex_path: String,
) -> Result<Vec<InstalledTsMod>, String> {
    let state = load_ts_state(&bepinex_path);
    Ok(state.mods)
}

/// Uninstall a Thunderstore mod.
#[command]
pub fn uninstall_thunderstore_mod(
    bepinex_path: String,
    full_name: String,
) -> Result<(), String> {
    let mut state = load_ts_state(&bepinex_path);
    if let Some(pos) = state.mods.iter().position(|m| m.full_name == full_name) {
        let removed = state.mods.remove(pos);

        // Validate folder name before deletion
        sanitize_path_component(&removed.folder_name)?;

        // Remove the folder
        let plugins_dir = PathBuf::from(&bepinex_path).join("plugins");
        let mod_dir = plugins_dir.join(&removed.folder_name);
        if mod_dir.exists() {
            fs::remove_dir_all(&mod_dir)
                .map_err(|e| format!("Failed to remove mod folder: {}", e))?;
        }
        save_ts_state(&bepinex_path, &state);
        app_log(&format!("Uninstalled Thunderstore mod: {}", full_name));
    }
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────

fn download_ts_file(url: &str) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .set("User-Agent", "MegaLoad/0.13.3")
        .call()
        .map_err(|e| format!("Download error: {}", e))?;

    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Read error: {}", e))?;

    if bytes.len() < 100 {
        return Err("Downloaded file is too small — download may have failed".to_string());
    }
    Ok(bytes)
}

/// Extract a Thunderstore zip into the mod's install directory.
/// Thunderstore zips have varying structures, so we handle multiple layouts:
/// - DLLs at root level
/// - DLLs inside plugins/ subfolder
/// - Nested Author-ModName/plugins/ structure
fn extract_thunderstore_zip(bytes: &[u8], mod_dir: &Path) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|e| format!("Failed to open zip: {}", e))?;

    fs::create_dir_all(mod_dir)
        .map_err(|e| format!("Failed to create mod dir: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {}", e))?;

        // Security: guard against path traversal
        let name = match file.enclosed_name() {
            Some(n) => n.to_path_buf(),
            None => continue,
        };

        let name_str = name.to_string_lossy().replace('\\', "/");

        // Skip icon.png and README.md at the extraction stage — keep them for metadata
        // We want everything: DLLs, configs, assets, manifests
        if file.is_dir() {
            let outpath = mod_dir.join(&name_str);
            let _ = fs::create_dir_all(&outpath);
        } else {
            let outpath = mod_dir.join(&name_str);
            if let Some(parent) = outpath.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Create file error: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Extract error: {}", e))?;
        }
    }

    Ok(())
}

// ── Installed mod tracking ─────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledTsMod {
    pub full_name: String,
    pub version: String,
    pub folder_name: String,
    pub installed_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct TsInstalledState {
    mods: Vec<InstalledTsMod>,
}

fn ts_state_path(bepinex_path: &str) -> PathBuf {
    PathBuf::from(bepinex_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("thunderstore_mods.json")
}

fn load_ts_state(bepinex_path: &str) -> TsInstalledState {
    let path = ts_state_path(bepinex_path);
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        TsInstalledState::default()
    }
}

fn save_ts_state(bepinex_path: &str, state: &TsInstalledState) {
    let path = ts_state_path(bepinex_path);
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, json);
    }
}

fn save_ts_installed_mod(
    bepinex_path: &str,
    full_name: &str,
    version: &str,
    folder_name: &str,
) {
    let mut state = load_ts_state(bepinex_path);
    // Update or insert
    if let Some(existing) = state.mods.iter_mut().find(|m| m.full_name == full_name) {
        existing.version = version.to_string();
        existing.installed_at = now_secs();
    } else {
        state.mods.push(InstalledTsMod {
            full_name: full_name.to_string(),
            version: version.to_string(),
            folder_name: folder_name.to_string(),
            installed_at: now_secs(),
        });
    }
    save_ts_state(bepinex_path, &state);
}
