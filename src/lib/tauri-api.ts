import { invoke } from "@tauri-apps/api/core";

// --- Profile types & commands ---

export interface Profile {
  id: string;
  name: string;
  created: string;
  last_used: string;
  bepinex_path: string;
}

export interface ProfileStore {
  active_profile: string | null;
  profiles: Profile[];
}

export const getProfiles = () => invoke<ProfileStore>("get_profiles");
export const createProfile = (name: string) =>
  invoke<Profile>("create_profile", { name });
export const deleteProfile = (id: string) =>
  invoke<void>("delete_profile", { id });
export const setActiveProfile = (id: string) =>
  invoke<void>("set_active_profile", { id });
export const renameProfile = (id: string, newName: string) =>
  invoke<void>("rename_profile", { id, newName });
export const createProfileLinked = (name: string, bepinexPath: string) =>
  invoke<Profile>("create_profile_linked", { name, bepinexPath });
export const getProfilePath = (id: string) =>
  invoke<string>("get_profile_path", { id });

// --- Mod types & commands ---

export interface ModInfo {
  name: string;
  file_name: string;
  folder: string;
  enabled: boolean;
  version: string | null;
  guid: string | null;
  description: string | null;
}

export const getMods = (bepinexPath: string) =>
  invoke<ModInfo[]>("get_mods", { bepinexPath });
export const toggleMod = (
  bepinexPath: string,
  folder: string,
  fileName: string,
  enable: boolean
) => invoke<void>("toggle_mod", { bepinexPath, folder, fileName, enable });
export const deleteMod = (
  bepinexPath: string,
  folder: string,
  fileName: string,
  enabled: boolean
) => invoke<void>("delete_mod", { bepinexPath, folder, fileName, enabled });
export const installMod = (bepinexPath: string, sourcePath: string) =>
  invoke<string>("install_mod", { bepinexPath, sourcePath });

// --- BepInEx validation ---

export interface BepInExStatus {
  has_core: boolean;
  has_plugins: boolean;
  has_config: boolean;
  plugin_count: number;
  path_exists: boolean;
}

export const validateBepinex = (bepinexPath: string) =>
  invoke<BepInExStatus>("validate_bepinex", { bepinexPath });

// --- Config types & commands ---

export interface ConfigEntry {
  key: string;
  value: string;
  default_value: string | null;
  description: string | null;
  value_type: string | null;
  acceptable_values: string[] | null;
}

export interface ConfigSection {
  name: string;
  entries: ConfigEntry[];
}

export interface ConfigFile {
  file_name: string;
  mod_name: string;
  path: string;
  sections: ConfigSection[];
}

export const getConfigFiles = (bepinexPath: string) =>
  invoke<ConfigFile[]>("get_config_files", { bepinexPath });
export const saveConfigValue = (
  configPath: string,
  section: string,
  key: string,
  value: string
) => invoke<void>("save_config_value", { configPath, section, key, value });
export const resetConfigFile = (configPath: string) =>
  invoke<ConfigFile>("reset_config_file", { configPath });
export const cleanOrphanConfigs = (bepinexPath: string) =>
  invoke<string[]>("clean_orphan_configs", { bepinexPath });

// --- Log types & commands ---

export interface LogLine {
  text: string;
  level: string;
}

export const readLogFile = (bepinexPath: string, maxLines?: number) =>
  invoke<LogLine[]>("read_log_file", { bepinexPath, maxLines });
export const readLogTail = (bepinexPath: string, tailBytes?: number) =>
  invoke<LogLine[]>("read_log_tail", { bepinexPath, tailBytes });
export const getLogSize = (bepinexPath: string) =>
  invoke<number>("get_log_size", { bepinexPath });
export const clearLog = (bepinexPath: string) =>
  invoke<void>("clear_log", { bepinexPath });
export const saveLogFile = (bepinexPath: string, destPath: string) =>
  invoke<void>("save_log_file", { bepinexPath, destPath });
export const saveTextFile = (destPath: string, content: string) =>
  invoke<void>("save_text_file", { destPath, content });

// --- Import commands ---

export const importR2modmanProfile = (
  profileName: string,
  r2ProfilePath: string
) => invoke<string>("import_r2modman_profile", { profileName, r2ProfilePath });

// --- Launcher commands ---

export const detectValheimPath = () =>
  invoke<string>("detect_valheim_path");
export const detectR2modmanProfiles = () =>
  invoke<[string, string][]>("detect_r2modman_profiles");
export const launchValheim = (valheimPath: string, bepinexPath: string) =>
  invoke<void>("launch_valheim", { valheimPath, bepinexPath });

// --- BepInEx bootstrap commands ---

export const findBepinexSources = (valheimPath?: string) =>
  invoke<[string, string][]>("find_bepinex_sources", { valheimPath: valheimPath ?? null });
export const installBepinexCore = (sourceCorePath: string, profileBepinexPath: string) =>
  invoke<void>("install_bepinex_core", { sourceCorePath, profileBepinexPath });
export const ensureDoorstop = (valheimPath: string) =>
  invoke<boolean>("ensure_doorstop", { valheimPath });
export const downloadBepinex = (valheimPath: string, profileBepinexPath: string) =>
  invoke<string>("download_bepinex", { valheimPath, profileBepinexPath });

// --- Mod updater types & commands ---

export interface ModUpdateInfo {
  name: string;
  installed_version: string | null;
  latest_version: string | null;
  has_update: boolean;
  download_url: string | null;
  status: string; // "up-to-date" | "update-available" | "not-installed" | "error" | "updated"
  error: string | null;
}

export interface UpdateCheckResult {
  mods: ModUpdateInfo[];
  total_updates: number;
  from_cache: boolean;
}

