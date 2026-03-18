use crate::commands::app_log::app_log;
use crate::commands::security::sanitize_path_component;
use crate::models::{Profile, ProfileStore};
use std::fs;
use std::path::PathBuf;
use tauri::command;

fn get_data_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data).join("MegaLoad")
}

fn get_profiles_file() -> PathBuf {
    get_data_dir().join("profiles.json")
}

fn load_profiles() -> ProfileStore {
    let path = get_profiles_file();
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        ProfileStore::default()
    }
}

fn save_profiles(store: &ProfileStore) -> Result<(), String> {
    let dir = get_data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(get_profiles_file(), content).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn get_profiles() -> Result<ProfileStore, String> {
    Ok(load_profiles())
}

#[command]
pub fn create_profile(name: String) -> Result<Profile, String> {
    app_log(&format!("Creating profile: {}", name));
    let mut store = load_profiles();
    let id = format!("{:x}", md5_hash(&name));

    let data_dir = get_data_dir();
    let profile_dir = data_dir.join("profiles").join(&id);
    let bepinex_dir = profile_dir.join("BepInEx");

    // Create profile directory structure
    fs::create_dir_all(bepinex_dir.join("plugins")).map_err(|e| e.to_string())?;
    fs::create_dir_all(bepinex_dir.join("config")).map_err(|e| e.to_string())?;
    fs::create_dir_all(bepinex_dir.join("core")).map_err(|e| e.to_string())?;
    fs::create_dir_all(bepinex_dir.join("plugins").join("_disabled")).map_err(|e| e.to_string())?;

    let now = chrono_now();
    let profile = Profile {
        id: id.clone(),
        name,
        created: now.clone(),
        last_used: now,
        bepinex_path: bepinex_dir.to_string_lossy().to_string(),
    };

    store.profiles.push(profile.clone());
    if store.active_profile.is_none() {
        store.active_profile = Some(id);
    }
    save_profiles(&store)?;

    Ok(profile)
}

#[command]
pub fn delete_profile(id: String) -> Result<(), String> {
    // Validate profile ID to prevent path traversal
    sanitize_path_component(&id)?;

    let store = load_profiles();
    let name = store.profiles.iter().find(|p| p.id == id).map(|p| p.name.clone()).unwrap_or_default();
    app_log(&format!("Deleting profile: {} ({})", name, id));
    let mut store = store;
    store.profiles.retain(|p| p.id != id);
    if store.active_profile.as_deref() == Some(&id) {
        store.active_profile = store.profiles.first().map(|p| p.id.clone());
    }

    // Remove profile directory
    let profile_dir = get_data_dir().join("profiles").join(&id);
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).map_err(|e| e.to_string())?;
    }

    save_profiles(&store)?;
    Ok(())
}

#[command]
pub fn set_active_profile(id: String) -> Result<(), String> {
    let mut store = load_profiles();
    let name = store.profiles.iter().find(|p| p.id == id).map(|p| p.name.clone()).unwrap_or_default();
    app_log(&format!("Switched active profile to: {} ({})", name, id));
    if !store.profiles.iter().any(|p| p.id == id) {
        return Err("Profile not found".to_string());
    }

    // Update last_used
    for p in &mut store.profiles {
        if p.id == id {
            p.last_used = chrono_now();
        }
    }

    store.active_profile = Some(id);
    save_profiles(&store)?;
    Ok(())
}

#[command]
pub fn rename_profile(id: String, new_name: String) -> Result<(), String> {
    app_log(&format!("Renaming profile {} to: {}", id, new_name));
    let mut store = load_profiles();
    for p in &mut store.profiles {
        if p.id == id {
            p.name = new_name;
            break;
        }
    }
    save_profiles(&store)?;
    Ok(())
}

#[command]
pub fn create_profile_linked(name: String, bepinex_path: String) -> Result<Profile, String> {
    app_log(&format!("Creating linked profile: {} -> {}", name, bepinex_path));
    let path = std::path::Path::new(&bepinex_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", bepinex_path));
    }
    // Validate it looks like a BepInEx folder (has plugins/ or core/)
    if !path.join("plugins").exists() && !path.join("core").exists() {
        return Err("This doesn't look like a BepInEx folder (no plugins/ or core/ subdirectory)".to_string());
    }

    let mut store = load_profiles();
    let id = format!("{:x}", md5_hash(&format!("{}_{}", name, bepinex_path)));

    let now = chrono_now();
    let profile = Profile {
        id: id.clone(),
        name,
        created: now.clone(),
        last_used: now,
        bepinex_path,
    };

    store.profiles.push(profile.clone());
    if store.active_profile.is_none() {
        store.active_profile = Some(id);
    }
    save_profiles(&store)?;

    Ok(profile)
}

#[command]
pub fn get_profile_path(id: String) -> Result<String, String> {
    let store = load_profiles();
    store
        .profiles
        .iter()
        .find(|p| p.id == id)
        .map(|p| p.bepinex_path.clone())
        .ok_or_else(|| "Profile not found".to_string())
}

fn md5_hash(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}
