use crate::commands::app_log::app_log;
use crate::commands::security::validate_config_path;
use crate::models::{ConfigEntry, ConfigFile, ConfigSection};
use notify::{Config as NotifyConfig, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, Emitter, State};

pub struct ConfigWatcherState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

#[command]
pub fn start_config_watcher(
    app: AppHandle,
    state: State<'_, ConfigWatcherState>,
    bepinex_path: String,
) -> Result<(), String> {
    let config_dir = Path::new(&bepinex_path).join("config");
    if !config_dir.exists() {
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
                let is_cfg = event
                    .paths
                    .iter()
                    .any(|p| p.extension().and_then(|e| e.to_str()) == Some("cfg"));
                if !is_cfg {
                    return;
                }
                // Debounce: skip if emitted < 1s ago
                if let Ok(mut last) = last_emit.lock() {
                    if last.elapsed() < Duration::from_secs(1) {
                        return;
                    }
                    *last = Instant::now();
                }
                let _ = app_handle.emit("config-files-changed", "");
            }
        },
        NotifyConfig::default(),
    )
    .map_err(|e| format!("Failed to create config watcher: {}", e))?;

    watcher
        .watch(&config_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch config dir: {}", e))?;

    *guard = Some(watcher);
    app_log("Config watcher started");
    Ok(())
}

#[command]
pub fn stop_config_watcher(state: State<'_, ConfigWatcherState>) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[command]
pub fn get_config_files(bepinex_path: String) -> Result<Vec<ConfigFile>, String> {
    let config_dir = Path::new(&bepinex_path).join("config");
    let mut configs = Vec::new();

    if !config_dir.exists() {
        return Ok(configs);
    }

    let entries = fs::read_dir(&config_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("cfg") {
            match parse_config_file(&path) {
                Ok(config) => configs.push(config),
                Err(_) => continue,
            }
        }
    }

    configs.sort_by(|a, b| a.mod_name.to_lowercase().cmp(&b.mod_name.to_lowercase()));
    Ok(configs)
}

#[command]
pub fn save_config_value(
    config_path: String,
    section: String,
    key: String,
    value: String,
) -> Result<(), String> {
    // Validate config path is within BepInEx/config and has .cfg extension
    validate_config_path(&config_path, "")?;

    app_log(&format!("Config: [{}] {} = {}", section, key, value));
    let path = Path::new(&config_path);
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    // Strip UTF-8 BOM if present, detect original line endings
    let content = raw.strip_prefix('\u{FEFF}').unwrap_or(&raw);
    let line_ending = if content.contains("\r\n") { "\r\n" } else { "\n" };

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut in_section = false;
    let section_header = format!("[{}]", section);

    for line in &mut lines {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_section = trimmed == section_header;
            continue;
        }
        if in_section {
            if let Some(eq_pos) = trimmed.find('=') {
                let line_key = trimmed[..eq_pos].trim();
                if line_key == key {
                    *line = format!("{} = {}", key, value);
                    break;
                }
            }
        }
    }

    fs::write(path, lines.join(line_ending)).map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_config_file(path: &Path) -> Result<ConfigFile, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    // Strip UTF-8 BOM if present
    let content = raw.strip_prefix('\u{FEFF}').unwrap_or(&raw);
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Try to extract display name from BepInEx header comment
    // Format: "## Settings file was created by plugin <Name> v<Version>"
    let mod_name = content
        .lines()
        .find(|l| l.starts_with("## Settings file was created by plugin "))
        .and_then(|l| {
            let after = l.strip_prefix("## Settings file was created by plugin ")?;
            // Strip trailing version (e.g., " v1.2.3")
            after.rfind(" v").map(|i| after[..i].trim().to_string())
        })
        .unwrap_or_else(|| {
            // Fallback: derive from filename (e.g., "com.author.modname.cfg" -> "modname")
            file_name
                .trim_end_matches(".cfg")
                .rsplit('.')
                .next()
                .unwrap_or(&file_name)
                .to_string()
        });

    let mut sections: Vec<ConfigSection> = Vec::new();
    let mut current_section: Option<String> = None;
    let mut current_entries: Vec<ConfigEntry> = Vec::new();
    let mut pending_description: Vec<String> = Vec::new();
    let mut pending_type: Option<String> = None;
    let mut pending_default: Option<String> = None;
    let mut pending_acceptable: Option<Vec<String>> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        // Section header
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Save previous section
            if let Some(sec_name) = current_section.take() {
                sections.push(ConfigSection {
                    name: sec_name,
                    entries: std::mem::take(&mut current_entries),
                });
            }
            current_section = Some(trimmed[1..trimmed.len() - 1].to_string());
            pending_description.clear();
            pending_type = None;
            pending_default = None;
            pending_acceptable = None;
            continue;
        }

        // Comment lines with metadata
        if trimmed.starts_with("##") {
            let comment = trimmed[2..].trim();
            if let Some(rest) = comment.strip_prefix("Setting type:") {
                pending_type = Some(rest.trim().to_string());
            } else if let Some(rest) = comment.strip_prefix("Default value:") {
                pending_default = Some(rest.trim().to_string());
            } else if let Some(rest) = comment.strip_prefix("Acceptable values:") {
                let vals: Vec<String> = rest
                    .split(',')
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
                    .collect();
                if !vals.is_empty() {
                    pending_acceptable = Some(vals);
                }
            } else if let Some(rest) = comment.strip_prefix("Acceptable value range:") {
                let range_str = rest.trim().to_string();
                if !range_str.is_empty() {
                    pending_acceptable = Some(vec![range_str]);
                }
            } else if !comment.is_empty() {
                pending_description.push(comment.to_string());
            }
            continue;
        }

        // Single # metadata lines (BepInEx standard format)
        if trimmed.starts_with('#') && !trimmed.starts_with("##") {
            let comment = trimmed[1..].trim();
            if let Some(rest) = comment.strip_prefix("Setting type:") {
                pending_type = Some(rest.trim().to_string());
            } else if let Some(rest) = comment.strip_prefix("Default value:") {
                pending_default = Some(rest.trim().to_string());
            } else if let Some(rest) = comment.strip_prefix("Acceptable values:") {
                let vals: Vec<String> = rest
                    .split(',')
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
                    .collect();
                if !vals.is_empty() {
                    pending_acceptable = Some(vals);
                }
            } else if let Some(rest) = comment.strip_prefix("Acceptable value range:") {
                // Store range as a single-element vec (frontend parses "From X to Y")
                let range_str = rest.trim().to_string();
                if !range_str.is_empty() {
                    pending_acceptable = Some(vec![range_str]);
                }
            }
            continue;
        }

        // Skip empty lines
        if trimmed.is_empty() {
            continue;
        }

        // Key = Value pair
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_string();
            let value = trimmed[eq_pos + 1..].trim().to_string();

            let entry = ConfigEntry {
                key,
                value,
                default_value: pending_default.take(),
                description: if pending_description.is_empty() {
                    None
                } else {
                    Some(pending_description.drain(..).collect::<Vec<_>>().join("\n"))
                },
                value_type: pending_type.take(),
                acceptable_values: pending_acceptable.take(),
            };
            current_entries.push(entry);
        }
    }

    // Save last section
    if let Some(sec_name) = current_section {
        sections.push(ConfigSection {
            name: sec_name,
            entries: current_entries,
        });
    }

    Ok(ConfigFile {
        file_name,
        mod_name,
        path: path.to_string_lossy().to_string(),
        sections,
    })
}

