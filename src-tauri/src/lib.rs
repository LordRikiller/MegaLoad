mod commands;
mod models;

use commands::app_log::*;
use commands::bepinex::*;
use commands::config::*;
use commands::import::*;
use commands::launcher::*;
use commands::logs::*;
use commands::mods::*;
use commands::profiles::*;
use commands::thunderstore::*;
use commands::trainer::*;
use commands::updater::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::app_log::init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // Profiles
            get_profiles,
            create_profile,
            create_profile_linked,
            delete_profile,
            set_active_profile,
            rename_profile,
            get_profile_path,
            // Mods
            get_mods,
            toggle_mod,
            delete_mod,
            install_mod,
            validate_bepinex,
            // Config
            get_config_files,
            save_config_value,
            reset_config_file,
            clean_orphan_configs,
            // Logs
            read_log_file,
            read_log_tail,
            get_log_size,
            clear_log,
            save_log_file,
            save_text_file,
            // Launcher
            detect_valheim_path,
            detect_r2modman_profiles,
            launch_valheim,
            // BepInEx bootstrap
            find_bepinex_sources,
            install_bepinex_core,
            ensure_doorstop,
            download_bepinex,
            // Import (R2Modman — optional)
            import_r2modman_profile,
            // Mod updater
            check_mod_updates,
            install_mod_update,
            auto_update_mods,
            set_mod_version,
            get_starter_mods,
            // Thunderstore
            search_thunderstore,
            get_thunderstore_detail,
            get_thunderstore_categories,
            install_thunderstore_mod,
            update_thunderstore_mod,
            get_installed_thunderstore_mods,
            uninstall_thunderstore_mod,
            // Trainer
            get_trainer_cheats,
            toggle_trainer_cheat,
            save_trainer_profile,
            load_trainer_profile,
            delete_trainer_profile,
            get_trainer_profiles,
            reset_trainer,
            get_trainer_multipliers,
            set_trainer_multiplier,
            // App logging
            get_logging_enabled,
            set_logging_enabled,
            read_app_log,
            clear_app_log,
            get_app_log_path,
            open_data_dir,
            open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
