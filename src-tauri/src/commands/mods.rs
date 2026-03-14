use crate::models::ModInfo;
use std::fs;
use std::path::Path;
use tauri::command;

/// Load the mod manifest to get versions and descriptions for our mods.
fn load_manifest_info() -> std::collections::HashMap<String, (String, Option<String>)> {
    let mut map = std::collections::HashMap::new();
    if let Some(appdata) = std::env::var("APPDATA").ok() {
        let versions_path = Path::new(&appdata).join("MegaLoad").join("mod_versions.json");
        if let Ok(data) = fs::read_to_string(&versions_path) {
            if let Ok(versions) = serde_json::from_str::<std::collections::HashMap<String, String>>(&data) {
                for (name, ver) in versions {
                    map.entry(name).or_insert((ver, None));
                }
            }
        }
        let manifest_path = Path::new(&appdata).join("MegaLoad").join("mod_manifest_cache.json");
        if let Ok(data) = fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(mods) = manifest["mods"].as_array() {
                    for m in mods {
                        let name = m["name"].as_str().unwrap_or_default().to_string();
                        let desc = m["description"].as_str().map(|s| s.to_string());
                        let ver = m["version"].as_str().unwrap_or_default().to_string();
                        map.entry(name).and_modify(|e| e.1 = desc.clone()).or_insert((ver, desc));
                    }
                }
            }
        }
    }
    map
}

#[command]
pub fn get_mods(bepinex_path: String) -> Result<Vec<ModInfo>, String> {
    let plugins_dir = Path::new(&bepinex_path).join("plugins");
    let disabled_dir = plugins_dir.join("_disabled");
    let mut mods = Vec::new();
    let manifest_info = load_manifest_info();

    // Scan enabled mods
    if plugins_dir.exists() {
        scan_mods_dir(&plugins_dir, true, &mut mods)?;
    }

    // Scan disabled mods
    if disabled_dir.exists() {
        scan_mods_dir(&disabled_dir, false, &mut mods)?;
    }

    // Enrich with versions and descriptions from manifest
    for m in &mut mods {
        if let Some((ver, desc)) = manifest_info.get(&m.name) {
            if m.version.is_none() {
                m.version = Some(ver.clone());
            }
            if m.description.is_none() {
                m.description = desc.clone();
            }
        }
    }

    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(mods)
}

fn scan_mods_dir(dir: &Path, enabled: bool, mods: &mut Vec<ModInfo>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.starts_with('_') {
            continue;
        }

        if path.is_dir() {
            // Mod in its own folder — look for DLLs inside
            if let Ok(sub_entries) = fs::read_dir(&path) {
                for sub_entry in sub_entries.flatten() {
                    let sub_path = sub_entry.path();
                    if sub_path.extension().and_then(|e| e.to_str()) == Some("dll") {
                        let dll_name = sub_path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        mods.push(ModInfo {
                            name: dll_name.clone(),
                            file_name: sub_entry.file_name().to_string_lossy().to_string(),
                            folder: file_name.clone(),
                            enabled,
                            version: None,
                            guid: None,
                            description: None,
                        });
                    }
                }
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("dll") {
            // Loose DLL directly in plugins folder
            let dll_name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            mods.push(ModInfo {
                name: dll_name.clone(),
                file_name: file_name,
                folder: String::new(),
                enabled,
                version: None,
                guid: None,
                description: None,
            });
        }
    }

    Ok(())
}

#[command]
pub fn toggle_mod(bepinex_path: String, folder: String, file_name: String, enable: bool) -> Result<(), String> {
    let plugins_dir = Path::new(&bepinex_path).join("plugins");
    let disabled_dir = plugins_dir.join("_disabled");

    let (src_base, dst_base) = if enable {
        (disabled_dir.as_path(), plugins_dir.as_path())
    } else {
        (plugins_dir.as_path(), disabled_dir.as_path())
    };

    fs::create_dir_all(dst_base).map_err(|e| e.to_string())?;

    if folder.is_empty() {
        // Loose DLL
        let src = src_base.join(&file_name);
        let dst = dst_base.join(&file_name);
        fs::rename(&src, &dst).map_err(|e| format!("Failed to move {}: {}", file_name, e))?;
    } else {
        // Folder-based mod
        let src = src_base.join(&folder);
        let dst = dst_base.join(&folder);
        fs::rename(&src, &dst).map_err(|e| format!("Failed to move {}: {}", folder, e))?;
    }

    Ok(())
}

#[command]
pub fn delete_mod(bepinex_path: String, folder: String, file_name: String, enabled: bool) -> Result<(), String> {
    let plugins_dir = Path::new(&bepinex_path).join("plugins");
    let base = if enabled {
        plugins_dir
    } else {
        plugins_dir.join("_disabled")
    };

    if folder.is_empty() {
        let path = base.join(&file_name);
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    } else {
        let path = base.join(&folder);
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[command]
pub fn install_mod(bepinex_path: String, source_path: String) -> Result<String, String> {
    let source = Path::new(&source_path);
    let plugins_dir = Path::new(&bepinex_path).join("plugins");

    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    let file_name = source
        .file_name()
        .ok_or("Invalid file name")?
        .to_string_lossy()
        .to_string();

    if source.extension().and_then(|e| e.to_str()) == Some("dll") {
        // Single DLL — create folder for it
        let mod_name = source
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let dest_dir = plugins_dir.join(&mod_name);
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        fs::copy(source, dest_dir.join(&file_name)).map_err(|e| e.to_string())?;
        Ok(mod_name)
    } else {
        Err("Only .dll files are supported".to_string())
    }
}

#[command]
pub fn validate_bepinex(bepinex_path: String) -> Result<serde_json::Value, String> {
    let base = Path::new(&bepinex_path);
    let has_core = base.join("core").join("BepInEx.Preloader.dll").exists();
    let has_plugins = base.join("plugins").exists();
    let has_config = base.join("config").exists();
    let plugin_count = if has_plugins {
        fs::read_dir(base.join("plugins"))
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        !name.starts_with('_')
                    })
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };

    Ok(serde_json::json!({
        "has_core": has_core,
        "has_plugins": has_plugins,
        "has_config": has_config,
        "plugin_count": plugin_count,
        "path_exists": base.exists(),
    }))
}
