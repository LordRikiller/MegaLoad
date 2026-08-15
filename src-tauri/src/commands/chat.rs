use crate::commands::app_log::app_log;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::command;

// ---------------------------------------------------------------------------
// Claude API key — user-provided, stored locally in %APPDATA%/MegaLoad/
// ---------------------------------------------------------------------------

fn api_key_path() -> PathBuf {
    megaload_dir().join("megachat-api-key")
}

fn claude_token() -> Result<String, String> {
    let path = api_key_path();
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "No API key configured. Add your Anthropic API key in Settings → MegaChat.".to_string())
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
// Usage tracking (informational only — no enforced limit since user provides own key)
// ---------------------------------------------------------------------------
const CLAUDE_MODEL: &str = "claude-sonnet-4-6";
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
struct SystemBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<CacheControl>,
}

#[derive(Serialize, Debug)]
struct CacheControl {
    #[serde(rename = "type")]
    cache_type: String,
}

#[derive(Serialize, Debug)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    system: Vec<SystemBlock>,
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
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
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

#[command(async)]
pub fn chat_send_message(
    messages: Vec<ChatMessage>,
    static_context: String,
    dynamic_context: String,
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

    let mut usage = load_usage();

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

    // Build system blocks: static (cached) + dynamic
    let mut system_blocks = vec![SystemBlock {
        content_type: "text".to_string(),
        text: static_context.clone(),
        cache_control: Some(CacheControl {
            cache_type: "ephemeral".to_string(),
        }),
    }];
    if !dynamic_context.is_empty() {
        system_blocks.push(SystemBlock {
            content_type: "text".to_string(),
            text: dynamic_context.clone(),
            cache_control: None,
        });
    }

    let request = ClaudeRequest {
        model: CLAUDE_MODEL.to_string(),
        max_tokens: 2048,
        system: system_blocks,
        messages: messages.clone(),
    };

    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;

    if debug {
        app_log(&format!(
            "MegaChat request: model={}, messages={}, static_len={}, dynamic_len={}",
            CLAUDE_MODEL,
            messages.len(),
            static_context.len(),
            dynamic_context.len()
        ));
    }

    // Make API call
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    // Long read timeout: the non-streaming Claude API sends nothing until the
    // full completion is ready, so TTFB can be most of a minute. 180s still
    // rescues a dead socket after laptop sleep instead of hanging forever.
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(180))
        .timeout_write(std::time::Duration::from_secs(30))
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
                "MegaChat: +{}in/{}out tokens (daily total: {}) [cache: created={}, read={}]",
                claude.usage.input_tokens, claude.usage.output_tokens, usage.total_tokens,
                claude.usage.cache_creation_input_tokens, claude.usage.cache_read_input_tokens
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

#[command(async)]
pub fn chat_get_usage() -> DailyUsage {
    load_usage()
}

#[command(async)]
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

#[command(async)]
pub fn chat_check_available() -> bool {
    claude_token().is_ok()
}

#[command(async)]
pub fn chat_get_debug_enabled() -> bool {
    MEGACHAT_DEBUG.load(Ordering::Relaxed)
}

#[command(async)]
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

// ---------------------------------------------------------------------------
// API key management — user-provided key stored locally
// ---------------------------------------------------------------------------

#[command(async)]
pub fn chat_save_api_key(key: String) -> Result<(), String> {
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Err("API key cannot be empty".to_string());
    }
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(api_key_path(), &trimmed).map_err(|e| e.to_string())?;
    app_log("MegaChat: API key saved");
    Ok(())
}

#[command(async)]
pub fn chat_clear_api_key() -> Result<(), String> {
    let path = api_key_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    app_log("MegaChat: API key cleared");
    Ok(())
}

#[command(async)]
pub fn chat_get_api_key_status() -> bool {
    claude_token().is_ok()
}
