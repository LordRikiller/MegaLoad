use crate::commands::app_log::app_log;
use crate::commands::github::{github_get_file, github_put_file, github_list_dir, github_delete_file};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::command;

// Re-export UserIdentity from shared identity module
pub use crate::commands::identity::UserIdentity;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MegaBugsAccess {
    pub enabled: bool,
    pub is_admin: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CollaboratorEntry {
    pub user_id: String,
    pub display_name: String,
    pub added_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CollaboratorList {
    pub collaborators: Vec<CollaboratorEntry>,
    pub last_updated: String,
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
    /// "urgent" | "normal" | "low". Optional for back-compat with pre-priority tickets;
    /// missing or null is treated as "normal" by the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
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
    /// "urgent" | "normal" | "low". Optional for back-compat — pre-priority tickets
    /// deserialise to None and render as "normal" in the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
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

// GitHub helpers are in crate::commands::github

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
// Role helpers — single 'collaborator' tier backed by collaborators.json on GitHub
// ---------------------------------------------------------------------------

fn is_local_owner() -> bool {
    std::env::var("USERPROFILE")
        .map(|home| Path::new(&home).join(".megaload").join("megabugs-admin.key").exists())
        .unwrap_or(false)
}

fn load_collaborator_list() -> CollaboratorList {
    match github_get_file("collaborators.json") {
        Ok((content, _sha)) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => CollaboratorList::default(),
    }
}

fn is_collaborator(user_id: &str) -> bool {
    load_collaborator_list()
        .collaborators
        .iter()
        .any(|c| c.user_id == user_id)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Check MegaBugs access — always enabled (core feature since v1.3.3), returns admin status.
#[command]
pub fn check_megabugs_access(_bepinex_path: String) -> Result<MegaBugsAccess, String> {
    Ok(MegaBugsAccess {
        enabled: true,
        is_admin: is_local_owner(),
    })
}

/// Resolve the caller's role: "owner" (local admin key present), "collaborator"
/// (listed in collaborators.json), or "user" (everyone else). Used by the
/// frontend to gate Delete / Close / admin panel visibility.
#[command]
pub async fn get_megabugs_role(user_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        if is_local_owner() {
            return Ok("owner".to_string());
        }
        if is_collaborator(&user_id) {
            return Ok("collaborator".to_string());
        }
        Ok("user".to_string())
    })
    .await
    .map_err(|e| format!("get_megabugs_role task panicked: {}", e))?
}

/// List collaborators currently granted elevated access.
#[command]
pub async fn list_collaborators() -> Result<Vec<CollaboratorEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<CollaboratorEntry>, String> {
        Ok(load_collaborator_list().collaborators)
    })
    .await
    .map_err(|e| format!("list_collaborators task panicked: {}", e))?
}

