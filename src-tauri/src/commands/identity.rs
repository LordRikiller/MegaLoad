use crate::commands::app_log::app_log;
use crate::commands::github::{github_get_file, github_put_file, github_list_dir};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::command;

// ---------------------------------------------------------------------------
// Shared identity — used by MegaBugs, MegaChat, and admin panel
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MegaLoadIdentity {
    pub user_id: String,
    pub display_name: String,
    /// Per-install HMAC secret (32 random bytes hex-encoded) used to sign
    /// write requests against MegaWorker. Generated lazily on first use via
    /// `ensure_hmac_secret()`. Existing identities without this field get
    /// one populated on first launch with v1.10.38+.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hmac_secret: Option<String>,
}

/// Backwards-compat alias — MegaBugs uses this type name
pub type UserIdentity = MegaLoadIdentity;

fn megaload_data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

const IDENTITY_FILE: &str = "megaload_identity.json";
const LEGACY_IDENTITY_FILE: &str = "megabugs_identity.json";

/// Auto-migrate old megabugs_identity.json → megaload_identity.json
fn migrate_identity_if_needed() {
    let dir = megaload_data_dir();
    let new_path = dir.join(IDENTITY_FILE);
    let old_path = dir.join(LEGACY_IDENTITY_FILE);
    if !new_path.exists() && old_path.exists() {
        if let Ok(data) = fs::read_to_string(&old_path) {
            let _ = fs::write(&new_path, &data);
            app_log("Migrated megabugs_identity.json → megaload_identity.json");
        }
    }
}

// ---------------------------------------------------------------------------
// Admin detection (reuse existing pattern)
// ---------------------------------------------------------------------------
pub fn is_admin() -> bool {
    std::env::var("USERPROFILE")
        .map(|home| {
            Path::new(&home)
                .join(".megaload")
                .join("megabugs-admin.key")
                .exists()
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// ISO timestamp helper
// ---------------------------------------------------------------------------
fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs_per_day: u64 = 86400;
    let days = now / secs_per_day;
    let time_of_day = now % secs_per_day;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md as i64 {
            m = i;
            break;
        }
        remaining -= md as i64;
    }
    let d = remaining + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m + 1,
        d,
        hours,
        minutes,
        seconds
    )
}

// ---------------------------------------------------------------------------
// Link code helpers — XXXX-XXXX-XXXX format, no ambiguous chars (0/O, 1/I/L)
// ---------------------------------------------------------------------------

const LINK_CODE_CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// Generate a 32-byte random secret, hex-encoded (64 chars).
/// Used as the HMAC key for signing MegaWorker write requests.
fn generate_hmac_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Get the current install's HMAC secret, generating + persisting one if the
/// identity file predates v1.10.38.
pub fn get_or_create_hmac_secret() -> Result<(String, String), String> {
    let mut identity = get_megaload_identity()?;
    if let Some(s) = identity.hmac_secret.clone() {
        return Ok((identity.user_id, s));
    }
    let secret = generate_hmac_secret();
    identity.hmac_secret = Some(secret.clone());
    let dir = megaload_data_dir();
    let _ = fs::create_dir_all(&dir);
    let json = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(dir.join(IDENTITY_FILE), &json)
        .map_err(|e| format!("Failed to persist hmac_secret: {}", e))?;
    let _ = fs::write(dir.join(LEGACY_IDENTITY_FILE), &json);
    app_log("Generated hmac_secret for existing identity");
    Ok((identity.user_id, secret))
}

/// Read the local admin key file contents. Used to sign owner-only Worker
/// requests. Returns None if not an admin.
pub fn read_admin_key() -> Option<String> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|home| Path::new(&home).join(".megaload").join("megabugs-admin.key"))
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn generate_link_code() -> String {
    // 12 chars in XXXX-XXXX-XXXX format — 30^12 = ~531 trillion combos
    let uuid = uuid::Uuid::new_v4();
    let bytes = uuid.as_bytes();
    let mut code = String::with_capacity(14);
    for i in 0..12 {
        let idx = (bytes[i] as usize) % LINK_CODE_CHARS.len();
        if i == 4 || i == 8 {
            code.push('-');
        }
        code.push(LINK_CODE_CHARS[idx] as char);
    }
    code
}

