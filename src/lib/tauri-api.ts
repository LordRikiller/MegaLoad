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
export const deleteConfigFile = (configPath: string) =>
  invoke<void>("delete_config_file", { configPath });
export const startConfigWatcher = (bepinexPath: string) =>
  invoke<void>("start_config_watcher", { bepinexPath });
export const stopConfigWatcher = () =>
  invoke<void>("stop_config_watcher");

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

export interface GameStatus {
  valheim_running: boolean;
  steam_running: boolean;
  cloud_syncing: boolean;
  ready_to_launch: boolean;
  status_text: string;
}

export const detectValheimPath = () =>
  invoke<string>("detect_valheim_path");
export const detectR2modmanProfiles = () =>
  invoke<[string, string][]>("detect_r2modman_profiles");
export const launchValheim = (valheimPath: string, bepinexPath: string) =>
  invoke<void>("launch_valheim", { valheimPath, bepinexPath });
export const checkGameStatus = (valheimPath: string) =>
  invoke<GameStatus>("check_game_status", { valheimPath });
export const startSteam = (valheimPath: string) =>
  invoke<string>("start_steam", { valheimPath });

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
export const setModVersion = (bepinexPath: string, modName: string, version: string) =>
  invoke<void>("set_mod_version", { bepinexPath, modName, version });
export const deployBundledPlugins = (bepinexPath: string) =>
  invoke<number>("deploy_bundled_plugins", { bepinexPath });

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

// --- Player Data types & commands ---

export interface CharacterSummary {
  name: string;
  path: string;
  modified: string;
  size: number;
}

export interface SkillData {
  id: number;
  name: string;
  level: number;
  accumulator: number;
}

export interface InventoryItem {
  name: string;
  stack: number;
  durability: number;
  grid_x: number;
  grid_y: number;
  equipped: boolean;
  quality: number;
  variant: number;
  crafter_name: string;
  world_level: number;
}

export interface StationKnowledge {
  name: string;
  level: number;
}

export interface FoodData {
  name: string;
  time: number;
  health: number;
  stamina: number;
}

export interface KnownText {
  key: string;
  value: string;
}

export interface CharacterData {
  name: string;
  version: number;
  kills: number;
  deaths: number;
  crafts: number;
  builds: number;
  boss_kills: number;
  player_id: number;
  guardian_power: string;
  max_hp: number;
  hp: number;
  stamina: number;
  max_eitr: number;
  model: number;
  beard: string;
  hair: string;
  skin_color: [number, number, number];
  hair_color: [number, number, number];
  known_biomes: string[];
  skills: SkillData[];
  inventory: InventoryItem[];
  known_recipes: string[];
  known_stations: StationKnowledge[];
  known_materials: string[];
  trophies: string[];
  uniques: string[];
  active_foods: FoodData[];
  known_texts: KnownText[];
  world_count: number;
}

export const listCharacters = () =>
  invoke<CharacterSummary[]>("list_characters");

export const readCharacter = (path: string) =>
  invoke<CharacterData>("read_character", { path });

export const startPlayerDataWatcher = () =>
  invoke<void>("start_player_data_watcher");

export const stopPlayerDataWatcher = () =>
  invoke<void>("stop_player_data_watcher");

// ---------------------------------------------------------------------------
// MegaBugs
// ---------------------------------------------------------------------------

export interface MegaBugsAccess {
  enabled: boolean;
  is_admin: boolean;
}

export interface UserIdentity {
  user_id: string;
  display_name: string;
}

export interface ImageData {
  filename: string;
  base64_data: string;
}

export interface TicketMessage {
  id: string;
  author_id: string;
  author_name: string;
  text: string;
  images: string[];
  timestamp: string;
  is_admin: boolean;
}

export interface SystemInfo {
  megaload_version: string;
  os: string;
  profile_name: string;
  installed_mods: string[];
}

export interface TicketSummary {
  id: string;
  type: string;
  title: string;
  status: string;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  labels: string[];
}

export interface Ticket {
  id: string;
  type: string;
  title: string;
  status: string;
  labels: string[];
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  system_info: SystemInfo;
  messages: TicketMessage[];
  has_log: boolean;
}

export const checkMegabugsAccess = (bepinexPath: string) =>
  invoke<MegaBugsAccess>("check_megabugs_access", { bepinexPath });