/// Grant collaborator access to a user_id. Owner-only.
#[command]
pub fn add_collaborator(user_id: String, display_name: String) -> Result<(), String> {
    if !is_local_owner() {
        return Err("Only the owner can add collaborators".to_string());
    }
    let user_id = user_id.trim().to_string();
    if user_id.is_empty() {
        return Err("user_id cannot be empty".to_string());
    }
    let display_name = display_name.trim().to_string();

    for attempt in 0..INDEX_CONFLICT_RETRIES {
        let (content, sha) = match github_get_file("collaborators.json") {
            Ok(pair) => pair,
            Err(e) if e.contains("404") => {
                // File doesn't exist yet — create fresh.
                ("{\"collaborators\":[],\"last_updated\":\"\"}".to_string(), String::new())
            }
            Err(e) => return Err(e),
        };
        let mut list: CollaboratorList = serde_json::from_str(&content).unwrap_or_default();
        if list.collaborators.iter().any(|c| c.user_id == user_id) {
            return Ok(()); // already a collaborator — no-op
        }
        let now = iso_now();
        list.collaborators.push(CollaboratorEntry {
            user_id: user_id.clone(),
            display_name: display_name.clone(),
            added_at: now.clone(),
        });
        list.last_updated = now;

        let json = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
        let sha_opt = if sha.is_empty() { None } else { Some(sha.as_str()) };
        match github_put_file(
            "collaborators.json",
            json.as_bytes(),
            &format!("Add collaborator: {}", user_id),
            sha_opt,
        ) {
            Ok(_) => {
                app_log(&format!("MegaBugs: added collaborator {}", user_id));
                return Ok(());
            }
            Err(e) if e.contains("409") && attempt < INDEX_CONFLICT_RETRIES - 1 => {
                app_log(&format!("MegaBugs: collaborators.json conflict, retry {}", attempt + 1));
                std::thread::sleep(std::time::Duration::from_millis(300 * (attempt as u64 + 1)));
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err("Failed to update collaborators.json after retries".to_string())
}

/// Revoke collaborator access. Owner-only.
#[command]
pub fn remove_collaborator(user_id: String) -> Result<(), String> {
    if !is_local_owner() {
        return Err("Only the owner can remove collaborators".to_string());
    }
    let user_id = user_id.trim().to_string();
    if user_id.is_empty() {
        return Err("user_id cannot be empty".to_string());
    }

    for attempt in 0..INDEX_CONFLICT_RETRIES {
        let (content, sha) = match github_get_file("collaborators.json") {
            Ok(pair) => pair,
            Err(e) if e.contains("404") => return Ok(()), // nothing to remove
            Err(e) => return Err(e),
        };
        let mut list: CollaboratorList = serde_json::from_str(&content).unwrap_or_default();
        let before = list.collaborators.len();
        list.collaborators.retain(|c| c.user_id != user_id);
        if list.collaborators.len() == before {
            return Ok(()); // was not present — no-op
        }
        list.last_updated = iso_now();

        let json = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
        match github_put_file(
            "collaborators.json",
            json.as_bytes(),
            &format!("Remove collaborator: {}", user_id),
            Some(&sha),
        ) {
            Ok(_) => {
                app_log(&format!("MegaBugs: removed collaborator {}", user_id));
                return Ok(());
            }
            Err(e) if e.contains("409") && attempt < INDEX_CONFLICT_RETRIES - 1 => {
                app_log(&format!("MegaBugs: collaborators.json conflict, retry {}", attempt + 1));
                std::thread::sleep(std::time::Duration::from_millis(300 * (attempt as u64 + 1)));
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err("Failed to update collaborators.json after retries".to_string())
}

/// Get or check if user identity exists — delegates to shared identity.
#[command]
pub fn get_megabugs_identity() -> Result<UserIdentity, String> {
    crate::commands::identity::get_megaload_identity()
}

/// Create or update user identity — delegates to shared identity.
#[command]
pub fn set_megabugs_identity(display_name: String) -> Result<UserIdentity, String> {
    let result = crate::commands::identity::set_megaload_identity(display_name)?;
    Ok(UserIdentity {
        user_id: result.user_id,
        display_name: result.display_name,
        hmac_secret: None,
    })
}

/// Fetch ticket index (filtered by user_id for non-admin).
#[command]
pub async fn fetch_tickets(user_id: Option<String>) -> Result<Vec<TicketSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<TicketSummary>, String> {
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
    })
    .await
    .map_err(|e| format!("fetch_tickets task panicked: {}", e))?
}

/// Fetch full ticket detail including messages.
#[command]
pub async fn fetch_ticket_detail(ticket_id: String) -> Result<Ticket, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Ticket, String> {
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
    })
    .await
    .map_err(|e| format!("fetch_ticket_detail task panicked: {}", e))?
}

/// Submit a new ticket.
#[command]
pub async fn submit_ticket(
    ticket_type: String,
    title: String,
    description: String,
    images: Vec<ImageData>,
    bepinex_path: String,
    user_id: String,
    user_name: String,
    priority: Option<String>,
    mod_tags: Option<Vec<String>>,
) -> Result<TicketSummary, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<TicketSummary, String> {
    // Validate type
    if ticket_type != "bug" && ticket_type != "feature" {
        return Err("Type must be 'bug' or 'feature'".to_string());
    }
    // Validate priority. Default to "normal" when omitted.
    let priority = match priority.as_deref().map(str::trim) {
        None | Some("") => "normal".to_string(),
        Some(p) if matches!(p, "urgent" | "normal" | "low") => p.to_string(),
        Some(other) => return Err(format!("Priority must be 'urgent', 'normal', or 'low' (got '{}')", other)),
    };
    // Sanitise user-supplied mod tags. Empty/unknown values are dropped silently
    // so the form can pass an unfiltered list. The frontend's allowlist is the
    // canonical one — but we re-check here so an attacker with the Tauri channel
    // can't smuggle arbitrary labels.
    let allowed_mod_tags: &[&str] = &[
        "megaload", "megaapp", "megahoe", "megamegingjord", "megafood", "megashot",
        "megaqol", "megastuff", "megafishing", "megafactory", "megatrainer",
        "megabuilder", "megaskeletons", "megadataextractor", "megabugs", "workflow",
    ];
    let mut sanitised_tags: Vec<String> = Vec::new();
    if let Some(tags) = mod_tags {
        for raw in tags {
            let t = raw.trim().to_lowercase();
            if !t.is_empty() && allowed_mod_tags.contains(&t.as_str()) && !sanitised_tags.contains(&t) {
                sanitised_tags.push(t);
            }
        }
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

    // Labels: ticket type + sanitised user-selected mod tags. Order matters for
    // index display (type first), and we de-dupe in case the frontend sent the
    // type as part of the tag list.
    let mut labels: Vec<String> = vec![ticket_type.clone()];
    for tag in &sanitised_tags {
        if !labels.contains(tag) {
            labels.push(tag.clone());
        }
    }

    let ticket = Ticket {
        id: ticket_id.clone(),
        ticket_type: ticket_type.clone(),
        title: title.clone(),
        status: "open".to_string(),
        labels: labels.clone(),
        author_id: user_id.clone(),
        author_name: user_name.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
        system_info,
        messages: vec![first_message],
        has_log,
        priority: Some(priority.clone()),
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
        labels,
        priority: Some(priority),
    };

    update_index_add(&summary)?;

    app_log(&format!("MegaBugs: ticket {} created successfully", ticket_id));
    Ok(summary)
    })
    .await
    .map_err(|e| format!("submit_ticket task panicked: {}", e))?
}

/// Reply to an existing ticket.
#[command]
pub async fn reply_to_ticket(
    ticket_id: String,
    text: String,
    images: Vec<ImageData>,
    user_id: String,
    user_name: String,
    is_admin: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
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
    })
    .await
    .map_err(|e| format!("reply_to_ticket task panicked: {}", e))?
}

