use crate::commands::app_log::app_log;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

// ── Types ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CheatDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrainerState {
    pub cheats: Vec<CheatEntry>,
    #[serde(default = "default_one")]
    pub speed_multiplier: f32,
    #[serde(default = "default_one")]
    pub jump_multiplier: f32,
}

fn default_one() -> f32 {
    1.0
}

impl Default for TrainerState {
    fn default() -> Self {
        TrainerState {
            cheats: Vec::new(),
            speed_multiplier: 1.0,
            jump_multiplier: 1.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CheatEntry {
    pub id: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedTrainerProfile {
    pub name: String,
    pub cheats: Vec<CheatEntry>,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct TrainerData {
    active: TrainerState,
    saved_profiles: Vec<SavedTrainerProfile>,
}

// ── Cheat Definitions ──────────────────────────────────────

fn all_cheats() -> Vec<CheatDef> {
    vec![
        CheatDef {
            id: "god_mode".into(),
            name: "God Mode".into(),
            description: "Take no damage from any source [Num 0]".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "unlimited_stamina".into(),
            name: "Unlimited Stamina".into(),
            description: "Stamina never depletes [Num 1]".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "unlimited_weight".into(),
            name: "Unlimited Carry Weight".into(),
            description: "Carry any amount without being slowed [Num 2]".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "ghost_mode".into(),
            name: "Ghost Mode".into(),
            description: "Enemies completely ignore you [Num 3]".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "no_skill_drain".into(),
            name: "No Skill Drain".into(),
            description: "Skills don't decrease on death [Num 4]".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "debug_mode".into(),
            name: "Debug/Fly Mode".into(),
            description: "Fly with Z, no-cost crafting, kill with B [Num 5]".into(),
            category: "Creative".into(),
            enabled: false,
        },
        CheatDef {
            id: "no_placement_cost".into(),
            name: "Free Build".into(),
            description: "Build and craft without resources [Num 6]".into(),
            category: "Creative".into(),
            enabled: false,
        },
        CheatDef {
            id: "no_weather_damage".into(),
            name: "No Weather Damage".into(),
            description: "Ignore cold, wet, and freezing [Num 7]".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "instant_kill".into(),
            name: "One-Hit Kill".into(),
            description: "Kill any creature in a single hit [Num 8]".into(),
            category: "Combat".into(),
            enabled: false,
        },
        CheatDef {
            id: "no_durability_loss".into(),
            name: "No Durability Loss".into(),
            description: "Tools and weapons never break [Num 9]".into(),
            category: "Items".into(),
            enabled: false,
        },
        CheatDef {
            id: "explore_map".into(),
            name: "Reveal Entire Map".into(),
            description: "Uncover the entire minimap on toggle".into(),
            category: "World".into(),
            enabled: false,
        },
        CheatDef {
            id: "always_rested".into(),
            name: "Always Rested".into(),
            description: "Permanent rested bonus without comfort".into(),
            category: "Survival".into(),
            enabled: false,
        },
        CheatDef {
            id: "infinite_eitr".into(),
            name: "Infinite Eitr".into(),
            description: "Eitr (magic resource) never depletes".into(),
            category: "Combat".into(),
            enabled: false,
        },
        CheatDef {
            id: "tame_all".into(),
            name: "Instant Tame".into(),
            description: "Tame any nearby creature instantly on toggle".into(),
            category: "World".into(),
            enabled: false,
        },
    ]
}

// ── Storage ────────────────────────────────────────────────

fn trainer_path(bepinex_path: &str) -> PathBuf {
    PathBuf::from(bepinex_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("trainer_state.json")
}

fn load_trainer_data(bepinex_path: &str) -> TrainerData {
    let path = trainer_path(bepinex_path);
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        TrainerData::default()
    }
}

fn save_trainer_data(bepinex_path: &str, data: &TrainerData) {
    let path = trainer_path(bepinex_path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let _ = fs::write(path, json);
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── Auto-deploy ────────────────────────────────────────────

fn ensure_trainer_plugin(app: &AppHandle, bepinex_path: &str) {
    let dest_dir = PathBuf::from(bepinex_path).join("plugins").join("MegaTrainer");
    let dest_dll = dest_dir.join("MegaTrainer.dll");

    // Resolve the bundled resource
    let resource = app
        .path()
        .resolve("resources/MegaTrainer.dll", tauri::path::BaseDirectory::Resource);
    let source = match resource {
        Ok(p) if p.exists() => p,
        _ => return, // Resource not found (dev mode without bundle), skip
    };

    // Only copy if missing or different size (updated version)
    let needs_copy = if dest_dll.exists() {
        let src_len = fs::metadata(&source).map(|m| m.len()).unwrap_or(0);
        let dst_len = fs::metadata(&dest_dll).map(|m| m.len()).unwrap_or(0);
        src_len != dst_len
    } else {
        true
    };

    if needs_copy {
        let _ = fs::create_dir_all(&dest_dir);
        if fs::copy(&source, &dest_dll).is_ok() {
            app_log(&format!(
                "Auto-deployed MegaTrainer.dll to {}",
                dest_dll.display()
            ));
        }
    }
}

// ── Commands ───────────────────────────────────────────────

/// Get all available cheats with their current toggle states.
#[command]
pub fn get_trainer_cheats(app: AppHandle, bepinex_path: String) -> Result<Vec<CheatDef>, String> {
    ensure_trainer_plugin(&app, &bepinex_path);
    let data = load_trainer_data(&bepinex_path);
    let mut cheats = all_cheats();

    // Apply saved states
    for cheat in &mut cheats {
        if let Some(entry) = data.active.cheats.iter().find(|e| e.id == cheat.id) {
            cheat.enabled = entry.enabled;
        }
    }

    Ok(cheats)
}

/// Toggle a cheat on/off and persist the state.
#[command]
pub fn toggle_trainer_cheat(
    bepinex_path: String,
    cheat_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut data = load_trainer_data(&bepinex_path);

    if let Some(entry) = data.active.cheats.iter_mut().find(|e| e.id == cheat_id) {
        entry.enabled = enabled;
    } else {
        data.active.cheats.push(CheatEntry {
            id: cheat_id.clone(),
            enabled,
        });
    }

    save_trainer_data(&bepinex_path, &data);
    let action = if enabled { "ON" } else { "OFF" };
    app_log(&format!("Trainer: {} → {}", cheat_id, action));
    Ok(())
}

/// Save the current cheat state as a named profile.
#[command]
pub fn save_trainer_profile(
    bepinex_path: String,
    name: String,
) -> Result<(), String> {
    let mut data = load_trainer_data(&bepinex_path);

    // Replace if name exists, otherwise add
    if let Some(existing) = data.saved_profiles.iter_mut().find(|p| p.name == name) {
        existing.cheats = data.active.cheats.clone();
        existing.created_at = now_secs();
    } else {
        data.saved_profiles.push(SavedTrainerProfile {
            name: name.clone(),
            cheats: data.active.cheats.clone(),
            created_at: now_secs(),
        });
    }

    save_trainer_data(&bepinex_path, &data);
    app_log(&format!("Trainer: saved profile '{}'", name));
    Ok(())
}

/// Load a saved profile, replacing the active cheat state.
#[command]
pub fn load_trainer_profile(
    app: AppHandle,
    bepinex_path: String,
    name: String,
) -> Result<Vec<CheatDef>, String> {
    let mut data = load_trainer_data(&bepinex_path);

    let profile = data
        .saved_profiles
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| format!("Profile '{}' not found", name))?
        .clone();

    data.active.cheats = profile.cheats;
    save_trainer_data(&bepinex_path, &data);
    app_log(&format!("Trainer: loaded profile '{}'", name));

    // Return updated cheat list
    get_trainer_cheats(app, bepinex_path)
}

/// Delete a saved trainer profile.
#[command]
pub fn delete_trainer_profile(
    bepinex_path: String,
    name: String,
) -> Result<(), String> {
    let mut data = load_trainer_data(&bepinex_path);
    data.saved_profiles.retain(|p| p.name != name);
    save_trainer_data(&bepinex_path, &data);
    app_log(&format!("Trainer: deleted profile '{}'", name));
    Ok(())
}

/// Get all saved trainer profiles.
#[command]
pub fn get_trainer_profiles(
    bepinex_path: String,
) -> Result<Vec<SavedTrainerProfile>, String> {
    let data = load_trainer_data(&bepinex_path);
    Ok(data.saved_profiles)
}

/// Reset all cheats to disabled.
#[command]
pub fn reset_trainer(bepinex_path: String) -> Result<(), String> {
    let mut data = load_trainer_data(&bepinex_path);
    data.active.cheats.clear();
    data.active.speed_multiplier = 1.0;
    data.active.jump_multiplier = 1.0;
    save_trainer_data(&bepinex_path, &data);
    app_log("Trainer: reset all cheats to OFF");
    Ok(())
}

/// Get the current speed/jump multipliers.
#[command]
pub fn get_trainer_multipliers(bepinex_path: String) -> Result<(f32, f32), String> {
    let data = load_trainer_data(&bepinex_path);
    Ok((data.active.speed_multiplier, data.active.jump_multiplier))
}

/// Set a speed or jump multiplier.
#[command]
pub fn set_trainer_multiplier(
    bepinex_path: String,
    kind: String,
    value: f32,
) -> Result<(), String> {
    let clamped = value.clamp(0.1, 10.0);
    let rounded = (clamped * 10.0).round() / 10.0;
    let mut data = load_trainer_data(&bepinex_path);

    match kind.as_str() {
        "speed" => data.active.speed_multiplier = rounded,
        "jump" => data.active.jump_multiplier = rounded,
        _ => return Err(format!("Unknown multiplier kind: {}", kind)),
    }

    save_trainer_data(&bepinex_path, &data);
    app_log(&format!("Trainer: {} → {:.1}x", kind, rounded));
    Ok(())
}
