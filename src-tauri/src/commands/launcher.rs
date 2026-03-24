use crate::commands::app_log::app_log;
use std::path::{Path, PathBuf};
use std::fs;
use std::time::SystemTime;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use serde::Serialize;
use tauri::command;

// Valheim's Steam App ID
const VALHEIM_APP_ID: &str = "892970";

#[derive(Serialize)]
pub struct GameStatus {
    pub valheim_running: bool,
    pub steam_running: bool,
    pub cloud_syncing: bool,
    pub ready_to_launch: bool,
    pub status_text: String,
}

#[command]
pub fn detect_valheim_path() -> Result<String, String> {
    let candidates = vec![
        r"C:\Program Files (x86)\Steam\steamapps\common\Valheim",
        r"C:\Program Files\Steam\steamapps\common\Valheim",
        r"D:\Steam\steamapps\common\Valheim",
        r"D:\SteamLibrary\steamapps\common\Valheim",
        r"E:\SteamLibrary\steamapps\common\Valheim",
    ];

    for path in candidates {
        let p = PathBuf::from(path);
        if p.join("valheim.exe").exists() {
            return Ok(path.to_string());
        }
    }

    Err("Valheim installation not found. Please set the path manually.".to_string())
}

#[command]
pub fn detect_r2modman_profiles() -> Result<Vec<(String, String)>, String> {
    let app_data = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let r2_path = PathBuf::from(&app_data)
        .join("r2modmanPlus-local")
        .join("Valheim")
        .join("profiles");

    if !r2_path.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&r2_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path().to_string_lossy().to_string();
                profiles.push((name, path));
            }
        }
    }

    Ok(profiles)
}

#[command]
pub fn launch_valheim(valheim_path: String, bepinex_path: String) -> Result<(), String> {
    app_log(&format!("Launching Valheim: game={}, bepinex={}", valheim_path, bepinex_path));
    let game_dir = PathBuf::from(&valheim_path);
    let valheim_exe = game_dir.join("valheim.exe");
    if !valheim_exe.exists() {
        return Err("valheim.exe not found".to_string());
    }

    let doorstop_dll = PathBuf::from(&bepinex_path)
        .join("core")
        .join("BepInEx.Preloader.dll");

    if !doorstop_dll.exists() {
        return Err(
            "BepInEx core not found in this profile. Go to the Mods page and use \"Install BepInEx\" to set up BepInEx for this profile.".to_string()
        );
    }

    let winhttp = game_dir.join("winhttp.dll");
    if !winhttp.exists() {
        return Err(
            "Unity Doorstop (winhttp.dll) not found in Valheim directory. BepInEx cannot bootstrap without it. Go to Settings to set up doorstop.".to_string()
        );
    }

    // Ensure steam_appid.txt exists so SteamAPI_Init() works when launching directly
    let appid_path = game_dir.join("steam_appid.txt");
    if !appid_path.exists() {
        fs::write(&appid_path, VALHEIM_APP_ID)
            .map_err(|e| format!("Failed to write steam_appid.txt: {}", e))?;
        app_log("Created steam_appid.txt");
    }

    // === KEY FIX: Rewrite doorstop_config.ini to use the ABSOLUTE path to this profile's BepInEx ===
    // This is what R2Modman does — env vars are unreliable across doorstop versions.
    let doorstop_config_path = game_dir.join("doorstop_config.ini");
    let absolute_preloader = doorstop_dll.to_string_lossy().to_string();
    write_doorstop_config(&doorstop_config_path, &absolute_preloader)?;

    // Launch with env vars as backup (some doorstop versions respect them)
    // -console enables the in-game F5 console (required for devcommands)
    std::process::Command::new(valheim_exe)
        .current_dir(&game_dir)
        .arg("-console")
        .env("DOORSTOP_ENABLE", "true")
        .env("DOORSTOP_INVOKE_DLL_PATH", &absolute_preloader)
        .spawn()
        .map_err(|e| format!("Failed to launch Valheim: {}", e))?;

    app_log("Valheim launched successfully");
    Ok(())
}

/// Write a doorstop_config.ini that points to the given absolute BepInEx.Preloader.dll path.
fn write_doorstop_config(path: &PathBuf, target_assembly: &str) -> Result<(), String> {
    let config = format!(
r#"[General]
enabled=true
target_assembly={target_assembly}
redirect_output_log=false
boot_config_override=
ignore_disable_switch=false

[UnityMono]
dll_search_path_override=
debug_enabled=false
debug_address=127.0.0.1:10000
debug_suspend=false
"#);
    fs::write(path, config)
        .map_err(|e| format!("Failed to write doorstop_config.ini: {}", e))
}

/// Check the current game/Steam status for launch readiness.
#[command]
pub fn check_game_status(valheim_path: String) -> Result<GameStatus, String> {
    let valheim_running = is_process_running("valheim.exe");
    let steam_running = is_process_running("steam.exe");

    // Only check cloud sync if the game isn't running (sync happens after game closes)
    let cloud_syncing = if !valheim_running {
        is_cloud_syncing(&valheim_path)
    } else {
        false
    };

    let ready = !valheim_running && !cloud_syncing;

    let status_text = if valheim_running {
        "Valheim is running".to_string()
    } else if cloud_syncing {
        "Steam Cloud sync in progress...".to_string()
    } else if !steam_running {
        "Ready — Steam will be started automatically".to_string()
    } else {
        "Ready".to_string()
    };

    Ok(GameStatus {
        valheim_running,
        steam_running,
        cloud_syncing,
        ready_to_launch: ready,
        status_text,
    })
}

/// Start Steam if it's not already running. Returns the Steam exe path used.
#[command]
pub fn start_steam(valheim_path: String) -> Result<String, String> {
    if is_process_running("steam.exe") {
        return Ok("already_running".to_string());
    }

    // Derive Steam root from: .../steamapps/common/Valheim → .../Steam/steam.exe
    let game_dir = PathBuf::from(&valheim_path);
    let steam_exe = game_dir
        .parent() // common/
        .and_then(|p| p.parent()) // steamapps/
        .and_then(|p| p.parent()) // Steam/
        .map(|p| p.join("steam.exe"));

    let exe = match steam_exe {
        Some(p) if p.exists() => p,
        _ => {
            // Fallback: try common install locations
            let candidates = [
                r"C:\Program Files (x86)\Steam\steam.exe",
                r"C:\Program Files\Steam\steam.exe",
                r"D:\Steam\steam.exe",
            ];
            match candidates.iter().find(|c| Path::new(c).exists()) {
                Some(c) => PathBuf::from(c),
                None => return Err("Could not find steam.exe. Please start Steam manually.".to_string()),
            }
        }
    };

    app_log(&format!("Starting Steam: {}", exe.display()));
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("Failed to start Steam: {}", e))?;

    Ok(exe.to_string_lossy().to_string())
}