/// Update ticket status/labels. Owner can do anything; collaborators can move
/// between `open` and `in-progress`; regular users are rejected. Closing a
/// ticket is reserved for the owner — "only the Lord closes tickets, mate".
#[command]
pub async fn update_ticket_status(
    ticket_id: String,
    status: String,
    labels: Vec<String>,
    caller_user_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    if !["open", "in-progress", "closed"].contains(&status.as_str()) {
        return Err("Status must be 'open', 'in-progress', or 'closed'".to_string());
    }
    if !ticket_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-')
    {
        return Err("Invalid ticket ID".to_string());
    }

    let owner = is_local_owner();
    if status == "closed" && !owner {
        return Err("Only the Lord closes tickets, mate — leave it with Rik".to_string());
    }
    if !owner && !is_collaborator(&caller_user_id) {
        return Err("Only the owner or a collaborator can change ticket status".to_string());
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
    })
    .await
    .map_err(|e| format!("update_ticket_status task panicked: {}", e))?
}

/// Update ticket priority. Owner-only — collaborators cannot reprioritise tickets.
/// Validates priority value, updates both the ticket file and the index.json entry.
#[command]
pub async fn update_ticket_priority(
    ticket_id: String,
    priority: String,
    caller_user_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if !["urgent", "normal", "low"].contains(&priority.as_str()) {
            return Err("Priority must be 'urgent', 'normal', or 'low'".to_string());
        }
        if !ticket_id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-')
        {
            return Err("Invalid ticket ID".to_string());
        }
        // Caller user_id is accepted for symmetry with update_ticket_status but the
        // local owner key is the only thing that grants access here.
        let _ = caller_user_id;
        if !is_local_owner() {
            return Err("Only the Lord changes ticket priority, mate".to_string());
        }

        let now = iso_now();
        let ticket_path = format!("tickets/{}.json", ticket_id);
        let (content, sha) = github_get_file(&ticket_path)?;
        let mut ticket: Ticket =
            serde_json::from_str(&content).map_err(|e| format!("Ticket parse error: {}", e))?;

        ticket.priority = Some(priority.clone());
        ticket.updated_at = now.clone();

        let ticket_json = serde_json::to_string_pretty(&ticket).map_err(|e| e.to_string())?;
        github_put_file(
            &ticket_path,
            ticket_json.as_bytes(),
            &format!("Set ticket {} priority: {}", ticket_id, priority),
            Some(&sha),
        )?;

        let priority_for_closure = priority.clone();
        let now_for_closure = now.clone();
        update_index_entry(&ticket_id, move |entry| {
            entry.priority = Some(priority_for_closure.clone());
            entry.updated_at = now_for_closure.clone();
        })?;

        app_log(&format!("MegaBugs: ticket {} priority -> {}", ticket_id, priority));
        Ok(())
    })
    .await
    .map_err(|e| format!("update_ticket_priority task panicked: {}", e))?
}

