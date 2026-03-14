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
