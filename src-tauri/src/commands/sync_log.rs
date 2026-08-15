use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::command;

const SYNC_EVENTS_FILE: &str = "sync-events.jsonl";
// Cap retained lines so the file doesn't grow unbounded across sessions.
const MAX_RETAINED_EVENTS: usize = 1000;

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn events_path() -> PathBuf {
    megaload_dir().join(SYNC_EVENTS_FILE)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncEvent {
    /// Monotonic per-process counter mixed with start-of-process secs.
    /// Distinct from `timestamp` so the UI can de-dupe stable across same-second writes.
    pub id: String,
    /// ISO-8601 in UTC.
    pub timestamp: String,
    /// "PushAll" | "PullBundle" | "PushPlayerData" | "PullPlayerData" |
    /// "ReconcilePlayerData" | "PullMegaLists" | "ReconcileMegaLists" |
    /// "ToggleEnabled" | "ToggleAutoSync"
    pub action: String,
    /// "success" | "skipped" | "noop" | "failed"
    pub result: String,
    /// Human-readable summary (e.g. "3 profiles", "12 lists merged", "no changes").
    pub detail: String,
}

static EVENT_COUNTER: AtomicU64 = AtomicU64::new(0);

fn iso_now() -> String {
    // Cheap ISO formatter — same flavour as sync.rs::iso_now.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let secs_per_day: i64 = 86400;
    let d = secs / secs_per_day;
    let tod = secs % secs_per_day;
    let hours = tod / 3600;
    let minutes = (tod % 3600) / 60;
    let seconds = tod % 60;

    let mut y = 1970i64;
    let mut remaining = d;
    loop {
        let dy = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < dy {
            break;
        }
        remaining -= dy;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let md = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for (i, &n) in md.iter().enumerate() {
        if remaining < n as i64 {
            m = i;
            break;
        }
        remaining -= n as i64;
    }
    let day = remaining + 1;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m + 1, day, hours, minutes, seconds)
}

fn make_id() -> String {
    let n = EVENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{:x}-{:x}", secs, n)
}

/// Append a sync event. Best-effort: failures here must never abort a sync flow.
pub fn emit(action: &str, result: &str, detail: impl Into<String>) {
    let event = SyncEvent {
        id: make_id(),
        timestamp: iso_now(),
        action: action.to_string(),
        result: result.to_string(),
        detail: detail.into(),
    };

    let dir = megaload_dir();
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    let line = match serde_json::to_string(&event) {
        Ok(s) => s,
        Err(_) => return,
    };

    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(events_path())
    {
        let _ = writeln!(f, "{}", line);
    }
}

/// Read the most recent events, newest last (chronological order).
#[command(async)]
pub fn read_sync_events(limit: Option<usize>) -> Result<Vec<SyncEvent>, String> {
    let path = events_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut events: Vec<SyncEvent> = data
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<SyncEvent>(l).ok())
        .collect();

    // Trim file on the fly if it has grown past the cap. Cheap because we're
    // already paying the read.
    if events.len() > MAX_RETAINED_EVENTS {
        let excess = events.len() - MAX_RETAINED_EVENTS;
        events.drain(0..excess);
        let trimmed: String = events
            .iter()
            .filter_map(|e| serde_json::to_string(e).ok())
            .collect::<Vec<_>>()
            .join("\n");
        let _ = fs::write(&path, format!("{}\n", trimmed));
    }

    let limit = limit.unwrap_or(MAX_RETAINED_EVENTS);
    if events.len() > limit {
        let start = events.len() - limit;
        events.drain(0..start);
    }

    Ok(events)
}

#[command(async)]
pub fn clear_sync_events() -> Result<(), String> {
    let path = events_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
