use crate::commands::app_log::app_log;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

// ---------------------------------------------------------------------------
// GitHub token — XOR-obfuscated at compile time
// Set MEGABUGS_GITHUB_TOKEN env var before building, or leave blank for dev.
// ---------------------------------------------------------------------------
const OBFUSCATION_KEY: u8 = 0xAB;

fn get_github_token() -> Option<String> {
    let obfuscated: &[u8] = match option_env!("MEGABUGS_TOKEN_OBF") {
        Some(s) => s.as_bytes(),
        None => return None,
    };
    // Decode from hex, then XOR to recover the token
    let bytes: Vec<u8> = (0..obfuscated.len() / 2)
        .filter_map(|i| u8::from_str_radix(&String::from_utf8_lossy(&obfuscated[i * 2..i * 2 + 2]), 16).ok())
        .map(|b| b ^ OBFUSCATION_KEY)
        .collect();
    String::from_utf8(bytes).ok()
}

/// Fallback: read token from a local file (dev convenience)
fn get_github_token_dev() -> Option<String> {
    let home = std::env::var("USERPROFILE").ok()?;
    let path = Path::new(&home).join(".megaload").join("megabugs-token");
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn github_token() -> Result<String, String> {
    get_github_token()
        .or_else(get_github_token_dev)
        .ok_or_else(|| "MegaBugs: No GitHub token configured".to_string())
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
const REPO: &str = "ccmrik/MegaBugs";
const USER_AGENT: &str = concat!("MegaLoad/", env!("CARGO_PKG_VERSION"));

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MegaBugsAccess {
    pub enabled: bool,
    pub is_admin: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserIdentity {
    pub user_id: String,
    pub display_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TicketSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub ticket_type: String,
    pub title: String,
    pub status: String,
    pub author_id: String,
    pub author_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
    pub labels: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TicketMessage {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    pub text: String,
    pub images: Vec<String>,
    pub timestamp: String,
    pub is_admin: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemInfo {
    pub megaload_version: String,
    pub os: String,
    pub profile_name: String,
    pub installed_mods: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Ticket {
    pub id: String,
    #[serde(rename = "type")]
    pub ticket_type: String,
    pub title: String,
    pub status: String,
    pub labels: Vec<String>,
    pub author_id: String,
    pub author_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub system_info: SystemInfo,
    pub messages: Vec<TicketMessage>,
    pub has_log: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TicketIndex {
    pub tickets: Vec<TicketSummary>,
    pub last_updated: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ImageData {
    pub filename: String,
    pub base64_data: String,
}

// ---------------------------------------------------------------------------
// GitHub Contents API helpers
// ---------------------------------------------------------------------------

/// Response from GitHub Contents API GET
#[derive(Deserialize, Debug)]
struct GitHubContent {
    sha: String,
    content: Option<String>,
}

/// Read a file from the repo. Returns (content_string, sha).
fn github_get_file(path: &str) -> Result<(String, String), String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API GET failed for {}: {}", path, e))?;

    let body = resp.into_string().map_err(|e| format!("Read error: {}", e))?;
    let gc: GitHubContent =
        serde_json::from_str(&body).map_err(|e| format!("Parse error for {}: {}", path, e))?;

    let raw = gc.content.unwrap_or_default().replace('\n', "").replace('\r', "");
    let decoded = B64.decode(&raw).map_err(|e| format!("Base64 decode failed: {}", e))?;
    let text = String::from_utf8(decoded).map_err(|e| format!("UTF-8 error: {}", e))?;
    Ok((text, gc.sha))
}

/// Create or update a file in the repo.
/// If `sha` is Some, it's an update; otherwise it's a create.
fn github_put_file(path: &str, content: &[u8], message: &str, sha: Option<&str>) -> Result<String, String> {
    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let encoded = B64.encode(content);

    let mut body = serde_json::json!({
        "message": message,
        "content": encoded,
    });
    if let Some(s) = sha {
        body["sha"] = serde_json::Value::String(s.to_string());
    }

    let resp = crate::commands::http::agent()
        .put(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .send_string(&body.to_string())
        .map_err(|e| format!("GitHub API PUT failed for {}: {}", path, e))?;

    let resp_body = resp.into_string().map_err(|e| format!("Read error: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&resp_body).map_err(|e| format!("Parse error: {}", e))?;
    let new_sha = parsed["content"]["sha"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(new_sha)
}

// ---------------------------------------------------------------------------
// App data dir helper
// ---------------------------------------------------------------------------
fn megabugs_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("MegaLoad")
}

fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as ISO 8601 — manual since we don't have chrono
    let secs_per_day: u64 = 86400;
    let days = now / secs_per_day;
    let time_of_day = now % secs_per_day;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Days since epoch to date (simplified Gregorian)
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
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
// Commands
// ---------------------------------------------------------------------------

/// Check if MegaBugs is accessible (DLL present + admin status).
#[command]
pub fn check_megabugs_access(bepinex_path: String) -> Result<MegaBugsAccess, String> {
    let plugins = Path::new(&bepinex_path).join("plugins");
    let mut found = false;

    // Check loose DLL: plugins/MegaBugs.dll
    if plugins.join("MegaBugs.dll").exists() {
        found = true;
    }

    // Check subfolder: plugins/MegaBugs/MegaBugs.dll
    if !found {
        let subfolder = plugins.join("MegaBugs");
        if subfolder.is_dir() {
            if let Ok(entries) = fs::read_dir(&subfolder) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.eq_ignore_ascii_case("megabugs.dll") {
                            found = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    // Admin: check for key file
    let is_admin = std::env::var("USERPROFILE")
        .map(|home| Path::new(&home).join(".megaload").join("megabugs-admin.key").exists())
        .unwrap_or(false);

    app_log(&format!(
        "MegaBugs access check: enabled={}, admin={}",
        found, is_admin
    ));

    Ok(MegaBugsAccess {
        enabled: found,
        is_admin,
    })
}

/// Get or check if user identity exists.
#[command]
pub fn get_megabugs_identity() -> Result<UserIdentity, String> {
    let path = megabugs_data_dir().join("megabugs_identity.json");
    let data = fs::read_to_string(&path)
        .map_err(|_| "No MegaBugs identity found — set up your display name first".to_string())?;
    serde_json::from_str(&data).map_err(|e| format!("Identity parse error: {}", e))
}

/// Create or update user identity.
#[command]
pub fn set_megabugs_identity(display_name: String) -> Result<UserIdentity, String> {
    if display_name.trim().is_empty() {
        return Err("Display name cannot be empty".to_string());
    }
    if display_name.len() > 50 {
        return Err("Display name too long (max 50 characters)".to_string());
    }

    let dir = megabugs_data_dir();
    let path = dir.join("megabugs_identity.json");

    // Preserve existing UUID if updating name
    let user_id = if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(existing) = serde_json::from_str::<UserIdentity>(&data) {
            existing.user_id
        } else {
            uuid::Uuid::new_v4().to_string()
        }
    } else {
        uuid::Uuid::new_v4().to_string()
    };

    let identity = UserIdentity {
        user_id,
        display_name: display_name.trim().to_string(),
    };

    let _ = fs::create_dir_all(&dir);
    let json = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to save identity: {}", e))?;

    app_log(&format!("MegaBugs identity set: {}", identity.display_name));
    Ok(identity)
}

/// Fetch ticket index (filtered by user_id for non-admin).
#[command]
pub fn fetch_tickets(user_id: Option<String>) -> Result<Vec<TicketSummary>, String> {
    let (content, _sha) = github_get_file("index.json")?;
    let index: TicketIndex =
        serde_json::from_str(&content).map_err(|e| format!("Index parse error: {}", e))?;

    let tickets = match user_id {
        Some(uid) => index
            .tickets
            .into_iter()
            .filter(|t| t.author_id == uid)
            .collect(),
        None => index.tickets, // admin sees all
    };

    app_log(&format!("MegaBugs: fetched {} tickets", tickets.len()));
    Ok(tickets)
}

/// Fetch full ticket detail including messages.
#[command]
pub fn fetch_ticket_detail(ticket_id: String) -> Result<Ticket, String> {
    // Validate ticket_id is safe (alphanumeric + dashes only)
    if !ticket_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-')
    {
        return Err("Invalid ticket ID".to_string());
    }

    let path = format!("tickets/{}.json", ticket_id);
    let (content, _sha) = github_get_file(&path)?;
    let ticket: Ticket =
        serde_json::from_str(&content).map_err(|e| format!("Ticket parse error: {}", e))?;

    app_log(&format!(
        "MegaBugs: loaded ticket {} ({} messages)",
        ticket_id,
        ticket.messages.len()
    ));
    Ok(ticket)
}

/// Submit a new ticket.
#[command]
pub fn submit_ticket(
    ticket_type: String,
    title: String,
    description: String,
    images: Vec<ImageData>,
    bepinex_path: String,
    user_id: String,
    user_name: String,
) -> Result<TicketSummary, String> {
    // Validate type
    if ticket_type != "bug" && ticket_type != "feature" {
        return Err("Type must be 'bug' or 'feature'".to_string());
    }
    let title = title.trim().to_string();
    if title.is_empty() || title.len() > 120 {
        return Err("Title must be 1-120 characters".to_string());
    }
    let description = description.trim().to_string();
    if description.is_empty() {
        return Err("Description cannot be empty".to_string());
    }
    if images.len() > 5 {
        return Err("Maximum 5 images".to_string());
    }

    let now = iso_now();

    // Generate ticket ID: YYYYMMDD-HHmmss-short_uuid
    let date_part = now.replace('-', "").replace(':', "").replace('T', "-").replace('Z', "");
    let short_uuid = &uuid::Uuid::new_v4().to_string()[..8];
    let ticket_id = format!("{}-{}", &date_part[..15], short_uuid);

    app_log(&format!("MegaBugs: creating ticket {}", ticket_id));

    // Collect system info
    let system_info = collect_system_info(&bepinex_path);

    // Read BepInEx log
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    let has_log = log_path.exists();
    let log_content = if has_log {
        fs::read_to_string(&log_path).unwrap_or_default()
    } else {
        String::new()
    };

    // Upload log if exists
    if has_log && !log_content.is_empty() {
        let log_repo_path = format!("attachments/{}/log.txt", ticket_id);
        github_put_file(
            &log_repo_path,
            log_content.as_bytes(),
            &format!("Ticket #{}: log.txt", ticket_id),
            None,
        )?;
    }

    // Upload images
    let mut image_paths = Vec::new();
    for (i, img) in images.iter().enumerate() {
        // Validate and sanitize filename
        let ext = img
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("png")
            .to_lowercase();
        if !["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str()) {
            return Err(format!("Unsupported image format: {}", ext));
        }
        let safe_name = format!("img_{:03}.{}", i + 1, ext);
        let img_repo_path = format!("attachments/{}/{}", ticket_id, safe_name);

        let img_bytes = B64
            .decode(&img.base64_data)
            .map_err(|e| format!("Invalid image data: {}", e))?;

        // Max 5MB per image
        if img_bytes.len() > 5 * 1024 * 1024 {
            return Err(format!("Image {} exceeds 5MB limit", safe_name));
        }

        github_put_file(
            &img_repo_path,
            &img_bytes,
            &format!("Ticket #{}: {}", ticket_id, safe_name),
            None,
        )?;
        image_paths.push(format!("attachments/{}/{}", ticket_id, safe_name));
    }

    // Build the ticket
    let first_message = TicketMessage {
        id: "msg-001".to_string(),
        author_id: user_id.clone(),
        author_name: user_name.clone(),
        text: description,
        images: image_paths,
        timestamp: now.clone(),
        is_admin: false,
    };

    let ticket = Ticket {
        id: ticket_id.clone(),
        ticket_type: ticket_type.clone(),
        title: title.clone(),
        status: "open".to_string(),
        labels: vec![ticket_type.clone()],
        author_id: user_id.clone(),
        author_name: user_name.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
        system_info,
        messages: vec![first_message],
        has_log,
    };

    // Upload ticket JSON
    let ticket_json = serde_json::to_string_pretty(&ticket).map_err(|e| e.to_string())?;
    let ticket_path = format!("tickets/{}.json", ticket_id);
    github_put_file(
        &ticket_path,
        ticket_json.as_bytes(),
        &format!("New ticket: {}", title),
        None,
    )?;

    // Update index.json
    let summary = TicketSummary {
        id: ticket_id.clone(),
        ticket_type,
        title,
        status: "open".to_string(),
        author_id: user_id,
        author_name: user_name,
        created_at: now.clone(),
        updated_at: now,
        message_count: 1,
        labels: ticket.labels.clone(),
    };

    update_index_add(&summary)?;

    app_log(&format!("MegaBugs: ticket {} created successfully", ticket_id));
    Ok(summary)
}

/// Reply to an existing ticket.
#[command]
pub fn reply_to_ticket(
    ticket_id: String,
    text: String,
    images: Vec<ImageData>,
    user_id: String,
    user_name: String,
    is_admin: bool,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Reply text cannot be empty".to_string());
    }
    if images.len() > 5 {
        return Err("Maximum 5 images per reply".to_string());
    }
    if !ticket_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-')
    {
        return Err("Invalid ticket ID".to_string());
    }

    let now = iso_now();

    // Fetch current ticket
    let ticket_path = format!("tickets/{}.json", ticket_id);
    let (content, sha) = github_get_file(&ticket_path)?;
    let mut ticket: Ticket =
        serde_json::from_str(&content).map_err(|e| format!("Ticket parse error: {}", e))?;

    // Upload images
    let mut image_paths = Vec::new();
    let img_offset = ticket
        .messages
        .iter()
        .flat_map(|m| &m.images)
        .count();
    for (i, img) in images.iter().enumerate() {
        let ext = img
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("png")
            .to_lowercase();
        if !["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str()) {
            return Err(format!("Unsupported image format: {}", ext));
        }
        let safe_name = format!("img_{:03}.{}", img_offset + i + 1, ext);
        let img_repo_path = format!("attachments/{}/{}", ticket_id, safe_name);

        let img_bytes = B64
            .decode(&img.base64_data)
            .map_err(|e| format!("Invalid image data: {}", e))?;
        if img_bytes.len() > 5 * 1024 * 1024 {
            return Err(format!("Image {} exceeds 5MB limit", safe_name));
        }

        github_put_file(
            &img_repo_path,
            &img_bytes,
            &format!("Ticket #{} reply: {}", ticket_id, safe_name),
            None,
        )?;
        image_paths.push(format!("attachments/{}/{}", ticket_id, safe_name));
    }

    // Add message
    let msg_num = ticket.messages.len() + 1;
    let message = TicketMessage {
        id: format!("msg-{:03}", msg_num),
        author_id: user_id,
        author_name: user_name,
        text,
        images: image_paths,
        timestamp: now.clone(),
        is_admin,
    };
    ticket.messages.push(message);
    ticket.updated_at = now.clone();

    // Push updated ticket
    let ticket_json = serde_json::to_string_pretty(&ticket).map_err(|e| e.to_string())?;
    github_put_file(
        &ticket_path,
        ticket_json.as_bytes(),
        &format!("Reply to ticket {}", ticket_id),
        Some(&sha),
    )?;

    // Update index
    let msg_count = ticket.messages.len();
    update_index_entry(&ticket_id, move |entry| {
        entry.updated_at = now.clone();
        entry.message_count = msg_count;
    })?;

    app_log(&format!("MegaBugs: replied to ticket {}", ticket_id));
    Ok(())
}

/// Update ticket status/labels (admin only).
#[command]
pub fn update_ticket_status(
    ticket_id: String,
    status: String,
    labels: Vec<String>,
) -> Result<(), String> {
    if !["open", "in-progress", "closed"].contains(&status.as_str()) {
        return Err("Status must be 'open', 'in-progress', or 'closed'".to_string());
    }
    if !ticket_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-')
    {
        return Err("Invalid ticket ID".to_string());
    }

    let now = iso_now();

    let ticket_path = format!("tickets/{}.json", ticket_id);
    let (content, sha) = github_get_file(&ticket_path)?;
    let mut ticket: Ticket =
        serde_json::from_str(&content).map_err(|e| format!("Ticket parse error: {}", e))?;

    ticket.status = status.clone();
    ticket.labels = labels.clone();
    ticket.updated_at = now.clone();

    let ticket_json = serde_json::to_string_pretty(&ticket).map_err(|e| e.to_string())?;
    github_put_file(
        &ticket_path,
        ticket_json.as_bytes(),
        &format!("Update ticket {} status: {}", ticket_id, status),
        Some(&sha),
    )?;

    update_index_entry(&ticket_id, move |entry| {
        entry.status = status.clone();
        entry.labels = labels.clone();
        entry.updated_at = now.clone();
    })?;

    app_log(&format!("MegaBugs: updated ticket {} status", ticket_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

/// Max retries for SHA conflict (409) on index.json updates.
const INDEX_CONFLICT_RETRIES: usize = 3;

/// Add a new entry to index.json with SHA conflict retry.
fn update_index_add(summary: &TicketSummary) -> Result<(), String> {
    for attempt in 0..INDEX_CONFLICT_RETRIES {
        let (content, sha) = github_get_file("index.json")?;
        let mut index: TicketIndex =
            serde_json::from_str(&content).map_err(|e| format!("Index parse error: {}", e))?;

        index.tickets.insert(0, summary.clone()); // newest first
        index.last_updated = summary.created_at.clone();

        let json = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
        match github_put_file("index.json", json.as_bytes(), "Update ticket index", Some(&sha)) {
            Ok(_) => return Ok(()),
            Err(e) if e.contains("409") && attempt < INDEX_CONFLICT_RETRIES - 1 => {
                app_log(&format!("MegaBugs: index.json conflict, retry {}", attempt + 1));
                std::thread::sleep(std::time::Duration::from_millis(300 * (attempt as u64 + 1)));
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err("Failed to update index.json after retries".to_string())
}

/// Update an existing entry in index.json with SHA conflict retry.
fn update_index_entry<F>(ticket_id: &str, updater: F) -> Result<(), String>
where
    F: Fn(&mut TicketSummary),
{
    for attempt in 0..INDEX_CONFLICT_RETRIES {
        let (content, sha) = github_get_file("index.json")?;
        let mut index: TicketIndex =
            serde_json::from_str(&content).map_err(|e| format!("Index parse error: {}", e))?;

        if let Some(entry) = index.tickets.iter_mut().find(|t| t.id == ticket_id) {
            updater(entry);
            index.last_updated = entry.updated_at.clone();
        }

        let json = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
        match github_put_file("index.json", json.as_bytes(), "Update ticket index", Some(&sha)) {
            Ok(_) => return Ok(()),
            Err(e) if e.contains("409") && attempt < INDEX_CONFLICT_RETRIES - 1 => {
                app_log(&format!("MegaBugs: index.json conflict, retry {}", attempt + 1));
                std::thread::sleep(std::time::Duration::from_millis(300 * (attempt as u64 + 1)));
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err("Failed to update index.json after retries".to_string())
}

// ---------------------------------------------------------------------------
// System info collection
// ---------------------------------------------------------------------------

fn collect_system_info(bepinex_path: &str) -> SystemInfo {
    let megaload_version = env!("CARGO_PKG_VERSION").to_string();

    // OS info
    let os = format!("Windows {}", std::env::var("OS").unwrap_or_default());

    // Profile name — read from profiles.json by matching bepinex_path
    let profile_name = get_profile_name(bepinex_path).unwrap_or_else(|| "Unknown".to_string());

    // Installed mods — scan plugins dir
    let installed_mods = get_installed_mod_list(bepinex_path);

    SystemInfo {
        megaload_version,
        os,
        profile_name,
        installed_mods,
    }
}

fn get_profile_name(bepinex_path: &str) -> Option<String> {
    let appdata = std::env::var("APPDATA").ok()?;
    let profiles_json = Path::new(&appdata).join("MegaLoad").join("profiles.json");
    let data = fs::read_to_string(profiles_json).ok()?;

    // Simple extraction — look for profiles with matching bepinex_path
    let parsed: serde_json::Value = serde_json::from_str(&data).ok()?;
    let profiles = parsed.get("profiles")?.as_array()?;
    for p in profiles {
        if let Some(bp) = p.get("bepinex_path").and_then(|v| v.as_str()) {
            // Normalize paths for comparison
            let a = bp.replace('/', "\\").to_lowercase();
            let b = bepinex_path.replace('/', "\\").to_lowercase();
            if a == b {
                return p.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        }
    }
    None
}

/// Fetch an attachment (image/log) from the repo as base64.
#[command]
pub fn fetch_attachment(path: String) -> Result<String, String> {
    // Only allow attachments/ prefix for safety
    if !path.starts_with("attachments/") {
        return Err("Invalid attachment path".to_string());
    }
    // Validate path characters
    if !path.chars().all(|c| c.is_alphanumeric() || matches!(c, '/' | '-' | '_' | '.')) {
        return Err("Invalid attachment path characters".to_string());
    }

    let token = github_token()?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", REPO, path);
    let resp = crate::commands::http::agent()
        .get(&url)
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Failed to fetch attachment: {}", e))?;

    let body = resp.into_string().map_err(|e| format!("Read error: {}", e))?;
    let gc: GitHubContent =
        serde_json::from_str(&body).map_err(|e| format!("Parse error: {}", e))?;

    // Return the raw base64 content (already base64 from GitHub)
    let raw = gc.content.unwrap_or_default().replace('\n', "").replace('\r', "");
    Ok(raw)
}

fn get_installed_mod_list(bepinex_path: &str) -> Vec<String> {
    let plugins = Path::new(bepinex_path).join("plugins");
    let mut mods = Vec::new();
    if let Ok(entries) = fs::read_dir(&plugins) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('_') {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                // Folder-style mod
                if let Ok(files) = fs::read_dir(&path) {
                    for f in files.flatten() {
                        if f.path().extension().and_then(|e| e.to_str()) == Some("dll") {
                            let dll_name = f
                                .path()
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            mods.push(dll_name);
                        }
                    }
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("dll") {
                let dll_name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                mods.push(dll_name);
            }
        }
    }
    mods.sort();
    mods
}
