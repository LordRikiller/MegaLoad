use crate::commands::app_log::app_log;
use notify::{Config as NotifyConfig, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, Emitter, State};

pub struct PlayerDataWatcherState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

#[command(async)]
pub fn start_player_data_watcher(
    app: AppHandle,
    state: State<'_, PlayerDataWatcherState>,
) -> Result<(), String> {
    let dirs = find_character_dirs();
    if dirs.is_empty() {
        return Ok(());
    }

    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    // Drop existing watcher before creating new one
    *guard = None;

    let last_emit = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10)));
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let is_fch = event
                    .paths
                    .iter()
                    .any(|p| {
                        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        name.ends_with(".fch") || name.ends_with(".fch.old")
                    });
                if !is_fch {
                    return;
                }
                // Debounce: skip if emitted < 2s ago (Valheim writes multiple times per save)
                if let Ok(mut last) = last_emit.lock() {
                    if last.elapsed() < Duration::from_secs(2) {
                        return;
                    }
                    *last = Instant::now();
                }
                let _ = app_handle.emit("player-data-changed", "");
            }
        },
        NotifyConfig::default(),
    )
    .map_err(|e| format!("Failed to create player data watcher: {}", e))?;

    for dir in &dirs {
        if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
            app_log(&format!("Warning: failed to watch {:?}: {}", dir, e));
        }
    }

    *guard = Some(watcher);
    app_log(&format!("Player data watcher started on {} directories", dirs.len()));
    Ok(())
}

