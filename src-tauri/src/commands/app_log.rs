use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::command;

/// Global flag — avoids reading settings.json on every log call.
static LOGGING_ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    #[serde(default)]
    pub logging_enabled: bool,
    #[serde(default)]
    pub megachat_debug: bool,
    /// Folder where downloaded MegaBugs ticket logs are saved. Owner-only
    /// diagnostic workflow — empty means "prompt via save dialog each time".
    #[serde(default)]
    pub diagnostic_logs_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            logging_enabled: false,
            megachat_debug: false,
            diagnostic_logs_path: None,
        }
    }
}

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn settings_path() -> PathBuf {
    megaload_dir().join("settings.json")
}

pub fn log_path() -> PathBuf {
    megaload_dir().join("megaload.log")
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Public wrapper for other modules (e.g. chat) to persist settings.
pub fn save_settings_pub(settings: &AppSettings) -> Result<(), String> {
    save_settings(settings)
}

/// Call once at startup to load the logging flag into memory.
pub fn init_logging() {
    let settings = load_settings();
    LOGGING_ENABLED.store(settings.logging_enabled, Ordering::Relaxed);
    if settings.logging_enabled {
        app_log("MegaLoad started");
    }
}

/// Write a timestamped line to megaload.log (if logging is enabled).
pub fn app_log(msg: &str) {
    if !LOGGING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Format as ISO-ish timestamp
    let secs_per_day = 86400u64;
    let days = now / secs_per_day;
    let day_secs = now % secs_per_day;
    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;

    // Simple epoch-to-date (good enough for logging)
    let (year, month, day) = epoch_days_to_ymd(days);

    let line = format!(
        "[{:04}-{:02}-{:02} {:02}:{:02}:{:02}] {}\n",
        year, month, day, hours, minutes, seconds, msg
    );

    let path = log_path();
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

fn epoch_days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
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
    (y, m, d)
}

// ── Tauri commands ──────────────────────────────────────────

/// Log a message from the frontend (same log file as Rust-side app_log).
#[command(async)]
pub fn log_from_frontend(message: String) {
    app_log(&format!("[frontend] {}", message));
}

#[command(async)]
pub fn get_logging_enabled() -> bool {
    LOGGING_ENABLED.load(Ordering::Relaxed)
}

#[command(async)]
pub fn set_logging_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = load_settings();
    settings.logging_enabled = enabled;
    save_settings(&settings)?;
    LOGGING_ENABLED.store(enabled, Ordering::Relaxed);

    // Log the toggle itself
    if enabled {
        app_log("Logging enabled");
    }
    Ok(())
}

#[command(async)]
pub fn read_app_log(tail_lines: Option<usize>) -> Result<String, String> {
    let path = log_path();
    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let max = tail_lines.unwrap_or(500);
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max);
    Ok(lines[start..].join("\n"))
}

#[command(async)]
pub fn clear_app_log() -> Result<(), String> {
    let path = log_path();
    if path.exists() {
        fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    app_log("Log cleared");
    Ok(())
}

#[command(async)]
pub fn get_app_log_path() -> String {
    log_path().to_string_lossy().to_string()
}

#[command(async)]
pub fn get_diagnostic_logs_path() -> Option<String> {
    load_settings().diagnostic_logs_path
}

#[command(async)]
pub fn set_diagnostic_logs_path(path: Option<String>) -> Result<(), String> {
    let mut settings = load_settings();
    settings.diagnostic_logs_path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    save_settings(&settings)
}

#[command(async)]
pub fn open_data_dir() -> Result<(), String> {
    let dir = megaload_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command(async)]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
