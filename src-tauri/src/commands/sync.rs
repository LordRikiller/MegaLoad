use crate::commands::app_log::app_log;
use crate::commands::github::{github_get_file, github_put_file};
use crate::commands::identity::get_megaload_identity;
use crate::models::{
    SyncConfigHash, SyncManifest, SyncModEntry, SyncProfileEntry,
    SyncProfileState, SyncSettings, SyncStatus, SyncThunderstoreMod,
};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
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
    // Default: disabled, generate machine ID
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
    // Deterministic machine ID from hostname + username
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
    let input = format!("{}@{}", user, hostname);
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
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
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md as i64 {
            m = i;
            break;
        }
        remaining -= md as i64;
    }
    let d = remaining + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m + 1, d, hours, minutes, seconds
    )
}

/// Hash file contents for change detection.
fn hash_file_contents(path: &Path) -> String {
    if let Ok(data) = fs::read(path) {
        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    } else {
        String::new()
    }
}

// ---------------------------------------------------------------------------
// Profile state snapshot — reads current local state
// ---------------------------------------------------------------------------

/// Build a snapshot of a profile's current state from the filesystem.
fn snapshot_profile(profile_id: &str, profile_name: &str, bepinex_path: &str) -> Result<SyncProfileState, String> {
    let bep = Path::new(bepinex_path);
    let plugins_dir = bep.join("plugins");
    let disabled_dir = bep.join("disabled_plugins");

    // Collect mods
    let mut mods = Vec::new();

    // Scan enabled mods
    if plugins_dir.exists() {
        scan_mods_for_sync(&plugins_dir, true, &mut mods)?;
    }
    // Scan disabled mods
    if disabled_dir.exists() {
        scan_mods_for_sync(&disabled_dir, false, &mut mods)?;
    }

    // Read Thunderstore tracking
    let ts_mods = read_thunderstore_tracking(bepinex_path);

    // Hash config files
    let config_hashes = hash_config_files(bepinex_path);

    Ok(SyncProfileState {
        profile_id: profile_id.to_string(),
        profile_name: profile_name.to_string(),
        last_updated: iso_now(),
        mods,
        thunderstore_mods: ts_mods,
        config_hashes,
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
                name,
                file_name,
                version: None,
                enabled,
                source: "manual".to_string(),
            });
        } else if path.is_dir() {
            // Folder-based mod (e.g., Thunderstore installs)
            if let Some(dll) = find_dll_in_folder(&path) {
                let name = path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                mods.push(SyncModEntry {
                    name,
                    file_name: dll,
                    version: None,
                    enabled,
                    source: "thunderstore".to_string(),
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
        if let Ok(mods) = serde_json::from_str::<Vec<TsModEntry>>(&data) {
            return mods
                .into_iter()
                .map(|m| SyncThunderstoreMod {
                    full_name: m.full_name,
                    version: m.version,
                    folder_name: m.folder_name,
                })
                .collect();
        }
    }
    Vec::new()
}

#[derive(Deserialize)]
struct TsModEntry {
    full_name: String,
    version: String,
    folder_name: String,
}

fn hash_config_files(bepinex_path: &str) -> Vec<SyncConfigHash> {
    let config_dir = Path::new(bepinex_path).join("config");
    let mut hashes = Vec::new();
    if let Ok(entries) = fs::read_dir(&config_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.to_lowercase().ends_with(".cfg") {
                    let hash = hash_file_contents(&path);
                    hashes.push(SyncConfigHash { file_name, hash });
                }
            }
        }
    }
    hashes
}

// ---------------------------------------------------------------------------
// GitHub sync paths
// ---------------------------------------------------------------------------

fn sync_manifest_path(user_id: &str) -> String {
    format!("sync/{}/sync-manifest.json", user_id)
}

fn sync_profile_state_path(user_id: &str, profile_id: &str) -> String {
    format!("sync/{}/profiles/{}/state.json", user_id, profile_id)
}

fn sync_config_path(user_id: &str, profile_id: &str, config_name: &str) -> String {
    format!("sync/{}/profiles/{}/configs/{}", user_id, profile_id, config_name)
}

// ---------------------------------------------------------------------------
// Tauri commands — Sync settings
// ---------------------------------------------------------------------------