fn hash_link_code(code: &str) -> String {
    let normalized = code.trim().to_uppercase().replace('-', "");
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ---------------------------------------------------------------------------
// Server-side user registry types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserProfile {
    pub user_id: String,
    pub display_name: String,
    pub registered_at: String,
    pub last_active: String,
    pub is_admin: bool,
    pub flags: Vec<String>,
    pub megachat_usage: ChatUsageStats,
    pub megabugs_tickets: u32,
    #[serde(default)]
    pub link_code_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ChatUsageStats {
    pub total_tokens: u64,
    pub total_requests: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserIndex {
    pub users: Vec<UserIndexEntry>,
    pub last_updated: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserIndexEntry {
    pub user_id: String,
    pub display_name: String,
    pub is_admin: bool,
}

// ---------------------------------------------------------------------------
// Chat history types (stored server-side)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatHistoryFile {
    pub user_id: String,
    pub messages: Vec<ChatHistoryMessage>,
    pub last_updated: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatHistoryMessage {
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
}

// ---------------------------------------------------------------------------
// Tauri commands — Identity
// ---------------------------------------------------------------------------

/// Get current MegaLoad identity (local file).
#[command]
pub fn get_megaload_identity() -> Result<MegaLoadIdentity, String> {
    migrate_identity_if_needed();
    let path = megaload_data_dir().join(IDENTITY_FILE);
    let data = fs::read_to_string(&path)
        .map_err(|_| "No MegaLoad identity found — set up your display name first".to_string())?;
    serde_json::from_str(&data).map_err(|e| format!("Identity parse error: {}", e))
}

/// Check if a display name is available (case-insensitive uniqueness).
#[command]
pub fn check_username_available(display_name: String) -> Result<bool, String> {
    let name_lower = display_name.trim().to_lowercase();
    if name_lower.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }

    let index = load_user_index()?;
    let taken = index
        .users
        .iter()
        .any(|u| u.display_name.to_lowercase() == name_lower);
    Ok(!taken)
}

/// Result of identity creation — includes link code for new accounts.
#[derive(Serialize, Clone, Debug)]
pub struct IdentityResult {
    pub user_id: String,
    pub display_name: String,
    /// Only present on new account creation — save this to link other devices.
    pub link_code: Option<String>,
}

/// Set identity: validates, checks uniqueness, saves locally, registers server-side.
/// Returns the link code for new accounts (None for existing account updates).
#[command]
pub fn set_megaload_identity(display_name: String) -> Result<IdentityResult, String> {
    let trimmed = display_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }
    if trimmed.len() > 50 {
        return Err("Display name too long (max 50 characters)".to_string());
    }
    // Sanitize: alphanumeric, spaces, underscores, hyphens only
    if !trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-'))
    {
        return Err(
            "Display name can only contain letters, numbers, spaces, hyphens and underscores"
                .to_string(),
        );
    }

    let dir = megaload_data_dir();
    let path = dir.join(IDENTITY_FILE);

    // Preserve existing UUID if updating name
    let (user_id, is_existing) = if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(existing) = serde_json::from_str::<MegaLoadIdentity>(&data) {
            (existing.user_id, true)
        } else {
            (uuid::Uuid::new_v4().to_string(), false)
        }
    } else {
        (uuid::Uuid::new_v4().to_string(), false)
    };

    // Check uniqueness (case-insensitive, excluding own user_id)
    let index = load_user_index().unwrap_or_else(|_| UserIndex {
        users: vec![],
        last_updated: iso_now(),
    });
    let name_lower = trimmed.to_lowercase();
    let taken = index
        .users
        .iter()
        .any(|u| u.display_name.to_lowercase() == name_lower && u.user_id != user_id);
    if taken {
        return Err(format!(
            "Display name '{}' is already taken. Choose another.",
            trimmed
        ));
    }

    // Preserve existing hmac_secret on rename, generate fresh one on first creation
    let hmac_secret = if is_existing {
        fs::read_to_string(&path)
            .ok()
            .and_then(|d| serde_json::from_str::<MegaLoadIdentity>(&d).ok())
            .and_then(|id| id.hmac_secret)
            .or_else(|| Some(generate_hmac_secret()))
    } else {
        Some(generate_hmac_secret())
    };

    let identity = MegaLoadIdentity {
        user_id: user_id.clone(),
        display_name: trimmed.clone(),
        hmac_secret,
    };

    // Save locally
    let _ = fs::create_dir_all(&dir);
    let json = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&path, &json).map_err(|e| format!("Failed to save identity: {}", e))?;
    // Also keep legacy file in sync for compat
    let _ = fs::write(dir.join(LEGACY_IDENTITY_FILE), &json);

    // Register/update on server
    let admin = is_admin();
    let mut link_code: Option<String> = None;

    if is_existing {
        // Update existing user profile
        if let Ok((content, sha)) =
            github_get_file(&format!("users/{}.json", user_id))
        {
            if let Ok(mut profile) = serde_json::from_str::<UserProfile>(&content) {
                profile.display_name = trimmed.clone();
                profile.last_active = iso_now();
                profile.is_admin = admin;
                let json =
                    serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
                let _ = github_put_file(
                    &format!("users/{}.json", user_id),
                    json.as_bytes(),
                    &format!("Update user {}", trimmed),
                    Some(&sha),
                );
            }
        }
    } else {
        // Create new user profile with link code
        let code = generate_link_code();
        let code_hash = hash_link_code(&code);
        link_code = Some(code);

        let profile = UserProfile {
            user_id: user_id.clone(),
            display_name: trimmed.clone(),
            registered_at: iso_now(),
            last_active: iso_now(),
            is_admin: admin,
            flags: vec![],
            megachat_usage: ChatUsageStats::default(),
            megabugs_tickets: 0,
            link_code_hash: Some(code_hash),
        };
        let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
        let _ = github_put_file(
            &format!("users/{}.json", user_id),
            json.as_bytes(),
            &format!("Register user {}", trimmed),
            None,
        );
    }

    // Update user index
    update_user_index(&user_id, &trimmed, admin)?;

    app_log(&format!("MegaLoad identity set: {} ({})", trimmed, user_id));
    Ok(IdentityResult {
        user_id: identity.user_id,
        display_name: identity.display_name,
        link_code,
    })
}