#[command(async)]
pub fn stop_player_data_watcher(state: State<'_, PlayerDataWatcherState>) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

// ── Binary Reader ──────────────────────────────────────────
// Handles C# BinaryWriter format used by Valheim's ZPackage

struct BinReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> BinReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        if self.pos + 4 > self.data.len() {
            return Err(format!("EOF reading i32 at offset {}", self.pos));
        }
        let v = i32::from_le_bytes([
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }

    fn read_i64(&mut self) -> Result<i64, String> {
        if self.pos + 8 > self.data.len() {
            return Err(format!("EOF reading i64 at offset {}", self.pos));
        }
        let v = i64::from_le_bytes([
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
            self.data[self.pos + 4],
            self.data[self.pos + 5],
            self.data[self.pos + 6],
            self.data[self.pos + 7],
        ]);
        self.pos += 8;
        Ok(v)
    }

    fn read_f32(&mut self) -> Result<f32, String> {
        if self.pos + 4 > self.data.len() {
            return Err(format!("EOF reading f32 at offset {}", self.pos));
        }
        let v = f32::from_le_bytes([
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        if self.pos >= self.data.len() {
            return Err(format!("EOF reading byte at offset {}", self.pos));
        }
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn read_u16(&mut self) -> Result<u16, String> {
        if self.pos + 2 > self.data.len() {
            return Err(format!("EOF reading u16 at offset {}", self.pos));
        }
        let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    /// ZPackage.ReadNumItems — one byte, or a two-byte big-endian value when the
    /// high bit is set. Used for the per-item custom-data count in Valheim 1.0.
    fn read_num_items(&mut self) -> Result<i32, String> {
        let b = self.read_u8()?;
        if b & 128 != 0 {
            let lo = self.read_u8()?;
            Ok(((((b & 127) as i32) << 8) | lo as i32) as i32)
        } else {
            Ok(b as i32)
        }
    }

    fn read_bool(&mut self) -> Result<bool, String> {
        if self.pos >= self.data.len() {
            return Err(format!("EOF reading bool at offset {}", self.pos));
        }
        let v = self.data[self.pos] != 0;
        self.pos += 1;
        Ok(v)
    }

    /// Read a C# 7-bit encoded integer (used for string length prefix)
    fn read_7bit_int(&mut self) -> Result<i32, String> {
        let mut result: i32 = 0;
        let mut shift = 0;
        loop {
            if self.pos >= self.data.len() {
                return Err(format!("EOF reading 7bit int at offset {}", self.pos));
            }
            let byte = self.data[self.pos];
            self.pos += 1;
            result |= ((byte & 0x7F) as i32) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 35 {
                return Err("Bad 7-bit encoded int".to_string());
            }
        }
        Ok(result)
    }

    /// Read a C# BinaryWriter string (7-bit length prefix + UTF-8 bytes)
    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_7bit_int()? as usize;
        if self.pos + len > self.data.len() {
            return Err(format!(
                "EOF reading string of len {} at offset {}",
                len, self.pos
            ));
        }
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + len]).to_string();
        self.pos += len;
        Ok(s)
    }

    /// Read a length-prefixed byte array (int32 length + raw bytes)
    fn read_byte_array(&mut self) -> Result<Vec<u8>, String> {
        let len = self.read_i32()? as usize;
        if self.pos + len > self.data.len() {
            return Err(format!(
                "EOF reading byte array of len {} at offset {}",
                len, self.pos
            ));
        }
        let arr = self.data[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(arr)
    }

    /// Read Vector3 (3 x f32)
    fn read_vector3(&mut self) -> Result<[f32; 3], String> {
        Ok([self.read_f32()?, self.read_f32()?, self.read_f32()?])
    }

    /// Skip N bytes
    fn skip(&mut self, n: usize) -> Result<(), String> {
        if self.pos + n > self.data.len() {
            return Err(format!("EOF skipping {} bytes at offset {}", n, self.pos));
        }
        self.pos += n;
        Ok(())
    }
}

// ── Data Types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CharacterSummary {
    pub name: String,
    pub path: String,
    pub modified: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterData {
    pub name: String,
    pub version: i32,
    pub kills: i32,
    pub deaths: i32,
    pub crafts: i32,
    pub builds: i32,
    pub boss_kills: i32,
    pub player_id: i64,
    pub guardian_power: String,
    pub max_hp: f32,
    pub hp: f32,
    pub stamina: f32,
    pub max_eitr: f32,
    pub model: i32,
    pub beard: String,
    pub hair: String,
    pub skin_color: [f32; 3],
    pub hair_color: [f32; 3],
    pub known_biomes: Vec<String>,
    pub skills: Vec<SkillData>,
    pub inventory: Vec<InventoryItem>,
    pub known_recipes: Vec<String>,
    pub known_stations: Vec<StationKnowledge>,
    pub known_materials: Vec<String>,
    pub trophies: Vec<String>,
    pub uniques: Vec<String>,
    pub active_foods: Vec<FoodData>,
    pub known_texts: Vec<KnownText>,
    pub world_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillData {
    pub id: i32,
    pub name: String,
    pub level: f32,
    pub accumulator: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryItem {
    pub name: String,
    pub stack: i32,
    pub durability: f32,
    pub grid_x: i32,
    pub grid_y: i32,
    pub equipped: bool,
    pub quality: i32,
    pub variant: i32,
    pub crafter_name: String,
    pub world_level: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationKnowledge {
    pub name: String,
    pub level: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoodData {
    pub name: String,
    pub time: f32,
    pub health: f32,
    pub stamina: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownText {
    pub key: String,
    pub value: String,
}

// ── Skill & Biome Name Lookups ─────────────────────────────

/// Valheim's `StringExtensionMethods.GetStableHashCode` — the hash an item's
/// prefab name is stored under from inventory format 108 onwards.
fn stable_hash_code(s: &str) -> i32 {
    let chars: Vec<char> = s.chars().collect();
    let mut hash1: i32 = 5381;
    let mut hash2: i32 = 5381;
    let mut i = 0usize;
    while i < chars.len() && chars[i] != '\0' {
        hash1 = ((hash1 << 5).wrapping_add(hash1)) ^ (chars[i] as i32);
        if i == chars.len() - 1 || chars[i + 1] == '\0' {
            break;
        }
        hash2 = ((hash2 << 5).wrapping_add(hash2)) ^ (chars[i + 1] as i32);
        i += 2;
    }
    hash1.wrapping_add(hash2.wrapping_mul(1566083941))
}

/// Reverse map built once from the generated prefab name table.
fn prefab_name_for_hash(hash: i32) -> Option<&'static str> {
    use std::collections::HashMap;
    use std::sync::OnceLock;
    static MAP: OnceLock<HashMap<i32, &'static str>> = OnceLock::new();
    MAP.get_or_init(|| {
        super::prefab_names::PREFAB_NAMES
            .iter()
            .map(|n| (stable_hash_code(n), *n))
            .collect()
    })
    .get(&hash)
    .copied()
}

fn skill_name(id: i32) -> &'static str {
    match id {
        1 => "Swords",
        2 => "Knives",
        3 => "Clubs",
        4 => "Polearms",
        5 => "Spears",
        6 => "Blocking",
        7 => "Axes",
        8 => "Bows",
        9 => "Elemental Magic",
        10 => "Blood Magic",
        11 => "Unarmed",
        12 => "Pickaxes",
        13 => "Wood Cutting",
        14 => "Crossbows",
        100 => "Jump",
        101 => "Sneak",
        102 => "Run",
        103 => "Swim",
        104 => "Fishing",
        105 => "Cooking",
        106 => "Farming",
        107 => "Crafting",
        108 => "Dodge",
        110 => "Ride",
        _ => "Unknown",
    }
}

fn biome_name(id: i32) -> &'static str {
    match id {
        1 => "Meadows",
        2 => "Swamp",
        4 => "Mountain",
        8 => "Black Forest",
        16 => "Plains",
        32 => "Ashlands",
        64 => "Deep North",
        256 => "Ocean",
        512 => "Mistlands",
        _ => "Unknown Biome",
    }
}

// ── Characters Directories ─────────────────────────────────
// Valheim stores characters in multiple locations:
// 1. Steam Cloud: Steam\userdata\<uid>\892970\remote\characters\ (primary, current saves)
// 2. Local: AppData\LocalLow\IronGate\Valheim\characters\ (old local saves)
// 3. Local new: AppData\LocalLow\IronGate\Valheim\characters_local\ (if cloud disabled)

pub fn find_character_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // Steam Cloud — scan all Steam user IDs for Valheim (892970)
    let steam_base = PathBuf::from(r"C:\Program Files (x86)\Steam\userdata");
    if steam_base.exists() {
        if let Ok(entries) = fs::read_dir(&steam_base) {
            for entry in entries.flatten() {
                let chars_path = entry.path().join(r"892970\remote\characters");
                if chars_path.exists() {
                    dirs.push(chars_path);
                }
            }
        }
    }

    // Local paths
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let local =
            PathBuf::from(&user_profile).join(r"AppData\LocalLow\IronGate\Valheim\characters_local");
        if local.exists() {
            dirs.push(local);
        }

        let legacy =
            PathBuf::from(&user_profile).join(r"AppData\LocalLow\IronGate\Valheim\characters");
        if legacy.exists() {
            dirs.push(legacy);
        }
    }

    dirs
}

/// Resolve the primary .fch file path for a given character name.
/// Case-insensitive name match. Prefers `.fch` over `.fch.old` and
/// Steam Cloud over local dirs (matching `find_character_dirs` order).
pub fn find_fch_path_for_name(name: &str) -> Option<PathBuf> {
    let target = name.trim().to_lowercase();
    let dirs = find_character_dirs();
    let mut candidate_old: Option<PathBuf> = None;

    for dir in &dirs {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            if fname.contains("_backup_") { continue; }

            if let Some(stem) = fname.strip_suffix(".fch") {
                if stem.to_lowercase() == target {
                    return Some(path);
                }
            } else if let Some(stem) = fname.strip_suffix(".fch.old") {
                if stem.to_lowercase() == target && candidate_old.is_none() {
                    candidate_old = Some(path);
                }
            }
        }
    }
    candidate_old
}

/// Preferred directory for writing a new .fch file when syncing a
/// character that doesn't exist locally yet. Picks the first directory
/// returned by `find_character_dirs` (Steam Cloud first when present).
pub fn get_primary_character_dir() -> Option<PathBuf> {
    find_character_dirs().into_iter().next()
}

/// Read a character file into raw bytes + its last-modified time (seconds since epoch).
pub fn read_fch_with_mtime(path: &std::path::Path) -> Result<(Vec<u8>, u64), String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let meta = fs::metadata(path).map_err(|e| format!("Failed to stat {}: {}", path.display(), e))?;
    let mtime = meta
        .modified()
        .map_err(|e| format!("No mtime: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Pre-epoch mtime: {}", e))?
        .as_secs();
    Ok((bytes, mtime))
}

/// Write raw bytes to a .fch file and set its mtime. Creates parent dir if needed.
pub fn write_fch_with_mtime(path: &std::path::Path, bytes: &[u8], mtime_secs: u64) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    fs::write(path, bytes).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    // Set mtime so future sync cycles see the remote timestamp (avoids re-pushing what we just pulled).
    let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(mtime_secs);
    filetime::set_file_mtime(path, filetime::FileTime::from_system_time(when))
        .map_err(|e| format!("Failed to set mtime on {}: {}", path.display(), e))?;
    Ok(())
}