/// Get current sync status.
#[command]
pub fn sync_get_status() -> Result<SyncStatus, String> {
    let settings = load_sync_settings();

    let remote_profiles = if settings.enabled {
        // Try to fetch remote manifest for profile list
        if let Ok(identity) = get_megaload_identity() {
            match github_get_file(&sync_manifest_path(&identity.user_id)) {
                Ok((content, _)) => {
                    if let Ok(manifest) = serde_json::from_str::<SyncManifest>(&content) {
                        manifest.profiles
                    } else {
                        Vec::new()
                    }
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

/// Enable or disable cloud sync.
#[command]
pub fn sync_set_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = load_sync_settings();
    settings.enabled = enabled;
    save_sync_settings(&settings)?;
    app_log(&format!("Cloud sync {}", if enabled { "enabled" } else { "disabled" }));
    Ok(())
}

/// Enable or disable auto-sync.
#[command]
pub fn sync_set_auto_sync(auto_sync: bool) -> Result<(), String> {
    let mut settings = load_sync_settings();
    settings.auto_sync = auto_sync;
    save_sync_settings(&settings)?;
    app_log(&format!("Auto-sync {}", if auto_sync { "enabled" } else { "disabled" }));
    Ok(())
}

/// Get sync settings (for frontend to know if auto-sync is on).
#[command]
pub fn sync_get_settings() -> Result<SyncSettings, String> {
    Ok(load_sync_settings())
}

// ---------------------------------------------------------------------------
// Tauri commands — Push (local → cloud)
// ---------------------------------------------------------------------------

/// Push a single profile's state to the cloud.
#[command]
pub fn sync_push_profile(profile_id: String, profile_name: String, bepinex_path: String) -> Result<(), String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;

    app_log(&format!("Sync push: profile {} ({})", profile_name, profile_id));

    // 1. Snapshot current profile state
    let state = snapshot_profile(&profile_id, &profile_name, &bepinex_path)?;

    // 2. Push profile state JSON
    let state_path = sync_profile_state_path(user_id, &profile_id);
    let state_json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;

    let sha = match github_get_file(&state_path) {
        Ok((_, sha)) => Some(sha),
        Err(_) => None,
    };
    github_put_file(
        &state_path,
        state_json.as_bytes(),
        &format!("Sync profile {} — {}", profile_name, identity.display_name),
        sha.as_deref(),
    )?;

    // 3. Push config files that changed
    let config_dir = Path::new(&bepinex_path).join("config");
    for cfg_hash in &state.config_hashes {
        let cfg_path = config_dir.join(&cfg_hash.file_name);
        if cfg_path.exists() {
            let content = fs::read(&cfg_path).map_err(|e| e.to_string())?;
            let remote_path = sync_config_path(user_id, &profile_id, &cfg_hash.file_name);

            // Check if remote hash differs before uploading
            let remote_sha = match github_get_file(&remote_path) {
                Ok((remote_content, sha)) => {
                    // Compare content — only upload if different
                    if remote_content.as_bytes() == content.as_slice() {
                        continue; // Skip unchanged configs
                    }
                    Some(sha)
                }
                Err(_) => None,
            };

            github_put_file(
                &remote_path,
                &content,
                &format!("Sync config {} — {}", cfg_hash.file_name, profile_name),
                remote_sha.as_deref(),
            )?;
        }
    }

    // 4. Update sync settings
    let mut settings = load_sync_settings();
    settings.last_push = Some(iso_now());
    save_sync_settings(&settings)?;

    app_log(&format!("Sync push complete: {} ({} mods, {} configs)",
        profile_name, state.mods.len(), state.config_hashes.len()));

    Ok(())
}

/// Push all profiles to the cloud (full sync).
#[command]
pub fn sync_push_all(profiles_json: String) -> Result<(), String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;

    // Parse profiles from frontend
    let profiles: Vec<ProfilePushInfo> = serde_json::from_str(&profiles_json)
        .map_err(|e| format!("Invalid profiles JSON: {}", e))?;

    app_log(&format!("Sync push all: {} profiles", profiles.len()));

    // Build sync manifest
    let manifest = SyncManifest {
        user_id: user_id.clone(),
        last_sync: iso_now(),
        machine_id: settings.machine_id.clone(),
        profiles: profiles
            .iter()
            .map(|p| SyncProfileEntry {
                id: p.id.clone(),
                name: p.name.clone(),
                is_active: p.is_active,
                is_linked: p.is_linked,
            })
            .collect(),
    };

    // Push manifest
    let manifest_path = sync_manifest_path(user_id);
    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    let sha = match github_get_file(&manifest_path) {
        Ok((_, sha)) => Some(sha),
        Err(_) => None,
    };
    github_put_file(
        &manifest_path,
        manifest_json.as_bytes(),
        &format!("Sync manifest — {}", identity.display_name),
        sha.as_deref(),
    )?;

    // Push each profile
    for p in &profiles {
        if let Err(e) = sync_push_profile_inner(user_id, &identity.display_name, p) {
            app_log(&format!("Sync push failed for profile {}: {}", p.name, e));
            // Continue with other profiles — don't fail the whole operation
        }
    }

    // Update sync settings
    let mut settings = load_sync_settings();
    settings.last_push = Some(iso_now());
    save_sync_settings(&settings)?;

    app_log("Sync push all complete");
    Ok(())
}

#[derive(Deserialize)]
struct ProfilePushInfo {
    id: String,
    name: String,
    bepinex_path: String,
    is_active: bool,
    is_linked: bool,
}

fn sync_push_profile_inner(user_id: &str, display_name: &str, profile: &ProfilePushInfo) -> Result<(), String> {
    let state = snapshot_profile(&profile.id, &profile.name, &profile.bepinex_path)?;
    let state_path = sync_profile_state_path(user_id, &profile.id);
    let state_json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;

    let sha = match github_get_file(&state_path) {
        Ok((_, sha)) => Some(sha),
        Err(_) => None,
    };
    github_put_file(
        &state_path,
        state_json.as_bytes(),
        &format!("Sync profile {} — {}", profile.name, display_name),
        sha.as_deref(),
    )?;

    // Push config files
    let config_dir = Path::new(&profile.bepinex_path).join("config");
    for cfg_hash in &state.config_hashes {
        let cfg_path = config_dir.join(&cfg_hash.file_name);
        if cfg_path.exists() {
            let content = fs::read(&cfg_path).map_err(|e| e.to_string())?;
            let remote_path = sync_config_path(user_id, &profile.id, &cfg_hash.file_name);

            let remote_sha = match github_get_file(&remote_path) {
                Ok((remote_content, sha)) => {
                    if remote_content.as_bytes() == content.as_slice() {
                        continue;
                    }
                    Some(sha)
                }
                Err(_) => None,
            };

            github_put_file(
                &remote_path,
                &content,
                &format!("Sync config {} — {}", cfg_hash.file_name, profile.name),
                remote_sha.as_deref(),
            )?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Pull (cloud → local)
// ---------------------------------------------------------------------------

/// Pull the remote sync manifest to see what's available.
#[command]
pub fn sync_pull_manifest() -> Result<SyncManifest, String> {
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

/// Pull a single profile's state from the cloud.
#[command]
pub fn sync_pull_profile_state(profile_id: String) -> Result<SyncProfileState, String> {
    let identity = get_megaload_identity()?;
    let path = sync_profile_state_path(&identity.user_id, &profile_id);

    let (content, _) = github_get_file(&path)
        .map_err(|_| format!("No cloud state found for profile {}", profile_id))?;
    serde_json::from_str(&content).map_err(|e| format!("State parse error: {}", e))
}

/// Pull and apply a profile's configs from the cloud.
#[command]
pub fn sync_pull_configs(profile_id: String, bepinex_path: String) -> Result<u32, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;
    let config_dir = Path::new(&bepinex_path).join("config");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    // Get the remote profile state to know which configs exist
    let state_path = sync_profile_state_path(user_id, &profile_id);
    let (state_content, _) = github_get_file(&state_path)
        .map_err(|_| "No remote profile state found".to_string())?;
    let state: SyncProfileState = serde_json::from_str(&state_content)
        .map_err(|e| format!("State parse error: {}", e))?;

    let mut updated_count: u32 = 0;

    for cfg_hash in &state.config_hashes {
        let local_path = config_dir.join(&cfg_hash.file_name);
        let local_hash = if local_path.exists() {
            hash_file_contents(&local_path)
        } else {
            String::new()
        };

        // Only pull if remote hash differs from local
        if local_hash != cfg_hash.hash {
            let remote_path = sync_config_path(user_id, &profile_id, &cfg_hash.file_name);
            match github_get_file(&remote_path) {
                Ok((content, _)) => {
                    fs::write(&local_path, content.as_bytes()).map_err(|e| e.to_string())?;
                    updated_count += 1;
                    app_log(&format!("Sync pull config: {}", cfg_hash.file_name));
                }
                Err(e) => {
                    app_log(&format!("Sync pull config failed for {}: {}", cfg_hash.file_name, e));
                }
            }
        }
    }

    // Update sync settings
    let mut settings = load_sync_settings();
    settings.last_pull = Some(iso_now());
    save_sync_settings(&settings)?;

    app_log(&format!("Sync pull configs complete: {} updated", updated_count));
    Ok(updated_count)
}

/// Full pull — applies profile state + configs. Returns a summary.
#[command]
pub fn sync_pull_profile(profile_id: String, bepinex_path: String) -> Result<SyncPullResult, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Err("Cloud sync is not enabled".to_string());
    }

    let identity = get_megaload_identity()?;
    let user_id = &identity.user_id;

    app_log(&format!("Sync pull: profile {}", profile_id));

    // 1. Get remote state
    let state_path = sync_profile_state_path(user_id, &profile_id);
    let (state_content, _) = github_get_file(&state_path)
        .map_err(|_| "No remote state found for this profile".to_string())?;
    let remote_state: SyncProfileState = serde_json::from_str(&state_content)
        .map_err(|e| format!("State parse error: {}", e))?;

    // 2. Compare with local state
    let local_state = snapshot_profile(&profile_id, &remote_state.profile_name, &bepinex_path)?;

    // Find mods that need to be toggled (enabled/disabled mismatch)
    let mut toggled_mods = Vec::new();
    for remote_mod in &remote_state.mods {
        if let Some(local_mod) = local_state.mods.iter().find(|m| m.name == remote_mod.name) {
            if local_mod.enabled != remote_mod.enabled {
                // Toggle this mod
                toggle_mod_sync(&bepinex_path, &remote_mod.file_name, remote_mod.enabled)?;
                toggled_mods.push(remote_mod.name.clone());
            }
        }
        // If mod doesn't exist locally, it's a "missing mod" — tracked but not auto-installed
        // (auto-install of mods is Phase 2, requires download URL tracking)
    }

    // 3. Pull configs
    let configs_updated = sync_pull_configs_inner(user_id, &profile_id, &bepinex_path, &remote_state)?;

    // 4. Find missing mods (remote has but local doesn't)
    let missing_mods: Vec<String> = remote_state.mods.iter()
        .filter(|rm| !local_state.mods.iter().any(|lm| lm.name == rm.name))
        .map(|m| m.name.clone())
        .collect();

    // Update sync settings
    let mut settings = load_sync_settings();
    settings.last_pull = Some(iso_now());
    save_sync_settings(&settings)?;

    let result = SyncPullResult {
        profile_name: remote_state.profile_name,
        toggled_mods,
        configs_updated,
        missing_mods,
        last_updated: remote_state.last_updated,
    };

    app_log(&format!("Sync pull complete: {} toggled, {} configs, {} missing",
        result.toggled_mods.len(), result.configs_updated, result.missing_mods.len()));

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

fn sync_pull_configs_inner(user_id: &str, profile_id: &str, bepinex_path: &str, state: &SyncProfileState) -> Result<u32, String> {
    let config_dir = Path::new(bepinex_path).join("config");
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    let mut updated_count: u32 = 0;

    for cfg_hash in &state.config_hashes {
        let local_path = config_dir.join(&cfg_hash.file_name);
        let local_hash = if local_path.exists() {
            hash_file_contents(&local_path)
        } else {
            String::new()
        };

        if local_hash != cfg_hash.hash {
            let remote_path = sync_config_path(user_id, profile_id, &cfg_hash.file_name);
            match github_get_file(&remote_path) {
                Ok((content, _)) => {
                    fs::write(&local_path, content.as_bytes()).map_err(|e| e.to_string())?;
                    updated_count += 1;
                }
                Err(e) => {
                    app_log(&format!("Sync pull config failed for {}: {}", cfg_hash.file_name, e));
                }
            }
        }
    }

    Ok(updated_count)
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

    // Try direct file
    let from_path = from_dir.join(file_name);
    if from_path.exists() {
        fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
        let to_path = to_dir.join(file_name);
        fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
        app_log(&format!("Sync toggle: {} -> {}", file_name, if enable { "enabled" } else { "disabled" }));
    }
    // Also try folder-based mods (folder name = mod name without .dll)
    let folder_name = file_name.trim_end_matches(".dll").trim_end_matches(".DLL");
    let from_folder = from_dir.join(folder_name);
    if from_folder.is_dir() {
        fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
        let to_folder = to_dir.join(folder_name);
        if !to_folder.exists() {
            fs::rename(&from_folder, &to_folder).map_err(|e| e.to_string())?;
            app_log(&format!("Sync toggle folder: {} -> {}", folder_name, if enable { "enabled" } else { "disabled" }));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Quick-check: has remote state changed since our last pull?
// ---------------------------------------------------------------------------

/// Check if remote state is newer than local (for polling).
#[command]
pub fn sync_check_remote_changed() -> Result<bool, String> {
    let settings = load_sync_settings();
    if !settings.enabled {
        return Ok(false);
    }

    let identity = get_megaload_identity()?;
    let path = sync_manifest_path(&identity.user_id);

    match github_get_file(&path) {
        Ok((content, _)) => {
            if let Ok(manifest) = serde_json::from_str::<SyncManifest>(&content) {
                // If the last sync was from a different machine, there might be changes
                if manifest.machine_id != settings.machine_id {
                    // Compare timestamps
                    if let Some(ref last_pull) = settings.last_pull {
                        Ok(manifest.last_sync > *last_pull)
                    } else {
                        Ok(true) // Never pulled before
                    }
                } else {
                    Ok(false) // Same machine pushed last
                }
            } else {
                Ok(false)
            }
        }
        Err(_) => Ok(false), // No remote manifest = nothing to pull
    }
}
