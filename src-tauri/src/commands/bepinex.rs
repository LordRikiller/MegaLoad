use crate::commands::app_log::app_log;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tauri::command;
use zip::ZipArchive;

const BEPINEX_FALLBACK_URL: &str =
    "https://github.com/BepInEx/BepInEx/releases/download/v5.4.23.2/BepInEx_win_x64_5.4.23.2.zip";

/// Find all places where BepInEx core files exist on this machine.
/// Returns a list of (label, path) tuples.
#[command]
pub fn find_bepinex_sources(valheim_path: Option<String>) -> Result<Vec<(String, String)>, String> {
    let mut sources: Vec<(String, String)> = Vec::new();

    // 1. Check Valheim game directory
    let valheim_candidates = if let Some(ref vp) = valheim_path {
        vec![vp.clone()]
    } else {
        vec![
            r"C:\Program Files (x86)\Steam\steamapps\common\Valheim".to_string(),
            r"C:\Program Files\Steam\steamapps\common\Valheim".to_string(),
            r"D:\Steam\steamapps\common\Valheim".to_string(),
            r"D:\SteamLibrary\steamapps\common\Valheim".to_string(),
            r"E:\SteamLibrary\steamapps\common\Valheim".to_string(),
        ]
    };

    for vp in &valheim_candidates {
        let core_dir = PathBuf::from(vp).join("BepInEx").join("core");
        if has_bepinex_preloader(&core_dir) {
            sources.push(("Valheim Game Directory".to_string(), core_dir.to_string_lossy().to_string()));
            break;
        }
    }

    // 2. Check R2Modman profiles (if installed — fully optional)
    if let Ok(app_data) = std::env::var("APPDATA") {
        let r2_profiles_dir = PathBuf::from(&app_data)
            .join("r2modmanPlus-local")
            .join("Valheim")
            .join("profiles");

        if r2_profiles_dir.exists() {
            if let Ok(entries) = fs::read_dir(&r2_profiles_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let core_dir = entry.path().join("BepInEx").join("core");
                        if has_bepinex_preloader(&core_dir) {
                            let name = entry.file_name().to_string_lossy().to_string();
                            sources.push((
                                format!("R2Modman: {}", name),
                                core_dir.to_string_lossy().to_string(),
                            ));
                        }
                    }
                }
            }
        }
    }

    // 3. Check MegaLoad's own profiles (in case user already has one set up)
    let app_data = std::env::var("APPDATA").unwrap_or_default();
    let megaload_profiles = PathBuf::from(&app_data).join("MegaLoad").join("profiles");
    if megaload_profiles.exists() {
        if let Ok(entries) = fs::read_dir(&megaload_profiles) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let core_dir = entry.path().join("BepInEx").join("core");
                    if has_bepinex_preloader(&core_dir) {
                        sources.push((
                            "Existing MegaLoad profile".to_string(),
                            core_dir.to_string_lossy().to_string(),
                        ));
                        break; // One is enough
                    }
                }
            }
        }
    }

    Ok(sources)
}

/// Copy BepInEx core files from a source core/ directory into a profile's BepInEx/core/.
#[command]
pub fn install_bepinex_core(source_core_path: String, profile_bepinex_path: String) -> Result<(), String> {
    app_log(&format!("Installing BepInEx core from {} to {}", source_core_path, profile_bepinex_path));
    let src = Path::new(&source_core_path);
    if !has_bepinex_preloader(src) {
        return Err(format!(
            "Source path doesn't contain BepInEx.Preloader.dll: {}",
            source_core_path
        ));
    }

    let dst = Path::new(&profile_bepinex_path).join("core");
    fs::create_dir_all(&dst).map_err(|e| format!("Failed to create core dir: {}", e))?;

    // Copy all files from source core/ to destination core/
    let entries = fs::read_dir(src).map_err(|e| format!("Failed to read source: {}", e))?;
    for entry in entries.flatten() {
        let src_file = entry.path();
        if src_file.is_file() {
            let dst_file = dst.join(entry.file_name());
            fs::copy(&src_file, &dst_file)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_file.file_name(), e))?;
        }
    }

    Ok(())
}

