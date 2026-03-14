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

export const checkModUpdates = (bepinexPath: string) =>
  invoke<UpdateCheckResult>("check_mod_updates", { bepinexPath });
export const installModUpdate = (
  bepinexPath: string,
  modName: string,
  downloadUrl: string,
  version: string
) =>
  invoke<string>("install_mod_update", { bepinexPath, modName, downloadUrl, version });
export const autoUpdateMods = (bepinexPath: string) =>
  invoke<UpdateCheckResult>("auto_update_mods", { bepinexPath });
export const setModVersion = (modName: string, version: string) =>
  invoke<void>("set_mod_version", { modName, version });
