use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::command;

#[derive(serde::Serialize)]
pub struct LogLine {
    pub text: String,
    pub level: String,
}

fn classify_level(line: &str) -> &'static str {
    if line.contains("[Error") || line.contains("[Fatal") {
        "error"
    } else if line.contains("[Warning") {
        "warning"
    } else if line.contains("[Info") {
        "info"
    } else if line.contains("[Debug") {
        "debug"
    } else {
        "info"
    }
}

// Valheim's Unity Player.log mixes BepInEx console output (tagged like the
// BepInEx log) with raw Unity lines that carry no level tag. Reuse the BepInEx
// tags where present, then fall back to heuristics for bare Unity exceptions
// and stack-trace frames so errors still light up red.
fn classify_player_level(line: &str) -> &'static str {
    if line.contains("[Error") || line.contains("[Fatal") {
        return "error";
    }
    if line.contains("[Warning") {
        return "warning";
    }
    if line.contains("[Info") {
        return "info";
    }
    if line.contains("[Debug") {
        return "debug";
    }
    if line.contains("Exception")
        || line.contains("ERROR")
        || line.starts_with("  at ")
        || line.starts_with("UnityEngine.")
    {
        return "error";
    }
    "info"
}

// Shared tail reader: seek to the last `tail_bytes` of the file, drop the
// partial first line, then classify each remaining line. Opens with shared
// read access so it works while Valheim still holds the file open.
fn read_tail(path: &Path, tail_bytes: u64, classify: fn(&str) -> &'static str) -> Result<Vec<LogLine>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();

    let mut reader = BufReader::new(file);
    if size > tail_bytes {
        reader.seek(SeekFrom::End(-(tail_bytes as i64))).map_err(|e| e.to_string())?;
        // Skip partial first line
        let mut _discard = String::new();
        let _ = reader.read_line(&mut _discard);
    }

    let mut lines = Vec::new();
    for line_result in reader.lines() {
        if let Ok(line) = line_result {
            lines.push(LogLine {
                level: classify(&line).to_string(),
                text: line,
            });
        }
    }

    Ok(lines)
}

fn file_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

// Valheim's Unity output log. Fixed by Unity's company/product name
// (IronGate/Valheim) regardless of mod manager or install location.
fn player_log_path() -> Option<PathBuf> {
    let user_profile = std::env::var("USERPROFILE").ok()?;
    Some(PathBuf::from(user_profile).join(r"AppData\LocalLow\IronGate\Valheim\Player.log"))
}

// ── BepInEx log (LogOutput.log under the active profile) ──────────────

#[command]
pub fn read_log_file(bepinex_path: String, max_lines: Option<usize>) -> Result<Vec<LogLine>, String> {
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&log_path).map_err(|e| e.to_string())?;
    let max = max_lines.unwrap_or(1000);
    let lines: Vec<LogLine> = content
        .lines()
        .rev()
        .take(max)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|line| LogLine {
            level: classify_level(line).to_string(),
            text: line.to_string(),
        })
        .collect();

    Ok(lines)
}

#[command]
pub fn read_log_tail(bepinex_path: String, tail_bytes: Option<u64>) -> Result<Vec<LogLine>, String> {
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    read_tail(&log_path, tail_bytes.unwrap_or(65536), classify_level)
}

#[command]
pub fn get_log_size(bepinex_path: String) -> Result<u64, String> {
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    file_size(&log_path)
}

#[command]
pub fn clear_log(bepinex_path: String) -> Result<(), String> {
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    if log_path.exists() {
        fs::write(&log_path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub fn save_log_file(bepinex_path: String, dest_path: String) -> Result<(), String> {
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    if !log_path.exists() {
        return Err("LogOutput.log not found".to_string());
    }
    fs::copy(&log_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Valheim Player.log (Unity output log in LocalLow) ─────────────────

/// Resolve the Player.log path, returning it only when the file exists so the
/// UI can hide the tab / disable actions when Valheim has never logged.
#[command]
pub fn get_player_log_path() -> Option<String> {
    player_log_path()
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
}

#[command]
pub fn read_player_log_tail(tail_bytes: Option<u64>) -> Result<Vec<LogLine>, String> {
    match player_log_path() {
        Some(path) => read_tail(&path, tail_bytes.unwrap_or(65536), classify_player_level),
        None => Ok(Vec::new()),
    }
}

#[command]
pub fn get_player_log_size() -> Result<u64, String> {
    match player_log_path() {
        Some(path) => file_size(&path),
        None => Ok(0),
    }
}

#[command]
pub fn save_player_log_file(dest_path: String) -> Result<(), String> {
    let log_path = player_log_path().ok_or_else(|| "USERPROFILE not set".to_string())?;
    if !log_path.exists() {
        return Err("Player.log not found".to_string());
    }
    fs::copy(&log_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn save_text_file(dest_path: String, content: String) -> Result<(), String> {
    fs::write(&dest_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}