// ── List Characters ────────────────────────────────────────

#[command(async)]
pub fn list_characters() -> Result<Vec<CharacterSummary>, String> {
    let dirs = find_character_dirs();
    if dirs.is_empty() {
        return Err("No Valheim character directories found".to_string());
    }

    let mut characters: Vec<CharacterSummary> = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Collect all .fch and .fch.old files from all directories
    // Earlier directories (Steam Cloud) take priority over later ones (local)
    let mut files: Vec<(String, PathBuf, bool)> = Vec::new(); // (name, path, is_primary)

    for dir in &dirs {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let fname = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if fname.ends_with(".fch") && !fname.contains("_backup_") {
                let name = fname.trim_end_matches(".fch").to_string();
                files.push((name, path, true));
            } else if fname.ends_with(".fch.old") && !fname.contains("_backup_") {
                let name = fname.trim_end_matches(".fch.old").to_string();
                files.push((name, path, false));
            }
        }
    }

    // Prefer .fch over .fch.old for the same name
    // Sort: primary files first
    files.sort_by(|a, b| b.2.cmp(&a.2));

    for (name, path, _is_primary) in files {
        if seen_names.contains(&name) {
            continue;
        }
        seen_names.insert(name.clone());

        let metadata = fs::metadata(&path)
            .map_err(|e| format!("Failed to read metadata for {}: {}", path.display(), e))?;

        let modified = metadata
            .modified()
            .map(|t| {
                let duration = t
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default();
                // ISO 8601 approximate — good enough for display
                let secs = duration.as_secs();
                format!("{}", secs)
            })
            .unwrap_or_default();

        characters.push(CharacterSummary {
            name: capitalise_name(&name),
            path: path.to_string_lossy().to_string(),
            modified,
            size: metadata.len(),
        });
    }

    // Sort by modified time descending (most recent first)
    characters.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(characters)
}