/// Check if a process is running by name using tasklist (Windows).
fn is_process_running(name: &str) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {}", name), "/NH", "/FO", "CSV"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW — suppress console flash
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_lowercase();
            stdout.contains(&name.to_lowercase())
        }
        Err(_) => false,
    }
}

/// Detect whether Steam Cloud sync is active for Valheim.
/// Uses three signals:
///   1. appmanifest_892970.acf StateFlags has active bits (update/sync in progress)
///   2. remotecache.vdf was modified very recently (sync metadata still being written)
///   3. Remote save files (.fch, .db, .fwl) were modified very recently (files still uploading)
///
/// IMPORTANT: remotecache.vdf is written as the FINAL step of sync completion,
/// so the window must be short enough to not report "syncing" after sync is done.
/// 15s for remotecache.vdf and 10s for saves balances detection vs false positives.
fn is_cloud_syncing(valheim_path: &str) -> bool {
    let game_dir = PathBuf::from(valheim_path);

    // Navigate: .../steamapps/common/Valheim → .../steamapps/
    let steamapps = match game_dir.parent().and_then(|p| p.parent()) {
        Some(p) => p,
        None => return false,
    };

    // Signal 1: Check app manifest StateFlags
    let manifest_path = steamapps.join(format!("appmanifest_{}.acf", VALHEIM_APP_ID));
    if let Ok(content) = fs::read_to_string(&manifest_path) {
        if let Some(flags_str) = parse_acf_value(&content, "StateFlags") {
            if let Ok(flags) = flags_str.parse::<u32>() {
                // Active-state bits (anything beyond FullyInstalled=4):
                //   64=AppRunning, 256=UpdateRunning, 512=UpdatePaused,
                //   1024=UpdateStarted, 4096=BackupRunning, 8192=Reconfiguring,
                //   16384=Validating, 32768=AddingFiles
                const ACTIVE_BITS: u32 = 64 | 256 | 512 | 1024 | 4096 | 8192 | 16384 | 32768;
                if flags & ACTIVE_BITS != 0 {
                    app_log("[cloud-sync] Signal 1: appmanifest StateFlags has active bits");
                    return true;
                }
            }
        }
    }

    let steam_root = match steamapps.parent() {
        Some(p) => p,
        None => return false,
    };
    let userdata = steam_root.join("userdata");
    if !userdata.exists() {
        return false;
    }

    if let Ok(entries) = fs::read_dir(&userdata) {
        for entry in entries.flatten() {
            let app_dir = entry.path().join(VALHEIM_APP_ID);

            // Signal 2: remotecache.vdf modified within 15s
            // (Steam writes this as the final sync step, so keep the window tight
            // to avoid false positives after sync completes)
            let cache_path = app_dir.join("remotecache.vdf");
            if was_modified_within_secs(&cache_path, 15) {
                app_log("[cloud-sync] Signal 2: remotecache.vdf modified within 15s");
                return true;
            }

            // Signal 3: Check actual remote save files — if character/world files
            // were recently modified, Steam is still writing them during sync.
            // Path: userdata/<ID>/892970/remote/
            let remote_dir = app_dir.join("remote");
            if remote_dir.exists() {
                if has_recently_modified_saves(&remote_dir, 10) {
                    app_log("[cloud-sync] Signal 3: save files modified within 10s");
                    return true;
                }
            }
        }
    }

    false
}

/// Recursively check if any save files (.fch, .db, .fwl) under a directory
/// were modified within the last N seconds.
fn has_recently_modified_saves(dir: &Path, secs: u64) -> bool {
    let save_extensions = ["fch", "db", "fwl"];
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if has_recently_modified_saves(&path, secs) {
                    return true;
                }
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if save_extensions.contains(&ext) && was_modified_within_secs(&path, secs) {
                    return true;
                }
            }
        }
    }
    false
}

/// Parse a top-level key-value pair from a Valve ACF/VDF text file.
/// Format: `"key"		"value"`
fn parse_acf_value(content: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&needle) {
            let parts: Vec<&str> = trimmed.split('"').collect();
            if parts.len() >= 4 {
                return Some(parts[3].to_string());
            }
        }
    }
    None
}

/// Check if a file was modified within the last N seconds.
fn was_modified_within_secs(path: &Path, secs: u64) -> bool {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs() < secs)
        .unwrap_or(false)
}
