use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub created: String,
    pub last_used: String,
    pub bepinex_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileStore {
    pub active_profile: Option<String>,
    pub profiles: Vec<Profile>,
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self {
            active_profile: None,
            profiles: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModInfo {
    pub name: String,
    pub file_name: String,
    pub folder: String,
    pub enabled: bool,
    pub version: Option<String>,
    pub guid: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub default_value: Option<String>,
    pub description: Option<String>,
    pub value_type: Option<String>,
    pub acceptable_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSection {
    pub name: String,
    pub entries: Vec<ConfigEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFile {
    pub file_name: String,
    pub mod_name: String,
    pub path: String,
    pub sections: Vec<ConfigSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct AppSettings {
    pub valheim_path: String,
    pub data_path: String,
    pub r2modman_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Cloud Sync models
// ---------------------------------------------------------------------------

/// Master sync manifest stored at sync/{user_id}/sync-manifest.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
    pub user_id: String,
    pub last_sync: String,
    pub machine_id: String,
    pub profiles: Vec<SyncProfileEntry>,
}

/// Profile entry in the sync manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProfileEntry {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub is_linked: bool,
}

/// Full profile state stored at sync/{user_id}/profiles/{profile_id}/state.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProfileState {
    pub profile_id: String,
    pub profile_name: String,
    pub last_updated: String,
    pub mods: Vec<SyncModEntry>,
    pub thunderstore_mods: Vec<SyncThunderstoreMod>,
    pub config_hashes: Vec<SyncConfigHash>,
}

/// A mod entry in the sync state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncModEntry {
    pub name: String,
    pub file_name: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub source: String, // "megaload" | "thunderstore" | "manual"
}

/// A Thunderstore mod in the sync state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncThunderstoreMod {
    pub full_name: String,
    pub version: String,
    pub folder_name: String,
}

/// Config file hash for change detection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfigHash {
    pub file_name: String,
    pub hash: String,
}

/// Sync status returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub enabled: bool,
    pub last_push: Option<String>,
    pub last_pull: Option<String>,
    pub syncing: bool,
    pub error: Option<String>,
    pub remote_profiles: Vec<SyncProfileEntry>,
}

/// Sync settings persisted locally
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSettings {
    pub enabled: bool,
    pub auto_sync: bool,
    pub last_push: Option<String>,
    pub last_pull: Option<String>,
    pub machine_id: String,
}