export interface StarterMod {
  name: string;
  version: string;
  download_url: string;
  description: string | null;
}

export const getStarterMods = () =>
  invoke<StarterMod[]>("get_starter_mods");
export const checkModUpdates = (bepinexPath: string, force = false) =>
  invoke<UpdateCheckResult>("check_mod_updates", { bepinexPath, force });
export const installModUpdate = (
  bepinexPath: string,
  modName: string,
  downloadUrl: string,
  version: string
) =>
  invoke<string>("install_mod_update", { bepinexPath, modName, downloadUrl, version });
export const autoUpdateMods = (bepinexPath: string, force = false) =>
  invoke<UpdateCheckResult>("auto_update_mods", { bepinexPath, force });
export const setModVersion = (modName: string, version: string) =>
  invoke<void>("set_mod_version", { modName, version });

// --- App logging commands ---

export const getLoggingEnabled = () =>
  invoke<boolean>("get_logging_enabled");
export const setLoggingEnabled = (enabled: boolean) =>
  invoke<void>("set_logging_enabled", { enabled });
export const readAppLog = (tailLines?: number) =>
  invoke<string>("read_app_log", { tailLines });
export const clearAppLog = () =>
  invoke<void>("clear_app_log");
export const getAppLogPath = () =>
  invoke<string>("get_app_log_path");
export const openDataDir = () =>
  invoke<void>("open_data_dir");
export const openFolder = (path: string) =>
  invoke<void>("open_folder", { path });

// --- Thunderstore types & commands ---

export interface ThunderstoreListItem {
  full_name: string;
  name: string;
  owner: string;
  version: string;
  description: string;
  downloads: number;
  rating: number;
  icon: string;
  categories: string[];
  is_deprecated: boolean;
  date_updated: string;
  dependency_count: number;
}

export interface ThunderstoreSearchResult {
  items: ThunderstoreListItem[];
  total: number;
  page: number;
  per_page: number;
}

export interface ThunderstoreVersionDetail {
  version_number: string;
  download_url: string;
  downloads: number;
  description: string;
  dependencies: string[];
  date_created: string;
  file_size: number;
}

export interface ThunderstoreModDetail {
  full_name: string;
  name: string;
  owner: string;
  description: string;
  icon: string;
  rating: number;
  is_deprecated: boolean;
  categories: string[];
  website_url: string;
  versions: ThunderstoreVersionDetail[];
}

export interface InstalledTsMod {
  full_name: string;
  version: string;
  folder_name: string;
  installed_at: number;
}

export const searchThunderstore = (
  query?: string,
  category?: string,
  page?: number,
  perPage?: number
) =>
  invoke<ThunderstoreSearchResult>("search_thunderstore", {
    query: query ?? null,
    category: category ?? null,
    page: page ?? null,
    perPage: perPage ?? null,
  });

export const getThunderstoreDetail = (fullName: string) =>
  invoke<ThunderstoreModDetail>("get_thunderstore_detail", { fullName });

export const getThunderstoreCategories = () =>
  invoke<string[]>("get_thunderstore_categories");

export const installThunderstoreMod = (
  bepinexPath: string,
  fullName: string,
  downloadUrl: string,
  version: string
) =>
  invoke<string>("install_thunderstore_mod", {
    bepinexPath,
    fullName,
    downloadUrl,
    version,
  });

export const updateThunderstoreMod = (
  bepinexPath: string,
  fullName: string,
  downloadUrl: string,
  version: string,
  folderName: string
) =>
  invoke<string>("update_thunderstore_mod", {
    bepinexPath,
    fullName,
    downloadUrl,
    version,
    folderName,
  });

export const getInstalledThunderstoreMods = (bepinexPath: string) =>
  invoke<InstalledTsMod[]>("get_installed_thunderstore_mods", { bepinexPath });

export const uninstallThunderstoreMod = (
  bepinexPath: string,
  fullName: string
) =>
  invoke<void>("uninstall_thunderstore_mod", { bepinexPath, fullName });

// --- Trainer types & commands ---

export interface CheatDef {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

export interface SavedTrainerProfile {
  name: string;
  cheats: { id: string; enabled: boolean }[];
  created_at: number;
}

export const getTrainerCheats = (bepinexPath: string) =>
  invoke<CheatDef[]>("get_trainer_cheats", { bepinexPath });

export const toggleTrainerCheat = (
  bepinexPath: string,
  cheatId: string,
  enabled: boolean
) =>
  invoke<void>("toggle_trainer_cheat", { bepinexPath, cheatId, enabled });

export const saveTrainerProfile = (bepinexPath: string, name: string) =>
  invoke<void>("save_trainer_profile", { bepinexPath, name });

export const loadTrainerProfile = (bepinexPath: string, name: string) =>
  invoke<CheatDef[]>("load_trainer_profile", { bepinexPath, name });

export const deleteTrainerProfile = (bepinexPath: string, name: string) =>
  invoke<void>("delete_trainer_profile", { bepinexPath, name });

export const getTrainerProfiles = (bepinexPath: string) =>
  invoke<SavedTrainerProfile[]>("get_trainer_profiles", { bepinexPath });

export const resetTrainer = (bepinexPath: string) =>
  invoke<void>("reset_trainer", { bepinexPath });

export const getTrainerMultipliers = (bepinexPath: string) =>
  invoke<[number, number]>("get_trainer_multipliers", { bepinexPath });

export const setTrainerMultiplier = (
  bepinexPath: string,
  kind: string,
  value: number
) =>
  invoke<void>("set_trainer_multiplier", { bepinexPath, kind, value });