fn capitalise_name(name: &str) -> String {
    name.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(c) => {
                    let upper: String = c.to_uppercase().collect();
                    upper + &chars.as_str().to_lowercase()
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Read Character ─────────────────────────────────────────

#[command(async)]
pub fn read_character(path: String) -> Result<CharacterData, String> {
    let file_data = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    parse_character_file(&file_data)
}

/// Read the real-game character portrait PNG captured by MegaDataExtractor
/// 1.4.3+ off FejdStartup's live character-select preview. Returns base64 so
/// the frontend can slap it straight into an <img src="data:image/png;base64,...">.
/// Returns None if no portrait has been captured yet.
#[command(async)]
pub fn get_character_portrait_png(name: String) -> Option<String> {
    use base64::Engine;
    let sanitised = sanitise_portrait_name(&name);
    if sanitised.is_empty() { return None; }
    let appdata = std::env::var("APPDATA").ok()?;
    let path = PathBuf::from(appdata)
        .join("MegaLoad")
        .join("character-portraits")
        .join(format!("{}.png", sanitised));
    let bytes = fs::read(&path).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn sanitise_portrait_name(s: &str) -> String {
    // Match the .NET extractor's `char.IsLetterOrDigit` — accepts Unicode
    // letters and digits (e.g. "Knútr" stays "Knútr"), replaces anything else
    // with underscore. Stays in sync with SanitiseFileName in
    // MegaDataExtractorPlugin.cs so the frontend's lookup matches on disk.
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_alphanumeric() { out.push(c); } else { out.push('_'); }
    }
    if out.is_empty() { "unknown".to_string() } else { out }
}

fn parse_character_file(file_data: &[u8]) -> Result<CharacterData, String> {
    let mut outer = BinReader::new(file_data);

    // Outer wrapper: int32 data_length + data + int32 hash_length + hash
    let data_len = outer.read_i32()? as usize;
    if outer.pos + data_len > outer.data.len() {
        return Err("Data length exceeds file size".to_string());
    }
    let data_blob = &outer.data[outer.pos..outer.pos + data_len];

    // Parse character data blob
    let mut r = BinReader::new(data_blob);

    let version = r.read_i32()?;

    // Stats — format changed in v38, then again in Valheim 1.0.
    let (kills, deaths, crafts, builds, boss_kills) = if has_grouped_stats(version) {
        // v44/v46+: stats are no longer one flat array. The file now holds
        // `entry_count` parallel stat blocks (10 in practice — the game tracks
        // several scopes side by side), each carrying its own float array AND
        // its own copies of the dictionaries that used to live further down the
        // file. Entry 0 is the lifetime aggregate, which is what the old flat
        // array was and what the game itself still reads as m_playerStats[0].
        let stats_per_entry = r.read_i32()?;
        let entry_count = r.read_i32()?;
        if !(0..=10_000).contains(&stats_per_entry) || !(0..=10_000).contains(&entry_count) {
            return Err(format!(
                "Implausible stat block: {} stats x {} entries",
                stats_per_entry, entry_count
            ));
        }

        let mut first: Vec<f32> = Vec::new();
        for entry in 0..entry_count {
            let mut stats = vec![0.0f32; stats_per_entry as usize];
            for slot in stats.iter_mut() {
                *slot = r.read_f32()?;
            }
            if entry == 0 {
                first = stats;
            }

            // knownWorlds / knownWorldKeys / knownCommands
            for _ in 0..3 {
                skip_string_float_dict(&mut r)?;
            }
            // enemyStats became an ARRAY of dictionaries (one per enemy tier).
            let enemy_dicts = r.read_i32()?;
            if !(0..=100_000).contains(&enemy_dicts) {
                return Err(format!("Implausible enemy stat count {}", enemy_dicts));
            }
            for _ in 0..enemy_dicts {
                skip_string_float_dict(&mut r)?;
            }
            // itemPickup, itemCraft, and 1.0's new pickable / foodEaten /
            // piecesPlaced dictionaries.
            for _ in 0..5 {
                skip_string_float_dict(&mut r)?;
            }
        }
        summarise_stats(&first, version)
    } else if version >= 38 {
        // v38-43: stat_count (int32) + stat_count x float
        let stat_count = r.read_i32()?;
        if !(0..=10_000).contains(&stat_count) {
            return Err(format!("Implausible stat count {}", stat_count));
        }
        let mut stats = vec![0.0f32; stat_count as usize];
        for slot in stats.iter_mut() {
            *slot = r.read_f32()?;
        }
        summarise_stats(&stats, version)
    } else if version >= 28 {
        // v28-37: individual int32 fields
        let kills = r.read_i32()?;
        let deaths = r.read_i32()?;
        let crafts = r.read_i32()?;
        let builds = r.read_i32()?;
        (kills, deaths, crafts, builds, 0)
    } else {
        (0, 0, 0, 0, 0)
    };

    // v40+: firstSpawn flag
    if version >= 40 {
        let _first_spawn = r.read_bool()?;
    }

    // World data
    let world_count = r.read_i32()?;
    for _ in 0..world_count {
        skip_world_data(&mut r, version)?;
    }

    // Player identity
    let player_name = r.read_string()?;
    let player_id = r.read_i64()?;
    let _start_seed = r.read_string()?;

    // v38+: additional metadata
    if version >= 38 {
        let _used_cheats = r.read_bool()?;
        let _date_created = r.read_i64()?;

        // On 1.0 files every dictionary below was already read as part of the
        // per-entry stat blocks above, so the game skips this whole section.
        if !has_grouped_stats(version) {

        // knownWorlds: Dict<string, float>
        let kw_count = r.read_i32()?;
        for _ in 0..kw_count {
            r.read_string()?;
            r.read_f32()?;
        }

        // knownWorldKeys: Dict<string, float>
        let kwk_count = r.read_i32()?;
        for _ in 0..kwk_count {
            r.read_string()?;
            r.read_f32()?;
        }

        // knownCommands: Dict<string, float>
        let kc_count = r.read_i32()?;
        for _ in 0..kc_count {
            r.read_string()?;
            r.read_f32()?;
        }

        // v42+: enemy stats, item pickup stats, item craft stats
        if version >= 42 {
            // enemyStats
            let es_count = r.read_i32()?;
            for _ in 0..es_count {
                r.read_string()?;
                r.read_f32()?;
            }
            // itemPickupStats
            let ip_count = r.read_i32()?;
            for _ in 0..ip_count {
                r.read_string()?;
                r.read_f32()?;
            }
            // itemCraftStats
            let ic_count = r.read_i32()?;
            for _ in 0..ic_count {
                r.read_string()?;
                r.read_f32()?;
            }
        }

        } // !has_grouped_stats
    }

    // Player data blob (bool flag + length-prefixed byte array)
    let has_player_data = r.read_bool()?;
    if !has_player_data {
        return Ok(CharacterData {
            name: player_name,
            version,
            kills,
            deaths,
            crafts,
            builds,
            boss_kills,
            player_id,
            guardian_power: String::new(),
            max_hp: 25.0,
            hp: 25.0,
            stamina: 50.0,
            max_eitr: 0.0,
            model: 0,
            beard: String::new(),
            hair: String::new(),
            skin_color: [1.0, 1.0, 1.0],
            hair_color: [0.5, 0.5, 0.5],
            known_biomes: Vec::new(),
            skills: Vec::new(),
            inventory: Vec::new(),
            known_recipes: Vec::new(),
            known_stations: Vec::new(),
            known_materials: Vec::new(),
            trophies: Vec::new(),
            uniques: Vec::new(),
            active_foods: Vec::new(),
            known_texts: Vec::new(),
            world_count,
        });
    }

    let player_blob = r.read_byte_array()?;

    // Parse inner player data
    let pd = parse_player_data(&player_blob, &player_name)?;

    Ok(CharacterData {
        name: player_name,
        version,
        kills,
        deaths,
        crafts,
        builds,
        boss_kills,
        player_id,
        world_count,
        ..pd
    })
}

/// Valheim 1.0 regrouped the character-file stat section. The game gates it on
/// exactly this condition (`version >= 46 || version == 44`) — 45 is deliberately
/// excluded, so don't simplify it to a `>=`.
fn has_grouped_stats(version: i32) -> bool {
    version >= 46 || version == 44
}

fn skip_string_float_dict(r: &mut BinReader) -> Result<(), String> {
    let count = r.read_i32()?;
    if !(0..=2_000_000).contains(&count) {
        return Err(format!(
            "Implausible dictionary count {} at offset {}",
            count, r.pos
        ));
    }
    for _ in 0..count {
        r.read_string()?;
        r.read_f32()?;
    }
    Ok(())
}

/// Pull the handful of headline numbers out of a PlayerStatType float array.
///
/// The enum shifted in 1.0: `BossKills` moved from 86 to 85 (86 is now
/// `BossLastHits`), and the array grew from 105 entries to 205. Deaths,
/// CraftsOrUpgrades, Builds and EnemyKills kept their slots.
fn summarise_stats(stats: &[f32], version: i32) -> (i32, i32, i32, i32, i32) {
    let boss_slot = if has_grouped_stats(version) { 85 } else { 86 };
    let at = |i: usize| stats.get(i).copied().unwrap_or(0.0) as i32;
    (at(6), at(0), at(1), at(2), at(boss_slot))
}

fn skip_world_data(r: &mut BinReader, version: i32) -> Result<(), String> {
    let _world_uid = r.read_i64()?;
    let _has_custom_spawn = r.read_bool()?;
    r.read_vector3()?; // spawn point
    let _has_logout = r.read_bool()?;
    r.read_vector3()?; // logout point

    // v30+: death point
    if version >= 30 {
        let _has_death = r.read_bool()?;
        r.read_vector3()?; // death point
    }

    r.read_vector3()?; // home point

    // v29+: map data
    if version >= 29 {
        let has_map_data = r.read_bool()?;
        if has_map_data {
            let map_len = r.read_i32()? as usize;
            r.skip(map_len)?;
        }
    }

    Ok(())
}

fn parse_player_data(blob: &[u8], name: &str) -> Result<CharacterData, String> {
    let mut r = BinReader::new(blob);

    let pv = r.read_i32()?; // player data version (current: 29)

    // Core stats
    let max_hp = if pv >= 7 { r.read_f32()? } else { 25.0 };
    let hp = r.read_f32()?;
    let max_stamina = if pv >= 10 { r.read_f32()? } else { 50.0 };

    // firstSpawn only in v8-27 (moved to outer wrapper in v28+)
    if pv >= 8 && pv < 28 {
        let _first_spawn = r.read_bool()?;
    }

    let _timer_since_death = if pv >= 20 { r.read_f32()? } else { 0.0 };

    let guardian_power = if pv >= 23 {
        r.read_string()?
    } else {
        String::new()
    };
    let _gp_cooldown = if pv >= 24 { r.read_f32()? } else { 0.0 };

    // ZDOID skip for exactly v2
    if pv == 2 {
        r.skip(12)?; // ZDOID = long + uint
    }

    // Inventory
    let inventory = parse_inventory(&mut r)?;

    // Known recipes
    let recipe_count = r.read_i32()?;
    let mut known_recipes = Vec::with_capacity(recipe_count as usize);
    for _ in 0..recipe_count {
        known_recipes.push(r.read_string()?);
    }

    // Known stations (format differs by version)
    let known_stations = if pv >= 15 {
        let count = r.read_i32()?;
        let mut stations = Vec::with_capacity(count as usize);
        for _ in 0..count {
            stations.push(StationKnowledge {
                name: r.read_string()?,
                level: r.read_i32()?,
            });
        }
        stations
    } else {
        // v < 15: just string list (no level)
        let count = r.read_i32()?;
        let mut stations = Vec::with_capacity(count as usize);
        for _ in 0..count {
            stations.push(StationKnowledge {
                name: r.read_string()?,
                level: 1,
            });
        }
        stations
    };

    // Known materials (always present)
    let mat_count = r.read_i32()?;
    let mut known_materials = Vec::with_capacity(mat_count as usize);
    for _ in 0..mat_count {
        known_materials.push(r.read_string()?);
    }

    // Tutorials (present in v < 19 or v >= 21, skipped in v19-20)
    if pv < 19 || pv >= 21 {
        let count = r.read_i32()?;
        for _ in 0..count {
            r.read_string()?;
        }
    }

    // Uniques (v6+)
    let uniques = if pv >= 6 {
        read_string_list(&mut r)?
    } else {
        Vec::new()
    };

    // Trophies (v9+)
    let trophies = if pv >= 9 {
        read_string_list(&mut r)?
    } else {
        Vec::new()
    };

    // Known biomes. Valheim 1.0 writes the biome NAME; before that it was the
    // Heightmap.Biome bit value, which had to be looked up. Same gate the game
    // uses (v31, then v33+) — v32 kept the old form.
    let known_biomes = if pv >= 33 || pv == 31 {
        let count = r.read_i32()?;
        if !(0..=10_000).contains(&count) {
            return Err(format!("Implausible biome count {}", count));
        }
        let mut biomes = Vec::with_capacity(count as usize);
        for _ in 0..count {
            biomes.push(r.read_string()?);
        }
        biomes
    } else if pv >= 18 {
        let count = r.read_i32()?;
        if !(0..=10_000).contains(&count) {
            return Err(format!("Implausible biome count {}", count));
        }
        let mut biomes = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let id = r.read_i32()?;
            biomes.push(biome_name(id).to_string());
        }
        biomes
    } else {
        Vec::new()
    };

    // Known texts (v22+)
    let known_texts = if pv >= 22 {
        let count = r.read_i32()?;
        let mut texts = Vec::with_capacity(count as usize);
        for _ in 0..count {
            texts.push(KnownText {
                key: r.read_string()?,
                value: r.read_string()?,
            });
        }
        texts
    } else {
        Vec::new()
    };

    // Appearance
    let beard = if pv >= 4 { r.read_string()? } else { String::new() };
    let hair = if pv >= 4 { r.read_string()? } else { String::new() };
    let skin_color = if pv >= 5 {
        r.read_vector3()?
    } else {
        [1.0, 1.0, 1.0]
    };
    let hair_color = if pv >= 5 {
        r.read_vector3()?
    } else {
        [0.5, 0.5, 0.5]
    };
    let model = if pv >= 11 { r.read_i32()? } else { 0 };

    // Foods (v12+)
    let active_foods = if pv >= 12 {
        parse_foods(&mut r, pv)?
    } else {
        Vec::new()
    };

    // Skills (v17+)
    let skills = if pv >= 17 {
        parse_skills(&mut r)?
    } else {
        Vec::new()
    };

    // v26+: custom data dict + current stamina + max eitr + current eitr
    let (stamina, max_eitr) = if pv >= 26 {
        let cd_count = r.read_i32()?;
        for _ in 0..cd_count {
            r.read_string()?;
            r.read_string()?;
        }
        let stamina = r.read_f32()?;
        let max_eitr = r.read_f32()?;
        let _eitr = r.read_f32()?;
        (stamina, max_eitr)
    } else {
        (max_stamina, 0.0)
    };

    // v31 / v33+ end with the build-menu layout as an opaque byte array. Nothing
    // here needs it, but read it so the parse consumes the blob exactly — a
    // trailing surplus is the first sign the format has moved again.
    if pv >= 33 || pv == 31 {
        let _build_ui = r.read_byte_array()?;
    }

    Ok(CharacterData {
        name: name.to_string(),
        version: pv,
        kills: 0,
        deaths: 0,
        crafts: 0,
        builds: 0,
        boss_kills: 0,
        player_id: 0,
        guardian_power,
        max_hp,
        hp,
        stamina,
        max_eitr,
        model,
        beard,
        hair,
        skin_color,
        hair_color,
        known_biomes,
        skills,
        inventory,
        known_recipes,
        known_stations,
        known_materials,
        trophies,
        uniques,
        active_foods,
        known_texts,
        world_count: 0,
    })
}

fn parse_inventory(r: &mut BinReader) -> Result<Vec<InventoryItem>, String> {
    let inv_version = r.read_i32()?;
    if inv_version >= 108 {
        return parse_inventory_1_0(r, inv_version);
    }
    let count = r.read_i32()?;
    if !(0..=100_000).contains(&count) {
        return Err(format!("Implausible inventory count {}", count));
    }
    let mut items = Vec::with_capacity(count as usize);

    for _ in 0..count {
        let name = r.read_string()?;
        let stack = r.read_i32()?;
        let durability = r.read_f32()?;
        let grid_x = r.read_i32()?; // Vector2i.x
        let grid_y = r.read_i32()?; // Vector2i.y
        let equipped = r.read_bool()?;

        let quality = if inv_version >= 101 {
            r.read_i32()?
        } else {
            1
        };
        let variant = if inv_version >= 102 {
            r.read_i32()?
        } else {
            0
        };
        let _crafter_id = if inv_version >= 103 {
            r.read_i64()?
        } else {
            0
        };
        let crafter_name = if inv_version >= 103 {
            r.read_string()?
        } else {
            String::new()
        };

        // Custom data dictionary (version >= 104)
        if inv_version >= 104 {
            let cd_count = r.read_i32()?;
            for _ in 0..cd_count {
                r.read_string()?; // key
                r.read_string()?; // value
            }
        }

        let world_level = if inv_version >= 105 {
            r.read_i32()?
        } else {
            0
        };

        // pickedUp flag (version >= 106)
        if inv_version >= 106 {
            let _picked_up = r.read_bool()?;
        }

        items.push(InventoryItem {
            name,
            stack,
            durability,
            grid_x,
            grid_y,
            equipped,
            quality,
            variant,
            crafter_name,
            world_level,
        });
    }

    Ok(items)
}

/// Inventory format 108+ (Valheim 1.0).
///
/// Two things changed and both are easy to miss. The item count is now a
/// **ushort**, not an int32. And an item no longer stores its prefab *name* —
/// it stores the stable hash of that name, and only writes the optional fields
/// a flags byte says are present, so the record is variable-length. Get the
/// flag order wrong and everything after it is garbage.
fn parse_inventory_1_0(r: &mut BinReader, inv_version: i32) -> Result<Vec<InventoryItem>, String> {
    let count = r.read_u16()? as usize;
    let mut items = Vec::with_capacity(count);

    for _ in 0..count {
        // Durability is stored as hundredths in an int32.
        let durability = r.read_i32()? as f32 * 0.01;
        let grid_x = r.read_u8()? as i32;
        let grid_y = r.read_u8()? as i32;
        let world_level = r.read_u8()? as i32;

        let flags = r.read_u8()?;
        let _picked_up = flags & 1 != 0;
        let equipped = flags & 2 != 0;
        let quality = if flags & 4 != 0 { r.read_u16()? as i32 } else { 1 };
        let stack = if flags & 8 != 0 { r.read_u16()? as i32 } else { 1 };
        let variant = if flags & 16 != 0 { r.read_i32()? } else { 0 };
        // crafterID and crafterName share the one flag.
        let crafter_name = if flags & 32 != 0 {
            let _crafter_id = r.read_i64()?;
            r.read_string()?
        } else {
            String::new()
        };
        let prefab_hash = if flags & 64 != 0 { r.read_i32()? } else { 0 };
        let custom_data = if flags & 128 != 0 { r.read_num_items()? } else { 0 };
        if !(0..=100_000).contains(&custom_data) {
            return Err(format!("Implausible item custom data count {}", custom_data));
        }
        for _ in 0..custom_data {
            r.read_string()?;
            r.read_string()?;
        }
        // The cheated flag arrived in 107 and stuck from 109 — 108 doesn't have it.
        if inv_version >= 109 || inv_version == 107 {
            let _cheated = r.read_u8()?;
        }

        // A zero hash means "no item"; the game drops those on load.
        if prefab_hash == 0 {
            continue;
        }
        let name = prefab_name_for_hash(prefab_hash)
            .map(|n| n.to_string())
            // Modded items were never in the vanilla dump, so name them by hash
            // rather than dropping the row — the slot is still occupied.
            .unwrap_or_else(|| format!("Unknown item ({})", prefab_hash));

        items.push(InventoryItem {
            name,
            stack,
            durability,
            grid_x,
            grid_y,
            equipped,
            quality,
            variant,
            crafter_name,
            world_level,
        });
    }

    Ok(items)
}

fn parse_foods(r: &mut BinReader, pv: i32) -> Result<Vec<FoodData>, String> {
    let count = r.read_i32()?;
    let mut foods = Vec::with_capacity(count as usize);

    for _ in 0..count {
        if pv >= 14 {
            let name = r.read_string()?;
            if pv >= 25 {
                // v25+: just name + remaining time
                let time = r.read_f32()?;
                foods.push(FoodData {
                    name,
                    time,
                    health: 0.0,
                    stamina: 0.0,
                });
            } else {
                // v14-24: name + health + optional stamina
                let health = r.read_f32()?;
                let stamina = if pv >= 16 { r.read_f32()? } else { 0.0 };
                foods.push(FoodData {
                    name,
                    time: 0.0,
                    health,
                    stamina,
                });
            }
        } else {
            // v12-13: old format (string + 6-7 floats, just skip)
            r.read_string()?;
            for _ in 0..6 { r.read_f32()?; }
            if pv >= 13 { r.read_f32()?; }
        }
    }

    Ok(foods)
}

fn parse_skills(r: &mut BinReader) -> Result<Vec<SkillData>, String> {
    let skill_version = r.read_i32()?;
    let count = r.read_i32()?;
    let mut skills = Vec::with_capacity(count as usize);

    for _ in 0..count {
        let id = r.read_i32()?;
        let level = r.read_f32()?;
        let accumulator = if skill_version >= 2 {
            r.read_f32()?
        } else {
            0.0
        };

        skills.push(SkillData {
            id,
            name: skill_name(id).to_string(),
            level,
            accumulator,
        });
    }

    // Sort by level descending for display
    skills.sort_by(|a, b| b.level.partial_cmp(&a.level).unwrap_or(std::cmp::Ordering::Equal));
    Ok(skills)
}

fn read_string_list(r: &mut BinReader) -> Result<Vec<String>, String> {
    let count = r.read_i32()?;
    let mut list = Vec::with_capacity(count as usize);
    for _ in 0..count {
        list.push(r.read_string()?);
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lord_rik() {
        let home = std::env::var("USERPROFILE").unwrap();
        let path = format!(
            r"{}\AppData\LocalLow\IronGate\Valheim\characters\lord rik.fch.old",
            home
        );
        if !std::path::Path::new(&path).exists() {
            println!("Skipping test — file not found: {}", path);
            return;
        }
        let data = std::fs::read(&path).unwrap();
        let c = parse_character_file(&data).expect("Failed to parse");
        println!("Name: {}", c.name);
        println!(
            "V{} | K:{} D:{} C:{} B:{}",
            c.version, c.kills, c.deaths, c.crafts, c.builds
        );
        println!("HP:{}/{} Stam:{}", c.hp, c.max_hp, c.stamina);
        println!("Guardian: {}", c.guardian_power);
        println!("Skills({}): {:?}", c.skills.len(), c.skills.iter().take(5).map(|s| format!("{} lv{:.0}", s.name, s.level)).collect::<Vec<_>>());
        println!("Inventory: {} items", c.inventory.len());
        println!("Equipped: {:?}", c.inventory.iter().filter(|i| i.equipped).map(|i| &i.name).collect::<Vec<_>>());
        println!("Recipes:{} Materials:{} Trophies:{}", c.known_recipes.len(), c.known_materials.len(), c.trophies.len());
        println!("Biomes: {:?}", c.known_biomes);
        println!("Model:{} Beard:'{}' Hair:'{}'", c.model, c.beard, c.hair);
        println!("Foods: {:?}", c.active_foods.iter().map(|f| &f.name).collect::<Vec<_>>());

        assert!(!c.name.is_empty());
        assert!(c.kills >= 0);
    }

    /// Valheim 1.0 (character file v46, player data v33, inventory v109) across
    /// every 1.0 save on this machine.
    ///
    /// The check that matters is the last one: a correct parse consumes the
    /// player blob EXACTLY. The old parser failed loudly here ("EOF skipping N
    /// bytes"), but a subtler format change can leave the parse looking fine
    /// while silently landing on the wrong fields, so assert on the shape of
    /// what came back rather than just on "no error".
    #[test]
    fn test_parse_valheim_1_0_characters() {
        let mut checked = 0;
        for dir in find_character_dirs() {
            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("fch") {
                    continue;
                }
                let data = match std::fs::read(&path) {
                    Ok(d) => d,
                    Err(_) => continue,
                };
                if data.len() < 8 {
                    continue;
                }
                let version = i32::from_le_bytes([data[4], data[5], data[6], data[7]]);
                if version < 44 {
                    continue;
                }

                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let c = parse_character_file(&data)
                    .unwrap_or_else(|e| panic!("{} (v{}) failed to parse: {}", name, version, e));

                assert!(!c.name.is_empty(), "{}: empty character name", name);
                assert!(c.max_hp > 0.0, "{}: max_hp was {}", name, c.max_hp);
                // A character created but never taken into a world has no world
                // data and no skills yet, so those are only meaningful once it
                // has actually been played.
                if c.world_count > 0 {
                    assert!(
                        !c.skills.is_empty(),
                        "{}: played character with no skills — the parse drifted                          before the skill block",
                        name
                    );
                }
                // Item names come back through the prefab-hash table now; if that
                // lookup broke, every item would read "Unknown item (...)".
                let named = c
                    .inventory
                    .iter()
                    .filter(|i| !i.name.starts_with("Unknown item"))
                    .count();
                assert!(
                    c.inventory.is_empty() || named > 0,
                    "{}: {} items and not one resolved to a prefab name",
                    name,
                    c.inventory.len()
                );
                println!(
                    "{} v{}: {} items ({} named), {} skills, {} biomes, K:{} D:{}",
                    name, c.version, c.inventory.len(), named,
                    c.skills.len(), c.known_biomes.len(), c.kills, c.deaths
                );
                checked += 1;
            }
        }
        if checked == 0 {
            println!("Skipping — no Valheim 1.0 character files on this machine");
        }
    }

    #[test]
    fn test_list_characters() {
        let result = list_characters();
        match result {
            Ok(chars) => {
                println!("Found {} characters:", chars.len());
                for c in &chars {
                    println!("  {} — {} ({} bytes)", c.name, c.path, c.size);
                }
                assert!(!chars.is_empty());
            }
            Err(e) => println!("Skipping — {}", e),
        }
    }

    #[test]
    fn test_dump_v43_bytes() {
        // Test parsing a v43 Steam Cloud character
        let path = r"C:\Program Files (x86)\Steam\userdata\313717669\892970\remote\characters\puratania.fch";
        if !std::path::Path::new(path).exists() {
            println!("Skipping — file not found");
            return;
        }
        let data = std::fs::read(path).unwrap();
        println!("File size: {}", data.len());
        match parse_character_file(&data) {
            Ok(c) => {
                println!("SUCCESS! Parsed v43 character:");
                println!("  Name: {}", c.name);
                println!("  Version: {}", c.version);
                println!("  K:{} D:{} C:{} B:{}", c.kills, c.deaths, c.crafts, c.builds);
                println!("  HP:{}/{} Stam:{} Eitr:{}", c.hp, c.max_hp, c.stamina, c.max_eitr);
                println!("  Guardian: {}", c.guardian_power);
                println!("  Model:{} Beard:'{}' Hair:'{}'", c.model, c.beard, c.hair);
                println!("  Skills: {}", c.skills.len());
                for s in c.skills.iter().take(5) {
                    println!("    {} lv{:.1}", s.name, s.level);
                }
                println!("  Inventory: {} items", c.inventory.len());
                println!("  Equipped: {:?}", c.inventory.iter().filter(|i| i.equipped).map(|i| &i.name).collect::<Vec<_>>());
                println!("  Recipes:{} Materials:{} Trophies:{}", c.known_recipes.len(), c.known_materials.len(), c.trophies.len());
                println!("  Sample recipes: {:?}", c.known_recipes.iter().take(10).collect::<Vec<_>>());
                println!("  Sample materials: {:?}", c.known_materials.iter().take(10).collect::<Vec<_>>());
                println!("  Sample trophies: {:?}", c.trophies.iter().take(10).collect::<Vec<_>>());
                println!("  Biomes: {:?}", c.known_biomes);
                println!("  Foods: {:?}", c.active_foods.iter().map(|f| &f.name).collect::<Vec<_>>());
                println!("  Worlds: {}", c.world_count);

                assert_eq!(c.name, "Puratania");
                assert!(c.kills > 0 || c.deaths > 0, "Should have some stats");
                assert!(c.skills.len() > 0, "Should have skills");
            }
            Err(e) => panic!("FAILED to parse v43: {}", e),
        }
    }

    #[test]
    fn test_parse_all_characters() {
        // Test ALL characters from all directories
        let dirs = find_character_dirs();
        let mut total = 0;
        let mut passed = 0;
        let mut failed = 0;

        for dir in &dirs {
            println!("\n=== Directory: {} ===", dir.display());
            let entries = match std::fs::read_dir(dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let fname = path.file_name().unwrap().to_string_lossy().to_string();
                if (!fname.ends_with(".fch") && !fname.ends_with(".fch.old")) || fname.contains("_backup_") {
                    continue;
                }
                total += 1;
                let data = std::fs::read(&path).unwrap();
                match parse_character_file(&data) {
                    Ok(c) => {
                        passed += 1;
                        println!("  ✓ {} | V{} K:{} D:{} HP:{:.0}/{:.0} Skills:{} Inv:{} Recipes:{} Worlds:{}",
                            c.name, c.version, c.kills, c.deaths, c.hp, c.max_hp,
                            c.skills.len(), c.inventory.len(), c.known_recipes.len(), c.world_count);
                    }
                    Err(e) => {
                        failed += 1;
                        println!("  ✗ {} — {}", fname, e);
                    }
                }
            }
        }

        println!("\n=== Results: {}/{} passed, {} failed ===", passed, total, failed);
        assert_eq!(failed, 0, "Some character files failed to parse");
    }
}