/// Ensure doorstop (winhttp.dll + doorstop_config.ini) is installed in the Valheim game dir.
/// Returns true if doorstop is present (was already there or we found a source to copy from).
#[command]
pub fn ensure_doorstop(valheim_path: String) -> Result<bool, String> {
    let game_dir = PathBuf::from(&valheim_path);
    let winhttp = game_dir.join("winhttp.dll");
    let doorstop_cfg = game_dir.join("doorstop_config.ini");

    // If both exist, doorstop is ready
    if winhttp.exists() && doorstop_cfg.exists() {
        return Ok(true);
    }

    // Try to find doorstop files from R2Modman profiles
    if let Ok(app_data) = std::env::var("APPDATA") {
        let r2_profiles_dir = PathBuf::from(&app_data)
            .join("r2modmanPlus-local")
            .join("Valheim")
            .join("profiles");

        if r2_profiles_dir.exists() {
            if let Ok(entries) = fs::read_dir(&r2_profiles_dir) {
                for entry in entries.flatten() {
                    let profile_dir = entry.path();
                    let r2_winhttp = profile_dir.join("winhttp.dll");
                    let r2_doorstop = profile_dir.join("doorstop_config.ini");

                    if r2_winhttp.exists() && r2_doorstop.exists() {
                        if !winhttp.exists() {
                            fs::copy(&r2_winhttp, &winhttp)
                                .map_err(|e| format!("Failed to copy winhttp.dll: {}", e))?;
                        }
                        if !doorstop_cfg.exists() {
                            // Write a clean doorstop config pointing to relative BepInEx path
                            write_doorstop_config(&doorstop_cfg)?;
                        }
                        // Copy doorstop_libs if missing
                        let r2_libs = profile_dir.join("doorstop_libs");
                        let game_libs = game_dir.join("doorstop_libs");
                        if r2_libs.exists() && !game_libs.exists() {
                            copy_dir(&r2_libs, &game_libs)?;
                        }
                        return Ok(true);
                    }
                }
            }
        }
    }

    // Doorstop not found anywhere — return false so UI can inform the user
    Ok(winhttp.exists() && doorstop_cfg.exists())
}

fn has_bepinex_preloader(core_dir: &Path) -> bool {
    core_dir.join("BepInEx.Preloader.dll").exists()
}