export const getMegabugsIdentity = () =>
  invoke<UserIdentity>("get_megabugs_identity");

export const setMegabugsIdentity = (displayName: string) =>
  invoke<UserIdentity>("set_megabugs_identity", { displayName });

export const fetchTickets = (userId?: string) =>
  invoke<TicketSummary[]>("fetch_tickets", { userId: userId ?? null });

export const fetchTicketDetail = (ticketId: string) =>
  invoke<Ticket>("fetch_ticket_detail", { ticketId });

export const submitTicket = (
  ticketType: string,
  title: string,
  description: string,
  images: ImageData[],
  bepinexPath: string,
  userId: string,
  userName: string,
) => invoke<TicketSummary>("submit_ticket", { ticketType, title, description, images, bepinexPath, userId, userName });

export const replyToTicket = (
  ticketId: string,
  text: string,
  images: ImageData[],
  userId: string,
  userName: string,
  isAdmin: boolean,
) => invoke<void>("reply_to_ticket", { ticketId, text, images, userId, userName, isAdmin });

export const updateTicketStatus = (ticketId: string, status: string, labels: string[]) =>
  invoke<void>("update_ticket_status", { ticketId, status, labels });

export const deleteTicket = (ticketId: string) =>
  invoke<void>("delete_ticket", { ticketId });

export const fetchAttachment = (path: string) =>
  invoke<string>("fetch_attachment", { path });

// ---------------------------------------------------------------------------
// MegaChat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DailyUsage {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  request_count: number;
}

export interface ChatResponse {
  text: string;
  input_tokens: number;
  output_tokens: number;
  daily_usage: DailyUsage;
}

export const chatSendMessage = (messages: ChatMessage[], staticContext: string, dynamicContext: string) =>
  invoke<ChatResponse>("chat_send_message", { messages, staticContext, dynamicContext });

export const chatGetUsage = () =>
  invoke<DailyUsage>("chat_get_usage");

export const chatResetUsage = () =>
  invoke<void>("chat_reset_usage");

export const chatGetDebugEnabled = () =>
  invoke<boolean>("chat_get_debug_enabled");

export const chatSetDebugEnabled = (enabled: boolean) =>
  invoke<void>("chat_set_debug_enabled", { enabled });

// ---------------------------------------------------------------------------
// Identity & User Management
// ---------------------------------------------------------------------------

export interface MegaLoadIdentity {
  user_id: string;
  display_name: string;
}

export interface ChatUsageStats {
  total_tokens: number;
  total_requests: number;
}

export interface AdminUserInfo {
  user_id: string;
  display_name: string;
  registered_at: string;
  last_active: string;
  is_admin: boolean;
  flags: string[];
  megachat_usage: ChatUsageStats;
  megabugs_tickets: number;
}

export interface ChatHistoryMessage {
  role: string;
  content: string;
  timestamp: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ChatHistoryFile {
  user_id: string;
  messages: ChatHistoryMessage[];
  last_updated: string;
}

export const getMegaloadIdentity = () =>
  invoke<MegaLoadIdentity>("get_megaload_identity");

export const setMegaloadIdentity = (displayName: string) =>
  invoke<MegaLoadIdentity>("set_megaload_identity", { displayName });

export const checkUsernameAvailable = (displayName: string) =>
  invoke<boolean>("check_username_available", { displayName });

export const checkIsAdmin = () =>
  invoke<boolean>("check_is_admin");

export const checkUserBanned = () =>
  invoke<boolean>("check_user_banned");

export const chatLoadHistory = () =>
  invoke<ChatHistoryFile>("chat_load_history");

export const chatSaveHistory = (messages: ChatHistoryMessage[]) =>
  invoke<void>("chat_save_history", { messages });

// Admin moderation
export const adminListUsers = () =>
  invoke<AdminUserInfo[]>("admin_list_users");

export const adminBanUser = (userId: string) =>
  invoke<void>("admin_ban_user", { userId });

export const adminUnbanUser = (userId: string) =>
  invoke<void>("admin_unban_user", { userId });

export const adminGetUserChatHistory = (userId: string) =>
  invoke<ChatHistoryFile>("admin_get_user_chat_history", { userId });