/// Link an existing account by display name + link code.
#[command]
pub fn link_existing_account(display_name: String, link_code: String) -> Result<MegaLoadIdentity, String> {
    let trimmed = display_name.trim().to_string();
    let code = link_code.trim().to_string();
    if trimmed.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }
    if code.is_empty() {
        return Err("Link code is required".to_string());
    }

    // Look up user in index
    let index = load_user_index()?;
    let name_lower = trimmed.to_lowercase();
    let entry = index
        .users
        .iter()
        .find(|u| u.display_name.to_lowercase() == name_lower)
        .ok_or_else(|| format!("No account found with name '{}'", trimmed))?;

    // Verify link code against server-side hash
    let (profile_content, _sha) = github_get_file(&format!("users/{}.json", entry.user_id))
        .map_err(|_| "Failed to verify account".to_string())?;
    let profile: UserProfile = serde_json::from_str(&profile_content)
        .map_err(|_| "Failed to verify account".to_string())?;

    let stored_hash = profile
        .link_code_hash
        .as_deref()
        .ok_or_else(|| "This account has no link code set. Regenerate one from the original device in Settings.".to_string())?;

    let provided_hash = hash_link_code(&code);
    if provided_hash != stored_hash {
        return Err("Invalid link code. Check the code from your other device and try again.".to_string());
    }

    // Linking from another device — generate a fresh HMAC secret for this install.
    // Each device has its own secret registered with the Worker under the same user_id.
    let identity = MegaLoadIdentity {
        user_id: entry.user_id.clone(),
        display_name: entry.display_name.clone(),
        hmac_secret: Some(generate_hmac_secret()),
    };

    // Save locally
    let dir = megaload_data_dir();
    let _ = fs::create_dir_all(&dir);
    let json = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(dir.join(IDENTITY_FILE), &json)
        .map_err(|e| format!("Failed to save identity: {}", e))?;
    let _ = fs::write(dir.join(LEGACY_IDENTITY_FILE), &json);

    // Sync admin status from server — create local admin key if server says admin
    if profile.is_admin {
        let admin_dir = std::env::var("USERPROFILE")
            .map(|home| Path::new(&home).join(".megaload"))
            .ok();
        if let Some(admin_dir) = admin_dir {
            let _ = fs::create_dir_all(&admin_dir);
            let _ = fs::write(admin_dir.join("megabugs-admin.key"), "synced");
            app_log("Admin key synced from server profile");
        }
    }

    // Bump last_active on server
    let _ = bump_user_activity(&identity.user_id);

    app_log(&format!(
        "Linked existing account: {} ({})",
        identity.display_name, identity.user_id
    ));
    Ok(identity)
}

/// Regenerate link code for the current account. Returns the new plaintext code.
#[command]
pub fn regenerate_link_code() -> Result<String, String> {
    let identity = get_megaload_identity()?;
    let code = generate_link_code();
    let code_hash = hash_link_code(&code);

    let path = format!("users/{}.json", identity.user_id);
    let (content, sha) = github_get_file(&path)
        .map_err(|_| "Account not found on server".to_string())?;
    let mut profile: UserProfile = serde_json::from_str(&content)
        .map_err(|e| format!("Parse error: {}", e))?;

    profile.link_code_hash = Some(code_hash);
    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    github_put_file(&path, json.as_bytes(), "Regenerate link code", Some(&sha))?;

    app_log("Link code regenerated");
    Ok(code)
}