/// Delete a ticket and all its attachments. Owner-only — collaborators
/// cannot delete.
#[command]
pub async fn delete_ticket(ticket_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    if !is_local_owner() {
        return Err("Only the owner can delete tickets".to_string());
    }
    if !ticket_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-')
    {
        return Err("Invalid ticket ID".to_string());
    }

    app_log(&format!("MegaBugs: deleting ticket {}", ticket_id));

    // Delete ticket JSON
    let ticket_path = format!("tickets/{}.json", ticket_id);
    let (_content, sha) = github_get_file(&ticket_path)?;
    github_delete_file(&ticket_path, &sha, &format!("Delete ticket {}", ticket_id))?;

    // Delete attachments folder contents (best effort)
    let attachments_path = format!("attachments/{}", ticket_id);
    if let Ok(listing) = github_list_dir(&attachments_path) {
        for (file_path, file_sha) in listing {
            let _ = github_delete_file(&file_path, &file_sha, &format!("Delete attachment for {}", ticket_id));
        }
    }

    // Remove from index
    update_index_remove(&ticket_id)?;

    app_log(&format!("MegaBugs: ticket {} deleted", ticket_id));
    Ok(())
    })
    .await
    .map_err(|e| format!("delete_ticket task panicked: {}", e))?
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

/// Remove an entry from index.json with SHA conflict retry.
fn update_index_remove(ticket_id: &str) -> Result<(), String> {
    for attempt in 0..INDEX_CONFLICT_RETRIES {
        let (content, sha) = github_get_file("index.json")?;
        let mut index: TicketIndex =
            serde_json::from_str(&content).map_err(|e| format!("Index parse error: {}", e))?;

        index.tickets.retain(|t| t.id != ticket_id);
        index.last_updated = iso_now();

        let json = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
        match github_put_file("index.json", json.as_bytes(), "Remove ticket from index", Some(&sha)) {
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
pub async fn fetch_attachment(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
    // Only allow attachments/ prefix for safety
    if !path.starts_with("attachments/") {
        return Err("Invalid attachment path".to_string());
    }
    // Validate path characters
    if !path.chars().all(|c| c.is_alphanumeric() || matches!(c, '/' | '-' | '_' | '.')) {
        return Err("Invalid attachment path characters".to_string());
    }

    crate::commands::github::github_get_raw_base64(&path)
        .map_err(|e| format!("Failed to fetch attachment: {}", e))
    })
    .await
    .map_err(|e| format!("fetch_attachment task panicked: {}", e))?
}

/// Download a ticket's attached log to the configured diagnostic logs folder.
/// Saved as `MegaBugs_{ticket_id}_{author_slug}.log`. Returns the absolute path
/// written. Owner-only — collaborators diagnose via GitHub directly.
#[command]
pub async fn download_ticket_log(ticket_id: String, author_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
    if !is_local_owner() {
        return Err("Only the Lord downloads ticket logs, mate".to_string());
    }
    // Tight validation on the ticket id segment
    if !ticket_id.chars().all(|c| c.is_alphanumeric() || c == '-') || ticket_id.is_empty() {
        return Err("Invalid ticket id".to_string());
    }

    let repo_path = format!("attachments/{}/log.txt", ticket_id);
    let b64 = crate::commands::github::github_get_raw_base64(&repo_path)
        .map_err(|e| format!("Failed to fetch log.txt for ticket {}: {}", ticket_id, e))?;
    let bytes = B64
        .decode(b64.as_bytes())
        .map_err(|e| format!("Invalid base64 from GitHub: {}", e))?;

    // Target dir: configured diagnostic_logs_path, else %APPDATA%/MegaLoad/Logs
    let dir = match crate::commands::app_log::load_settings().diagnostic_logs_path {
        Some(p) if !p.is_empty() => std::path::PathBuf::from(p),
        _ => {
            let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
            std::path::PathBuf::from(appdata).join("MegaLoad").join("Logs")
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create logs dir: {}", e))?;

    // Slug author for safe filename
    let slug: String = author_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let slug = if slug.is_empty() { "unknown".to_string() } else { slug };

    let filename = format!("MegaBugs_{}_{}.log", ticket_id, slug);
    let dest = dir.join(&filename);
    fs::write(&dest, &bytes).map_err(|e| format!("Couldn't write log file: {}", e))?;

    app_log(&format!("MegaBugs: downloaded log for ticket {} to {}", ticket_id, dest.display()));
    Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("download_ticket_log task panicked: {}", e))?
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
