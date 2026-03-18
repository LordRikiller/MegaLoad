use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
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
    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(&log_path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let size = metadata.len();
    let tail = tail_bytes.unwrap_or(65536); // Last 64KB by default

    let mut reader = BufReader::new(file);
    if size > tail {
        reader.seek(SeekFrom::End(-(tail as i64))).map_err(|e| e.to_string())?;
        // Skip partial first line
        let mut _discard = String::new();
        let _ = reader.read_line(&mut _discard);
    }

    let mut lines = Vec::new();
    for line_result in reader.lines() {
        if let Ok(line) = line_result {
            lines.push(LogLine {
                level: classify_level(&line).to_string(),
                text: line,
            });
        }
    }

    Ok(lines)
}

#[command]
pub fn get_log_size(bepinex_path: String) -> Result<u64, String> {
    let log_path = Path::new(&bepinex_path).join("LogOutput.log");
    if !log_path.exists() {
        return Ok(0);
    }
    let metadata = fs::metadata(&log_path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
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

#[command]
pub fn save_text_file(dest_path: String, content: String) -> Result<(), String> {
    fs::write(&dest_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}