/// Reset all entries in a config file to their default values.
#[command]
pub fn reset_config_file(config_path: String) -> Result<ConfigFile, String> {
    app_log(&format!("Resetting config to defaults: {}", config_path));
    let path = Path::new(&config_path);
    let config = parse_config_file(path)?;

    // For each entry with a default, write it back
    for section in &config.sections {
        for entry in &section.entries {
            if let Some(ref default) = entry.default_value {
                if entry.value != *default {
                    let _ = save_config_value(
                        config_path.clone(),
                        section.name.clone(),
                        entry.key.clone(),
                        default.clone(),
                    );
                }
            }
        }
    }

    // Re-parse and return updated config
    parse_config_file(path)
}

/// Collect all installed mod DLL stems from plugins/ and plugins/_disabled/.
fn collect_installed_mod_names(bepinex_path: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    let plugins_dir = bepinex_path.join("plugins");

    for dir in [plugins_dir.clone(), plugins_dir.join("_disabled")] {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with('_') {
                    continue;
                }
                if path.is_dir() {
                    // Folder-based mod — scan DLLs inside
                    if let Ok(sub) = fs::read_dir(&path) {
                        for sub_entry in sub.flatten() {
                            if sub_entry.path().extension().and_then(|e| e.to_str()) == Some("dll") {
                                if let Some(stem) = sub_entry.path().file_stem() {
                                    names.insert(stem.to_string_lossy().to_lowercase());
                                }
                            }
                        }
                    }
                } else if path.extension().and_then(|e| e.to_str()) == Some("dll") {
                    if let Some(stem) = path.file_stem() {
                        names.insert(stem.to_string_lossy().to_lowercase());
                    }
                }
            }
        }
    }
    names
}

/// Config filenames that should never be deleted (BepInEx core + common framework configs).
const PROTECTED_PREFIXES: &[&str] = &["bepinex"];

/// Remove config files for mods that are no longer installed.
/// Returns the list of deleted config filenames.
#[command]
pub fn clean_orphan_configs(bepinex_path: String) -> Result<Vec<String>, String> {
    let base = Path::new(&bepinex_path);
    let config_dir = base.join("config");
    if !config_dir.exists() {
        return Ok(Vec::new());
    }

    let mod_names = collect_installed_mod_names(base);
    let mut deleted = Vec::new();

    let entries = fs::read_dir(&config_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("cfg") {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let stem = file_name.trim_end_matches(".cfg").to_lowercase();

        // Never delete protected configs
        if PROTECTED_PREFIXES.iter().any(|p| stem.starts_with(p)) {
            continue;
        }

        // Split GUID segments (e.g. "ccmrik.megaqol") and check if any segment
        // matches an installed mod name
        let segments: Vec<&str> = stem.split('.').collect();
        let has_match = segments.iter().any(|seg| mod_names.contains(*seg));

        if !has_match {
            app_log(&format!("Removing orphan config: {}", file_name));
            fs::remove_file(&path).map_err(|e| {
                format!("Failed to delete {}: {}", file_name, e)
            })?;
            deleted.push(file_name);
        }
    }

    if !deleted.is_empty() {
        app_log(&format!("Cleaned {} orphan config file(s)", deleted.len()));
    }
    Ok(deleted)
}
