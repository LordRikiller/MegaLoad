//! World Map sync between machines, over the same MegaWorker → MegaBugs-repo
//! channel the rest of cloud sync uses.
//!
//! What travels is the BUILT world (atlas.json ~1 MB + basemap.webp ~8 MB),
//! never the 1.5 GB valheim-map.world download: a second machine gets the map
//! without re-downloading or re-rendering anything.
//!
//! Remote layout, under `sync/<user_id>/maps/`:
//!   index.json                 worlds, tombstones and trader marks
//!   <world id>/atlas.json      written once per build
//!   <world id>/basemap.webp    written once per build
//!
//! A world's files are immutable for a given build (keyed by their sha256 in the
//! index), so the steady state is one small GET of index.json and nothing else.
//!
//! Merge rules, same spirit as the profile ledger in sync.rs:
//! - A world exists unless a tombstone at least as new as it says otherwise;
//!   re-importing a deleted world (newer `updatedAt`) lifts the tombstone.
//! - The same world id built twice: the newer `updatedAt` wins.
//! - Trader marks merge per seed, last writer wins. Tombstones never expire.

use crate::commands::app_log::app_log;
use crate::commands::github::{
    github_delete_file, github_get_bytes_opt, github_list_dir_opt, github_put_file_with_retry,
};
use crate::commands::identity::get_megaload_identity;
use crate::commands::map_atlas::{
    install_world, list_packs, now_secs, read_marks, remove_world_files, sha256_hex, valid_id,
    write_marks, MarksFile, PackInfo,
};
use crate::commands::sync::load_sync_settings;
use crate::commands::sync_log;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{command, AppHandle, Emitter};

static SYNCING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RemoteIndex {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    worlds: Vec<PackInfo>,
    /// world id → unix secs it was deleted.
    #[serde(default)]
    removed: BTreeMap<String, u64>,
    #[serde(default)]
    marks: MarksFile,
}