fn write_doorstop_config(path: &Path) -> Result<(), String> {
    let config = r#"[General]
enabled = true
target_assembly=BepInEx\core\BepInEx.Preloader.dll
redirect_output_log = false
boot_config_override =
ignore_disable_switch = false

[UnityMono]
dll_search_path_override =
debug_enabled = false
debug_address = 127.0.0.1:10000
debug_suspend = false
"#;
    fs::write(path, config).map_err(|e| format!("Failed to write doorstop_config.ini: {}", e))
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create {:?}: {}", dst, e))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

/// Download BepInEx 5.x from GitHub and install it for the given profile.
/// Extracts doorstop files (winhttp.dll, doorstop_config.ini) to the Valheim game directory,
/// and BepInEx core/plugins/config to the profile's BepInEx directory.
#[command]
pub fn download_bepinex(valheim_path: String, profile_bepinex_path: String) -> Result<String, String> {
    app_log("Downloading BepInEx from GitHub...");
    // 1. Try to get latest BepInEx 5.x download URL from GitHub API
    let download_url = get_latest_bepinex_5x_url()
        .unwrap_or_else(|_| BEPINEX_FALLBACK_URL.to_string());

    // 2. Download the zip
    let bytes = download_file(&download_url)?;

    // 3. Extract
    extract_bepinex_zip(&bytes, &valheim_path, &profile_bepinex_path)?;

    // 4. Figure out version from URL for the return message
    let version = download_url
        .rsplit('/')
        .next()
        .unwrap_or("BepInEx")
        .trim_end_matches(".zip");

    Ok(format!("Installed {}", version))
}

/// Query GitHub API for the latest BepInEx 5.x release and return the Windows x64 zip URL.
fn get_latest_bepinex_5x_url() -> Result<String, String> {
    let resp = crate::commands::http::agent().get("https://api.github.com/repos/BepInEx/BepInEx/releases?per_page=50")
        .set("User-Agent", "MegaLoad/1.1.0")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API error: {}", e))?;

    let body = resp.into_string()
        .map_err(|e| format!("Read error: {}", e))?;
    let releases: Vec<serde_json::Value> = serde_json::from_str(&body)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    // Find the latest 5.x release (Valheim uses Unity Mono = BepInEx 5.x)
    for release in &releases {
        let tag = release["tag_name"].as_str().unwrap_or("");
        if !tag.starts_with("v5.") {
            continue;
        }
        // Skip pre-releases
        if release["prerelease"].as_bool().unwrap_or(false) {
            continue;
        }

        if let Some(assets) = release["assets"].as_array() {
            for asset in assets {
                let name = asset["name"].as_str().unwrap_or("");
                // Match BepInEx_win_x64_*.zip or BepInEx_x64_*.zip
                if name.contains("x64") && name.ends_with(".zip")
                    && (name.starts_with("BepInEx_win") || name.starts_with("BepInEx_x64"))
                {
                    if let Some(url) = asset["browser_download_url"].as_str() {
                        return Ok(url.to_string());
                    }
                }
            }
        }
    }

    Err("No BepInEx 5.x release found on GitHub".to_string())
}

fn download_file(url: &str) -> Result<Vec<u8>, String> {
    let resp = crate::commands::http::agent().get(url)
        .set("User-Agent", "MegaLoad/1.1.0")
        .call()
        .map_err(|e| format!("Download error: {}", e))?;

    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Read error: {}", e))?;

    if bytes.len() < 1000 {
        return Err("Downloaded file is too small — download may have failed".to_string());
    }

    Ok(bytes)
}

fn extract_bepinex_zip(bytes: &[u8], valheim_path: &str, profile_bepinex_path: &str) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader)
        .map_err(|e| format!("Failed to open zip: {}", e))?;

    let valheim_dir = Path::new(valheim_path);
    let bepinex_dir = Path::new(profile_bepinex_path);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Zip entry error: {}", e))?;

        // Security: guard against path traversal
        let name = match file.enclosed_name() {
            Some(n) => n.to_path_buf(),
            None => continue,
        };

        let name_str = name.to_string_lossy().replace('\\', "/");

        if name_str.starts_with("BepInEx/") {
            // BepInEx contents → profile's BepInEx dir
            let relative = &name_str["BepInEx/".len()..];
            if relative.is_empty() {
                continue;
            }
            let outpath = bepinex_dir.join(relative);

            if file.is_dir() {
                fs::create_dir_all(&outpath)
                    .map_err(|e| format!("Create dir error: {}", e))?;
            } else {
                if let Some(p) = outpath.parent() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Create dir error: {}", e))?;
                }
                let mut outfile = fs::File::create(&outpath)
                    .map_err(|e| format!("Create file error: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Extract error: {}", e))?;
            }
        } else {
            // Top-level files: doorstop files → Valheim game dir
            let file_name = name.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if file_name == "winhttp.dll" || file_name == "doorstop_config.ini" {
                if !file.is_dir() {
                    let outpath = valheim_dir.join(&file_name);
                    let mut outfile = fs::File::create(&outpath)
                        .map_err(|e| format!("Create file error: {}", e))?;
                    std::io::copy(&mut file, &mut outfile)
                        .map_err(|e| format!("Extract error: {}", e))?;
                }
            }
        }
    }

    // Ensure required profile dirs exist
    fs::create_dir_all(bepinex_dir.join("plugins")).ok();
    fs::create_dir_all(bepinex_dir.join("config")).ok();
    fs::create_dir_all(bepinex_dir.join("disabled_plugins")).ok();

    Ok(())
}
