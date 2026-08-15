use crate::commands::app_log::app_log;
use crate::commands::profiles::create_profile;
use std::fs;
use std::path::Path;
use tauri::command;

/// Copy a directory tree recursively.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create {:?}: {}", dst, e))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

#[command(async)]
pub fn import_r2modman_profile(profile_name: String, r2_profile_path: String) -> Result<String, String> {
    app_log(&format!("Importing R2Modman profile: {} from {}", profile_name, r2_profile_path));
    let r2_path = Path::new(&r2_profile_path);
    if !r2_path.exists() {
        return Err("R2Modman profile path does not exist".to_string());
    }

    let r2_bepinex = r2_path.join("BepInEx");
    if !r2_bepinex.exists() {
        return Err("No BepInEx folder found in R2Modman profile".to_string());
    }

    // Create a new MegaLoad profile
    let profile = create_profile(profile_name)?;

    // Copy BepInEx contents (plugins, config, patchers)
    let dest_bepinex = Path::new(&profile.bepinex_path);

    let folders_to_copy = ["plugins", "config", "patchers", "core"];
    for folder in &folders_to_copy {
        let src = r2_bepinex.join(folder);
        if src.exists() {
            let dst = dest_bepinex.join(folder);
            copy_dir_recursive(&src, &dst)?;
        }
    }

    Ok(profile.id)
}