impl PartialEq for PackInfo {
    fn eq(&self, o: &Self) -> bool {
        self.id == o.id
            && self.atlas_sha == o.atlas_sha
            && self.basemap_sha == o.basemap_sha
            && self.updated_at == o.updated_at
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct LocalSync {
    #[serde(default)]
    removed: BTreeMap<String, u64>,
}

fn local_sync_path() -> std::path::PathBuf {
    crate::commands::map_atlas::maps_dir().join("sync.json")
}

fn read_local() -> LocalSync {
    fs::read_to_string(local_sync_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_local(s: &LocalSync) {
    let _ = fs::create_dir_all(crate::commands::map_atlas::maps_dir());
    if let Ok(t) = serde_json::to_string_pretty(s) {
        let _ = fs::write(local_sync_path(), t);
    }
}

/// Called when the player deletes a world here.
pub fn add_tombstone(id: &str) {
    let mut s = read_local();
    s.removed.insert(id.to_string(), now_secs());
    write_local(&s);
}

/// Called when a world is (re)imported here: a fresh build outranks a delete.
pub fn clear_tombstone(id: &str) {
    let mut s = read_local();
    if s.removed.remove(id).is_some() {
        write_local(&s);
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSyncReport {
    /// Set when nothing was attempted, with the reason.
    pub skipped: Option<String>,
    pub pushed: Vec<String>,
    pub pulled: Vec<String>,
    pub removed: Vec<String>,
    pub marks_changed: bool,
}

fn emit(app: Option<&AppHandle>, detail: &str) {
    app_log(&format!("[map-sync] {detail}"));
    if let Some(a) = app {
        let _ = a.emit("map-sync-progress", detail.to_string());
    }
}

fn base_path(uid: &str) -> String {
    format!("sync/{uid}/maps")
}

fn fetch_index(base: &str) -> Result<(RemoteIndex, Option<String>), String> {
    match github_get_bytes_opt(&format!("{base}/index.json"))? {
        None => Ok((RemoteIndex::default(), None)),
        Some((bytes, sha)) => {
            let idx: RemoteIndex = serde_json::from_slice(&bytes)
                .map_err(|e| format!("the remote map index is unreadable: {e}"))?;
            Ok((idx, Some(sha)))
        }
    }
}

fn put_file(path: &str, bytes: &[u8], message: &str) -> Result<(), String> {
    // Existing sha (if any) is needed to overwrite; look it up lazily.
    let dir = path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let lookup = || -> Result<Option<String>, String> {
        Ok(github_list_dir_opt(dir)?
            .into_iter()
            .find(|(p, _)| p == path)
            .map(|(_, s)| s))
    };
    let mut sha = lookup()?;
    github_put_file_with_retry(path, message, 3, |attempt| {
        if attempt > 1 {
            sha = lookup()?;
        }
        Ok((bytes.to_vec(), sha.clone()))
    })?;
    Ok(())
}

fn download_world(base: &str, e: &PackInfo) -> Result<(), String> {
    if !valid_id(&e.id) || e.basemap.contains(['/', '\\']) || e.basemap.starts_with('.') {
        return Err(format!("remote world entry {:?} is malformed", e.id));
    }
    let atlas = github_get_bytes_opt(&format!("{base}/{}/atlas.json", e.id))?
        .ok_or_else(|| format!("{}: atlas.json is missing on the server", e.id))?
        .0;
    let basemap = github_get_bytes_opt(&format!("{base}/{}/{}", e.id, e.basemap))?
        .ok_or_else(|| format!("{}: basemap is missing on the server", e.id))?
        .0;
    if sha256_hex(&atlas) != e.atlas_sha || sha256_hex(&basemap) != e.basemap_sha {
        return Err(format!("{}: downloaded files do not match the index (half-uploaded?)", e.id));
    }
    let mut info = e.clone();
    info.source = "sync".into();
    install_world(&info, &atlas, &basemap)
}

fn upload_world(base: &str, w: &PackInfo) -> Result<(), String> {
    let dir = crate::commands::map_atlas::world_dir(&w.id);
    let atlas = fs::read(dir.join("atlas.json")).map_err(|e| e.to_string())?;
    let basemap = fs::read(dir.join(&w.basemap)).map_err(|e| e.to_string())?;
    let msg = format!("MegaLoad map sync: {}", w.id);
    put_file(&format!("{base}/{}/atlas.json", w.id), &atlas, &msg)?;
    put_file(&format!("{base}/{}/{}", w.id, w.basemap), &basemap, &msg)?;
    Ok(())
}

fn merge_marks(a: &MarksFile, b: &MarksFile) -> MarksFile {
    let mut out = a.clone();
    for (seed, m) in b {
        match out.get(seed) {
            Some(cur) if cur.updated_at >= m.updated_at => {}
            _ => {
                out.insert(seed.clone(), m.clone());
            }
        }
    }
    out
}

fn sync_once(app: Option<&AppHandle>, report: &mut MapSyncReport, uploaded: &mut HashSet<(String, String)>) -> Result<bool, String> {
    let identity = get_megaload_identity()?;
    let base = base_path(&identity.user_id);
    emit(app, "checking the cloud copy");
    let (remote, remote_sha) = fetch_index(&base)?;

    // Tombstones: union, newest delete wins.
    let mut local_sync = read_local();
    let mut tombs = local_sync.removed.clone();
    for (id, t) in &remote.removed {
        let e = tombs.entry(id.clone()).or_insert(0);
        *e = (*e).max(*t);
    }

    // A delete made elsewhere reaches this machine.
    for w in list_packs() {
        if let Some(&t) = tombs.get(&w.id) {
            if t >= w.updated_at {
                emit(app, &format!("removing {} (deleted on another machine)", w.id));
                remove_world_files(&w.id)?;
                report.removed.push(w.id.clone());
            } else {
                tombs.remove(&w.id); // re-imported since the delete
            }
        }
    }

    // Pull what the other machines have that this one does not (or has older).
    let local: HashMap<String, PackInfo> = list_packs().into_iter().map(|w| (w.id.clone(), w)).collect();
    for e in &remote.worlds {
        if let Some(&t) = tombs.get(&e.id) {
            if t >= e.updated_at {
                continue;
            }
            tombs.remove(&e.id);
        }
        let want = match local.get(&e.id) {
            None => true,
            Some(l) => (l.atlas_sha != e.atlas_sha || l.basemap_sha != e.basemap_sha) && e.updated_at > l.updated_at,
        };
        if want {
            emit(app, &format!("downloading {} ({:.1} MB)", e.id, (e.atlas_bytes + e.basemap_bytes) as f64 / 1e6));
            download_world(&base, e)?;
            report.pulled.push(e.id.clone());
        }
    }

    // Push what only this machine has (or has newer).
    let remote_by_id: HashMap<&str, &PackInfo> = remote.worlds.iter().map(|w| (w.id.as_str(), w)).collect();
    let mut worlds: Vec<PackInfo> = Vec::new();
    for w in list_packs() {
        let same = remote_by_id
            .get(w.id.as_str())
            .map_or(false, |r| r.atlas_sha == w.atlas_sha && r.basemap_sha == w.basemap_sha);
        if same {
            worlds.push((*remote_by_id[w.id.as_str()]).clone());
            continue;
        }
        let key = (w.id.clone(), w.basemap_sha.clone());
        if !uploaded.contains(&key) {
            emit(app, &format!("uploading {} ({:.1} MB)", w.id, (w.atlas_bytes + w.basemap_bytes) as f64 / 1e6));
            upload_world(&base, &w)?;
            uploaded.insert(key);
            report.pushed.push(w.id.clone());
        }
        let mut entry = w.clone();
        entry.source = String::new(); // per-machine detail, not part of the shared record
        worlds.push(entry);
    }
    worlds.sort_by(|a, b| a.id.cmp(&b.id));

    // Trader marks.
    let local_marks = read_marks();
    let marks = merge_marks(&local_marks, &remote.marks);
    if marks != local_marks {
        write_marks(&marks)?;
        report.marks_changed = true;
    }

    let next = RemoteIndex { version: 1, worlds, removed: tombs.clone(), marks };
    if next != remote {
        emit(app, "updating the cloud index");
        let body = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        let res = github_put_file_with_retry(
            &format!("{base}/index.json"),
            "MegaLoad map sync: index",
            1,
            |_| Ok((body.clone(), remote_sha.clone())),
        );
        match res {
            Ok(_) => {}
            Err(e) if crate::commands::github::is_conflict_error(&e) => return Ok(false), // re-merge
            Err(e) => return Err(e),
        }
    }
    local_sync.removed = tombs.clone();
    write_local(&local_sync);

    // Tidy: files of deleted worlds no longer need to sit in the repo. Best effort.
    for id in tombs.keys() {
        if !valid_id(id) {
            continue;
        }
        if let Ok(files) = github_list_dir_opt(&format!("{base}/{id}")) {
            for (path, sha) in files {
                if let Err(e) = github_delete_file(&path, &sha, &format!("MegaLoad map sync: remove {id}")) {
                    app_log(&format!("[map-sync] could not delete {path}: {e}"));
                }
            }
        }
    }
    Ok(true)
}

pub fn map_sync_impl(app: Option<&AppHandle>) -> Result<MapSyncReport, String> {
    let mut report = MapSyncReport::default();
    if !load_sync_settings().enabled {
        report.skipped = Some("Cloud sync is off (Settings → Cloud Sync).".into());
        return Ok(report);
    }
    if SYNCING.swap(true, Ordering::SeqCst) {
        report.skipped = Some("A map sync is already running.".into());
        return Ok(report);
    }
    let mut uploaded = HashSet::new();
    let mut result = Err("map sync gave up after repeated conflicts".to_string());
    for _ in 0..3 {
        match sync_once(app, &mut report, &mut uploaded) {
            Ok(true) => {
                result = Ok(());
                break;
            }
            Ok(false) => continue,
            Err(e) => {
                result = Err(e);
                break;
            }
        }
    }
    SYNCING.store(false, Ordering::SeqCst);

    match result {
        Ok(()) => {
            let changed = report.pushed.len() + report.pulled.len() + report.removed.len();
            let detail = if changed == 0 && !report.marks_changed {
                "maps up to date".to_string()
            } else {
                format!(
                    "maps: {} pushed, {} pulled, {} removed{}",
                    report.pushed.len(),
                    report.pulled.len(),
                    report.removed.len(),
                    if report.marks_changed { ", marks merged" } else { "" }
                )
            };
            sync_log::emit("SyncMaps", if changed == 0 { "noop" } else { "success" }, detail.clone());
            emit(app, &detail);
            Ok(report)
        }
        Err(e) => {
            sync_log::emit("SyncMaps", "failed", e.clone());
            Err(e)
        }
    }
}

#[command]
pub async fn map_sync(app: AppHandle) -> Result<MapSyncReport, String> {
    tauri::async_runtime::spawn_blocking(move || map_sync_impl(Some(&app)))
        .await
        .map_err(|e| format!("map sync task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::map_atlas::SeedMarks;

    /// Live round trip against MegaWorker with this machine's identity:
    /// install a built world, push it, drop the local copy, pull it back.
    /// `MAP_BUILT=<dir with pack.json/atlas.json/basemap.webp> cargo test
    /// --release live_sync_roundtrip -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_sync_roundtrip() {
        let dir = std::path::PathBuf::from(std::env::var("MAP_BUILT").expect("MAP_BUILT"));
        let info: PackInfo = serde_json::from_slice(&fs::read(dir.join("pack.json")).unwrap()).unwrap();
        let atlas = fs::read(dir.join("atlas.json")).unwrap();
        let basemap = fs::read(dir.join("basemap.webp")).unwrap();
        install_world(&info, &atlas, &basemap).unwrap();
        let t = std::time::Instant::now();
        let r1 = map_sync_impl(None).unwrap();
        eprintln!("push: {r1:?} in {:.1}s", t.elapsed().as_secs_f64());
        let r2 = map_sync_impl(None).unwrap();
        eprintln!("again: {r2:?}");
        assert!(r2.pushed.is_empty() && r2.pulled.is_empty());
        remove_world_files(&info.id).unwrap(); // lost locally, no tombstone
        let t = std::time::Instant::now();
        let r3 = map_sync_impl(None).unwrap();
        eprintln!("pull: {r3:?} in {:.1}s", t.elapsed().as_secs_f64());
        assert_eq!(r3.pulled, vec![info.id.clone()]);
        let back = crate::commands::map_atlas::read_pack(&info.id).unwrap();
        assert_eq!(back.basemap_sha, info.basemap_sha);
    }

    #[test]
    fn marks_merge_last_writer_wins_per_seed() {
        let mut a = MarksFile::new();
        a.insert("S".into(), SeedMarks { traders: vec![1], updated_at: 10 });
        a.insert("T".into(), SeedMarks { traders: vec![5], updated_at: 50 });
        let mut b = MarksFile::new();
        b.insert("S".into(), SeedMarks { traders: vec![], updated_at: 20 });
        b.insert("T".into(), SeedMarks { traders: vec![6], updated_at: 40 });
        b.insert("U".into(), SeedMarks { traders: vec![7], updated_at: 1 });
        let m = merge_marks(&a, &b);
        assert_eq!(m["S"].traders, Vec::<u32>::new()); // cleared later elsewhere
        assert_eq!(m["T"].traders, vec![5]);
        assert_eq!(m["U"].traders, vec![7]);
    }
}