/// Clear local identity — effectively "logout".
#[command]
pub fn clear_megaload_identity() -> Result<(), String> {
    let dir = megaload_data_dir();
    let _ = fs::remove_file(dir.join(IDENTITY_FILE));
    let _ = fs::remove_file(dir.join(LEGACY_IDENTITY_FILE));
    app_log("MegaLoad identity cleared (logout)");
    Ok(())
}

/// Validate that the local identity is linked to a modern account (has link_code_hash).
/// Returns true if the identity is valid, false if it was cleared (legacy account).
/// Network failures return true (benefit of the doubt — don't penalize offline users).
#[command]
pub fn validate_identity() -> bool {
    let identity = match get_megaload_identity() {
        Ok(id) => id,
        Err(_) => return true, // No identity = nothing to validate
    };

    // Try to check server-side profile
    match github_get_file(&format!("users/{}.json", identity.user_id)) {
        Ok((content, _)) => {
            if let Ok(profile) = serde_json::from_str::<UserProfile>(&content) {
                if profile.link_code_hash.is_none() {
                    // Legacy account — clear local identity
                    app_log(&format!(
                        "Legacy account detected for {} — clearing identity for re-registration",
                        identity.display_name
                    ));
                    let _ = clear_megaload_identity();
                    return false;
                }
            }
            true
        }
        Err(_) => true, // Network error — don't clear
    }
}

/// Check if the current user is admin (local key file check).
#[command]
pub fn check_is_admin() -> bool {
    is_admin()
}

// ---------------------------------------------------------------------------
// User index helpers
// ---------------------------------------------------------------------------

fn load_user_index() -> Result<UserIndex, String> {
    match github_get_file("users/index.json") {
        Ok((content, _sha)) => {
            serde_json::from_str(&content).map_err(|e| format!("User index parse error: {}", e))
        }
        Err(e) if e.contains("404") => Ok(UserIndex {
            users: vec![],
            last_updated: iso_now(),
        }),
        Err(e) => Err(e),
    }
}

fn update_user_index(user_id: &str, display_name: &str, is_admin: bool) -> Result<(), String> {
    let (mut index, sha) = match github_get_file("users/index.json") {
        Ok((content, sha)) => {
            let idx: UserIndex = serde_json::from_str(&content)
                .unwrap_or_else(|_| UserIndex {
                    users: vec![],
                    last_updated: iso_now(),
                });
            (idx, Some(sha))
        }
        Err(_) => (
            UserIndex {
                users: vec![],
                last_updated: iso_now(),
            },
            None,
        ),
    };

    // Upsert user in index
    if let Some(entry) = index.users.iter_mut().find(|u| u.user_id == user_id) {
        entry.display_name = display_name.to_string();
        entry.is_admin = is_admin;
    } else {
        index.users.push(UserIndexEntry {
            user_id: user_id.to_string(),
            display_name: display_name.to_string(),
            is_admin,
        });
    }
    index.last_updated = iso_now();

    let json = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
    github_put_file(
        "users/index.json",
        json.as_bytes(),
        &format!("Update user index — {}", display_name),
        sha.as_deref(),
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Ban system
// ---------------------------------------------------------------------------

/// Check if the current user is banned.
#[command]
pub fn check_user_banned() -> Result<bool, String> {
    let identity = get_megaload_identity()?;
    match github_get_file(&format!("users/{}.json", identity.user_id)) {
        Ok((content, _)) => {
            let profile: UserProfile =
                serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))?;
            Ok(profile.flags.contains(&"banned".to_string()))
        }
        Err(_) => Ok(false), // No server profile yet = not banned
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — Admin moderation
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct AdminUserInfo {
    pub user_id: String,
    pub display_name: String,
    pub registered_at: String,
    pub last_active: String,
    pub is_admin: bool,
    pub flags: Vec<String>,
    pub megachat_usage: ChatUsageStats,
    pub megabugs_tickets: u32,
}

/// List all registered users (admin only).
#[command]
pub fn admin_list_users() -> Result<Vec<AdminUserInfo>, String> {
    if !is_admin() {
        return Err("Admin access required".to_string());
    }

    let listing = match github_list_dir("users") {
        Ok(l) => l,
        Err(e) if e.contains("404") => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut users = Vec::new();
    for (path, _sha) in &listing {
        if path.ends_with("index.json") {
            continue;
        }
        if let Ok((content, _)) = github_get_file(path) {
            if let Ok(profile) = serde_json::from_str::<UserProfile>(&content) {
                users.push(AdminUserInfo {
                    user_id: profile.user_id,
                    display_name: profile.display_name,
                    registered_at: profile.registered_at,
                    last_active: profile.last_active,
                    is_admin: profile.is_admin,
                    flags: profile.flags,
                    megachat_usage: profile.megachat_usage,
                    megabugs_tickets: profile.megabugs_tickets,
                });
            }
        }
    }
    Ok(users)
}

/// Ban a user (admin only).
#[command]
pub fn admin_ban_user(user_id: String) -> Result<(), String> {
    if !is_admin() {
        return Err("Admin access required".to_string());
    }

    let path = format!("users/{}.json", user_id);
    let (content, sha) =
        github_get_file(&path).map_err(|_| "User not found".to_string())?;
    let mut profile: UserProfile =
        serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))?;

    if profile.is_admin {
        return Err("Cannot ban an admin".to_string());
    }
    if !profile.flags.contains(&"banned".to_string()) {
        profile.flags.push("banned".to_string());
    }

    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    github_put_file(
        &path,
        json.as_bytes(),
        &format!("Ban user {}", profile.display_name),
        Some(&sha),
    )?;

    app_log(&format!(
        "Admin: Banned user {} ({})",
        profile.display_name, user_id
    ));
    Ok(())
}

/// Unban a user (admin only).
#[command]
pub fn admin_unban_user(user_id: String) -> Result<(), String> {
    if !is_admin() {
        return Err("Admin access required".to_string());
    }

    let path = format!("users/{}.json", user_id);
    let (content, sha) =
        github_get_file(&path).map_err(|_| "User not found".to_string())?;
    let mut profile: UserProfile =
        serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))?;

    profile.flags.retain(|f| f != "banned");

    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    github_put_file(
        &path,
        json.as_bytes(),
        &format!("Unban user {}", profile.display_name),
        Some(&sha),
    )?;

    app_log(&format!(
        "Admin: Unbanned user {} ({})",
        profile.display_name, user_id
    ));
    Ok(())
}

