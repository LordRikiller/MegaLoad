use crate::commands::app_log::app_log;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::command;

// ---------------------------------------------------------------------------
// Claude API token — XOR-obfuscated at compile time (same pattern as bugs.rs)
// Set MEGACHAT_TOKEN_OBF env var before building, or leave blank for dev.
// ---------------------------------------------------------------------------
const OBFUSCATION_KEY: u8 = 0xAB;

fn get_claude_token() -> Option<String> {
    let obfuscated: &[u8] = match option_env!("MEGACHAT_TOKEN_OBF") {
        Some(s) => s.as_bytes(),
        None => return None,
    };
    let bytes: Vec<u8> = (0..obfuscated.len() / 2)
        .filter_map(|i| {
            u8::from_str_radix(
                &String::from_utf8_lossy(&obfuscated[i * 2..i * 2 + 2]),
                16,
            )
            .ok()
        })
        .map(|b| b ^ OBFUSCATION_KEY)
        .collect();
    String::from_utf8(bytes).ok()
}

/// Dev fallback: read token from local file
fn get_claude_token_dev() -> Option<String> {
    let home = std::env::var("USERPROFILE").ok()?;
    let path = std::path::Path::new(&home)
        .join(".megaload")
        .join("megachat-token");
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn claude_token() -> Result<String, String> {
    get_claude_token()
        .or_else(get_claude_token_dev)
        .ok_or_else(|| "MegaChat: No Claude API token configured".to_string())
}

// ---------------------------------------------------------------------------
// Admin detection — delegate to shared identity module
// ---------------------------------------------------------------------------
fn is_admin() -> bool {
    crate::commands::identity::is_admin()
}

// ---------------------------------------------------------------------------
// Debug mode
// ---------------------------------------------------------------------------
static MEGACHAT_DEBUG: AtomicBool = AtomicBool::new(false);

pub fn init_megachat_debug() {
    let settings = crate::commands::app_log::load_settings();
    MEGACHAT_DEBUG.store(settings.megachat_debug, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------
const DAILY_TOKEN_LIMIT: u64 = 200_000;
const CLAUDE_MODEL: &str = "claude-sonnet-4-20250514";
const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const USER_AGENT: &str = concat!("MegaLoad/", env!("CARGO_PKG_VERSION"));

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn usage_path() -> PathBuf {
    megaload_dir().join("megachat-usage.json")
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct DailyUsage {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}

fn today_str() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn load_usage() -> DailyUsage {
    let path = usage_path();
    if let Ok(data) = fs::read_to_string(&path) {
        let usage: DailyUsage = serde_json::from_str(&data).unwrap_or_default();
        if usage.date == today_str() {
            return usage;
        }
    }
    DailyUsage {
        date: today_str(),
        ..Default::default()
    }
}

fn save_usage(usage: &DailyUsage) -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(usage).map_err(|e| e.to_string())?;
    fs::write(usage_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Claude API types
// ---------------------------------------------------------------------------
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Debug)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize, Debug)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
    usage: ClaudeUsage,
}

#[derive(Deserialize, Debug)]
struct ClaudeContent {
    #[serde(rename = "type")]
    _type: String,
    text: String,
}

#[derive(Deserialize, Debug)]
struct ClaudeUsage {
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Deserialize, Debug)]
struct ClaudeError {
    error: ClaudeErrorDetail,
}

#[derive(Deserialize, Debug)]
struct ClaudeErrorDetail {
    message: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ChatResponse {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub daily_usage: DailyUsage,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[command]
pub fn chat_send_message(
    messages: Vec<ChatMessage>,
    system_context: String,
) -> Result<ChatResponse, String> {
    let token = claude_token()?;
    let admin = is_admin();

    // Check ban status (non-admin only)
    if !admin {
        if let Ok(banned) = crate::commands::identity::check_user_banned() {
            if banned {
                return Err("Your account has been suspended. Contact support if you believe this is in error.".to_string());
            }
        }
    }

    // Check daily limit (admin bypasses)
    let mut usage = load_usage();
    if !admin && usage.total_tokens >= DAILY_TOKEN_LIMIT {
        return Err(format!(
            "Daily token limit reached ({}/{}). Resets tomorrow.",
            usage.total_tokens, DAILY_TOKEN_LIMIT
        ));
    }

    // Validate messages
    if messages.is_empty() {
        return Err("No messages provided".to_string());
    }
    for msg in &messages {
        if msg.role != "user" && msg.role != "assistant" {
            return Err(format!("Invalid message role: {}", msg.role));
        }
        if msg.content.is_empty() {
            return Err("Empty message content".to_string());
        }
    }

    let debug = MEGACHAT_DEBUG.load(Ordering::Relaxed);

    let request = ClaudeRequest {
        model: CLAUDE_MODEL.to_string(),
        max_tokens: 4096,
        system: system_context.clone(),
        messages: messages.clone(),
    };

    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;

    if debug {
        app_log(&format!(
            "MegaChat request: model={}, messages={}, system_len={}",
            CLAUDE_MODEL,
            messages.len(),
            system_context.len()
        ));
    }

    // Make API call
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .build();

    let resp = agent
        .post(CLAUDE_API_URL)
        .set("x-api-key", &token)
        .set("anthropic-version", "2023-06-01")
        .set("content-type", "application/json")
        .set("User-Agent", USER_AGENT)
        .send_string(&body);

    match resp {
        Ok(response) => {
            let response_text = response.into_string().map_err(|e| e.to_string())?;

            if debug {
                // Truncate response for logging
                let log_text = if response_text.len() > 500 {
                    format!("{}... (truncated)", &response_text[..500])
                } else {
                    response_text.clone()
                };
                app_log(&format!("MegaChat response: {}", log_text));
            }

            let claude: ClaudeResponse =
                serde_json::from_str(&response_text).map_err(|e| {
                    format!("Failed to parse Claude response: {} — raw: {}", e, &response_text[..response_text.len().min(200)])
                })?;

            let text = claude
                .content
                .into_iter()
                .filter(|c| c._type == "text")
                .map(|c| c.text)
                .collect::<Vec<_>>()
                .join("");

            // Update usage
            usage.input_tokens += claude.usage.input_tokens;
            usage.output_tokens += claude.usage.output_tokens;
            usage.total_tokens += claude.usage.input_tokens + claude.usage.output_tokens;
            usage.request_count += 1;
            let _ = save_usage(&usage);

            app_log(&format!(
                "MegaChat: +{}in/{}out tokens (daily total: {})",
                claude.usage.input_tokens, claude.usage.output_tokens, usage.total_tokens
            ));

            Ok(ChatResponse {
                text,
                input_tokens: claude.usage.input_tokens,
                output_tokens: claude.usage.output_tokens,
                daily_usage: usage,
            })
        }
        Err(ureq::Error::Status(code, response)) => {
            let error_body = response.into_string().unwrap_or_default();
            if let Ok(err) = serde_json::from_str::<ClaudeError>(&error_body) {
                Err(format!("Claude API error ({}): {}", code, err.error.message))
            } else {
                Err(format!("Claude API error ({}): {}", code, &error_body[..error_body.len().min(300)]))
            }
        }
        Err(e) => Err(format!("Network error calling Claude API: {}", e)),
    }
}

#[command]
pub fn chat_get_usage() -> DailyUsage {
    load_usage()
}

#[command]
pub fn chat_reset_usage() -> Result<(), String> {
    if !is_admin() {
        return Err("Only admin can reset usage".to_string());
    }
    let usage = DailyUsage {
        date: today_str(),
        ..Default::default()
    };
    save_usage(&usage)
}

#[command]
pub fn chat_get_debug_enabled() -> bool {
    MEGACHAT_DEBUG.load(Ordering::Relaxed)
}

#[command]
pub fn chat_set_debug_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = crate::commands::app_log::load_settings();
    settings.megachat_debug = enabled;
    crate::commands::app_log::save_settings_pub(&settings)?;
    MEGACHAT_DEBUG.store(enabled, Ordering::Relaxed);
    app_log(&format!(
        "MegaChat debug {}",
        if enabled { "enabled" } else { "disabled" }
    ));
    Ok(())
}
