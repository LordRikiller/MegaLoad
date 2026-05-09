mod commands;
mod models;

use commands::app_log::*;
use commands::bepinex::*;
use commands::bugs::*;
use commands::chat::*;
use commands::config::*;
use commands::identity::*;
use commands::import::*;
use commands::launcher::*;
use commands::logs::*;
use commands::mods::*;
use commands::player_data::*;
use commands::player_data::PlayerDataWatcherState;
use commands::profiles::*;
use commands::sync::*;
use commands::sync_log::*;
use commands::thunderstore::*;
use commands::trainer::*;
use commands::updater::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::app_log::init_logging();
    commands::chat::init_megachat_debug();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            // Register this install's HMAC secret with MegaWorker on launch.
            // Idempotent — re-registers existing user_id with possibly new secret.
            // Spawned off the main thread so a slow/down Worker doesn't block UI.
            std::thread::spawn(|| {
                commands::worker_auth::register_with_worker_best_effort();
            });
            Ok(())
        })
        .manage(ConfigWatcherState {
            watcher: std::sync::Mutex::new(None),
        })
        .manage(PlayerDataWatcherState {
            watcher: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // Profiles
            get_profiles,
            create_profile,
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
            delete_config_file,
            start_config_watcher,
            stop_config_watcher,
            get_mega_debug_status,
            toggle_all_mega_debug,
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
            check_game_status,
            start_steam,
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
            deploy_bundled_plugins,
            sync_install_all_mods,
            get_update_log,
            record_app_update,
            // Thunderstore
            search_thunderstore,
            get_thunderstore_detail,
            get_thunderstore_categories,
            install_thunderstore_mod,
            update_thunderstore_mod,
            get_installed_thunderstore_mods,
            uninstall_thunderstore_mod,
            sync_install_thunderstore_mods,
            check_thunderstore_updates,
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
            get_diagnostic_logs_path,
            set_diagnostic_logs_path,
            log_from_frontend,
            open_data_dir,
            open_folder,
            // Player data
            list_characters,
            read_character,
            get_character_portrait_png,
            start_player_data_watcher,
            stop_player_data_watcher,
            // MegaBugs
            check_megabugs_access,
            get_megabugs_identity,
            set_megabugs_identity,
            fetch_tickets,
            fetch_ticket_detail,
            submit_ticket,
            reply_to_ticket,
            update_ticket_status,
            update_ticket_priority,
            delete_ticket,
            fetch_attachment,
            download_ticket_log,
            get_megabugs_role,
            list_collaborators,
            add_collaborator,
            remove_collaborator,
            // MegaChat
            chat_check_available,
            chat_send_message,
            chat_get_usage,
            chat_reset_usage,
            chat_get_debug_enabled,
            chat_set_debug_enabled,
            chat_save_api_key,
            chat_clear_api_key,
            chat_get_api_key_status,
            // Identity & user management
            get_megaload_identity,
            set_megaload_identity,
            link_existing_account,
            clear_megaload_identity,
            regenerate_link_code,
            check_username_available,
            check_is_admin,
            validate_identity,
            check_user_banned,
            chat_load_history,
            chat_save_history,
            // Admin moderation
            admin_list_users,
            admin_ban_user,
            admin_unban_user,
            admin_get_user_chat_history,
            // Cloud sync
            sync_get_status,
            sync_set_enabled,
            sync_set_auto_sync,
            sync_get_settings,
            sync_push_profile,
            sync_push_all,
            sync_pull_manifest,
            sync_pull_profile_state,
            sync_pull_configs,
            sync_pull_profile,
            sync_pull_bundle,
            sync_check_remote_changed,
            sync_push_player_data,
            sync_pull_player_data,
            sync_reconcile_player_data,
            sync_delete_player_data,
            sync_push_mega_lists,
            sync_pull_mega_lists,
            sync_reconcile_mega_lists,
            // Sync event log
            read_sync_events,
            clear_sync_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