/// Get a user's chat history (admin only).
#[command]
pub fn admin_get_user_chat_history(user_id: String) -> Result<ChatHistoryFile, String> {
    if !is_admin() {
        return Err("Admin access required".to_string());
    }

    let path = format!("chat-history/{}.json", user_id);
    let (content, _) = github_get_file(&path)
        .map_err(|_| "No chat history found for this user".to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))
}

// ---------------------------------------------------------------------------
// Tauri commands — Chat history sync
// ---------------------------------------------------------------------------

/// Load the current user's chat history from the server.
#[command]
pub fn chat_load_history() -> Result<ChatHistoryFile, String> {
    let identity = get_megaload_identity()?;
    let path = format!("chat-history/{}.json", identity.user_id);
    match github_get_file(&path) {
        Ok((content, _)) => {
            serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))
        }
        Err(_) => Ok(ChatHistoryFile {
            user_id: identity.user_id,
            messages: vec![],
            last_updated: iso_now(),
        }),
    }
}

/// Save the current user's chat history to the server.
/// Keeps only the last 50 messages.
#[command]
pub fn chat_save_history(messages: Vec<ChatHistoryMessage>) -> Result<(), String> {
    let identity = get_megaload_identity()?;
    let path = format!("chat-history/{}.json", identity.user_id);

    // Cap at 50 messages
    let capped: Vec<ChatHistoryMessage> = if messages.len() > 50 {
        messages[messages.len() - 50..].to_vec()
    } else {
        messages
    };

    let history = ChatHistoryFile {
        user_id: identity.user_id.clone(),
        messages: capped,
        last_updated: iso_now(),
    };

    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;

    // Try update existing, fall back to create
    let sha = match github_get_file(&path) {
        Ok((_, sha)) => Some(sha),
        Err(_) => None,
    };

    github_put_file(
        &path,
        json.as_bytes(),
        &format!("Chat history — {}", identity.display_name),
        sha.as_deref(),
    )?;

    // Also bump last_active + usage on user profile (best effort)
    let _ = bump_user_activity(&identity.user_id);

    Ok(())
}

/// Bump last_active on user profile (best effort, no error propagation).
fn bump_user_activity(user_id: &str) -> Result<(), String> {
    let path = format!("users/{}.json", user_id);
    let (content, sha) = github_get_file(&path)?;
    let mut profile: UserProfile =
        serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))?;
    profile.last_active = iso_now();

    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    github_put_file(&path, json.as_bytes(), "Bump activity", Some(&sha))?;
    Ok(())
}
