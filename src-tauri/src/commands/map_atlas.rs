//! World Map: turns a valheim-map.world "All Data" export into an atlas pack,
//! keeps one pack per world, and serves them to the Map page.
//!
//! This is a port of MapAtlas's Python pipeline (build_atlas.py, render_map.py
//! and export_web.py's `--pack` path), so the pack it writes is the same shape
//! MegaServer imports: `pack.json` + `atlas.json` + `basemap.webp`. Players do
//! not have Python, and the export is 1.5 GB of tiles, so everything here reads
//! the downloaded zip in place — nothing is extracted to disk.
//!
//! Formulas, constants and ordering follow the Python line for line; where they
//! differ (forest stored as its 0..1 mask, the shoreline as a distance rather
//! than repeated dilations) the result is the same per pixel.
//!
//! Layout on disk: `%APPDATA%\MegaLoad\maps\<world id>\{pack.json, atlas.json,
//! basemap.webp}`, plus `maps\state.json` (which world is open on this machine)
//! and `maps\marks.json` (trader sites the player has confirmed, per seed).

use crate::commands::app_log::app_log;
use flate2::read::GzDecoder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter};

pub const PACK_SCHEMA: u32 = 1;
const BASEMAP_NAME: &str = "basemap.webp";

// --- render constants (render_map.py) ----------------------------------------

const WATER_LEVEL: f32 = 30.0;
const FOREST_THRESHOLD: f32 = 1.15;
const FOREST_RAMP: f32 = 0.50;
const SAND: [f32; 3] = [188.0, 171.0, 128.0]; // #BCAB80
const SAND_METRES: f32 = 14.0;
const SAND_STRENGTH: f32 = 0.7;
const WATER_SHALLOW: [f32; 3] = [53.0, 100.0, 140.0]; // #35648C
const WATER_DEEP: [f32; 3] = [19.0, 42.0, 69.0]; // #132A45
const WATER_DEPTH: f32 = 11.0;
const WATER_CLARITY: f32 = 1.8;
const SHORE_SOFT: f32 = 1.0;
const SHALLOW_HOLD: f32 = 1.6;
const OFF_WORLD_LO: f32 = -390.0;
const OFF_WORLD_HI: f32 = -300.0;
const NATIVE_CAP: usize = 8192; // WebP tops out at 16,383 px; MegaServer ships 8192
const EXAGGERATION: f32 = 1.6;
const AZIMUTH: f32 = 315.0;
const ALTITUDE: f32 = 45.0;
const AMBIENT: f32 = 0.45;
const MAX_LIGHT: f32 = 1.42;
const WEBP_QUALITY: f32 = 92.0;
const STRIDE: usize = 10; // u16 biome + f32 height + f32 forest, packed

/// (biome id, name, base, canopy, forest weight). Index in this table is the
/// palette index the render grid stores; anything unknown maps to UNKNOWN,
/// which draws black exactly as the Python lookup table's empty rows do.
const BIOMES: [(u16, &str, [f32; 3], [f32; 3], f32); 10] = [
    (0, "None", [42.0, 46.0, 54.0], [42.0, 46.0, 54.0], 0.00),
    (1, "Meadows", [119.0, 145.0, 75.0], [63.0, 87.0, 41.0], 0.38),
    (2, "Swamp", [107.0, 91.0, 62.0], [59.0, 52.0, 35.0], 0.34),
    (4, "Mountain", [226.0, 232.0, 240.0], [180.0, 190.0, 204.0], 0.06),
    (8, "BlackForest", [71.0, 89.0, 47.0], [30.0, 43.0, 22.0], 0.66),
    (16, "Plains", [173.0, 149.0, 83.0], [120.0, 106.0, 54.0], 0.30),
    (32, "AshLands", [122.0, 51.0, 36.0], [74.0, 28.0, 20.0], 0.00),
    (64, "DeepNorth", [214.0, 226.0, 236.0], [170.0, 185.0, 201.0], 0.05),
    (256, "Ocean", [46.0, 90.0, 135.0], [46.0, 90.0, 135.0], 0.00),
    (512, "Mistlands", [79.0, 75.0, 88.0], [42.0, 40.0, 49.0], 0.46),
];
const UNKNOWN: u8 = 255;
const OCEAN_IDX: u8 = 8;

fn palette_index(id: u16) -> u8 {
    BIOMES
        .iter()
        .position(|b| b.0 == id)
        .map(|i| i as u8)
        .unwrap_or(UNKNOWN)
}

fn biome_name(id: u16) -> String {
    BIOMES
        .iter()
        .find(|b| b.0 == id)
        .map(|b| b.1.to_string())
        .unwrap_or_else(|| id.to_string())
}

// --- paths --------------------------------------------------------------------

fn megaload_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|r| PathBuf::from(r).join("MegaLoad"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn maps_dir() -> PathBuf {
    megaload_dir().join("maps")
}

pub fn world_dir(id: &str) -> PathBuf {
    maps_dir().join(id)
}

/// A world id is a filesystem name and a sync path segment, so it is kept to
/// a conservative alphabet. Same rule as MapAtlas's `paths.slug`.
fn slug(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' { c } else { '-' })
        .collect();
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "world".into() } else { out }
}

pub fn world_id(seed: &str, version: &str) -> String {
    format!("{}-{}", slug(seed), slug(version))
}

/// Ids arrive from the frontend and from the sync index; never let one walk
/// out of the maps folder.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn iso_utc(secs: u64) -> String {
    // Civil-from-days (Howard Hinnant), so no date crate is needed for one stamp.
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, rem / 3600, (rem / 60) % 60, rem % 60
    )
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

// --- pack metadata ------------------------------------------------------------

/// `pack.json`. The first eight fields are MegaServer's pack schema verbatim,
/// so a world built here can be exported straight to MegaServer; the rest are
/// MegaLoad's own bookkeeping, which MegaServer's reader ignores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub schema: u32,
    pub seed: String,
    pub world_version: String,
    pub world: f64,
    pub edge: f64,
    pub locations: usize,
    pub basemap: String,
    pub built_at: String,
    #[serde(default)]
    pub id: String,
    /// sha256 of atlas.json / basemap.webp: the sync key and the integrity check.
    #[serde(default)]
    pub atlas_sha: String,
    #[serde(default)]
    pub basemap_sha: String,
    #[serde(default)]
    pub atlas_bytes: u64,
    #[serde(default)]
    pub basemap_bytes: u64,
    /// Unix secs this copy of the world was created (imported or pulled). The
    /// sync merge compares it against tombstones.
    #[serde(default)]
    pub updated_at: u64,
    /// "export" (built here from a valheim-map.world zip), "pack" (a MapAtlas /
    /// MegaServer pack), or "sync" (pulled from another machine).
    #[serde(default)]
    pub source: String,
    /// The export's tile grid, e.g. 16 for an Ultra download. 0 when unknown.
    #[serde(default)]
    pub tile_side: u32,
}

pub fn read_pack(id: &str) -> Option<PackInfo> {
    let dir = world_dir(id);
    let text = fs::read_to_string(dir.join("pack.json")).ok()?;
    let mut info: PackInfo = serde_json::from_str(&text).ok()?;
    if !dir.join(&info.basemap).exists() || !dir.join("atlas.json").exists() {
        return None;
    }
    if info.id.is_empty() {
        info.id = id.to_string();
    }
    Some(info)
}

pub fn list_packs() -> Vec<PackInfo> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(maps_dir()) {
        for e in rd.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if !valid_id(&name) {
                continue; // .incoming / .outgoing staging folders
            }
            if let Some(p) = read_pack(&name) {
                out.push(p);
            }
        }
    }
    out.sort_by(|a, b| a.seed.to_lowercase().cmp(&b.seed.to_lowercase()).then(b.world_version.cmp(&a.world_version)));
    out
}

/// Install a built world atomically: stage, swap, then drop the old copy, so a
/// failure part-way leaves the previous version of the world in place.
pub fn install_world(info: &PackInfo, atlas: &[u8], basemap: &[u8]) -> Result<(), String> {
    if !valid_id(&info.id) {
        return Err(format!("bad world id {:?}", info.id));
    }
    let root = maps_dir();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let live = root.join(&info.id);
    let incoming = root.join(format!(".{}.incoming", info.id));
    let outgoing = root.join(format!(".{}.outgoing", info.id));
    let _ = fs::remove_dir_all(&incoming);
    let _ = fs::remove_dir_all(&outgoing);
    fs::create_dir_all(&incoming).map_err(|e| e.to_string())?;
    let write = || -> Result<(), String> {
        fs::write(incoming.join("atlas.json"), atlas).map_err(|e| e.to_string())?;
        fs::write(incoming.join(&info.basemap), basemap).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
        fs::write(incoming.join("pack.json"), text + "\n").map_err(|e| e.to_string())?;
        Ok(())
    };
    if let Err(e) = write() {
        let _ = fs::remove_dir_all(&incoming);
        return Err(format!("could not write the world: {e}"));
    }
    if live.exists() {
        fs::rename(&live, &outgoing).map_err(|e| format!("could not replace the old copy: {e}"))?;
    }
    if let Err(e) = fs::rename(&incoming, &live) {
        if outgoing.exists() {
            let _ = fs::rename(&outgoing, &live);
        }
        return Err(format!("could not install the world: {e}"));
    }
    let _ = fs::remove_dir_all(&outgoing);
    Ok(())
}

pub fn remove_world_files(id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("bad world id {id:?}"));
    }
    let dir = world_dir(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("could not delete {id}: {e}"))?;
    }
    Ok(())
}

// --- local state + marks ------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct MapState {
    #[serde(default)]
    active: Option<String>,
}

fn read_state() -> MapState {
    fs::read_to_string(maps_dir().join("state.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_state(s: &MapState) -> Result<(), String> {
    fs::create_dir_all(maps_dir()).map_err(|e| e.to_string())?;
    fs::write(
        maps_dir().join("state.json"),
        serde_json::to_string_pretty(s).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Trader sites the player has confirmed for one seed. Valheim lays down ten
/// candidate sites per trader and only the first one discovered holds them; the
/// export cannot know which, only the player can. Kept per seed (a world reset
/// moves every answer) with a timestamp so two machines merge last-writer-wins.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeedMarks {
    #[serde(default)]
    pub traders: Vec<u32>,
    #[serde(default)]
    pub updated_at: u64,
}

pub type MarksFile = BTreeMap<String, SeedMarks>;

pub fn read_marks() -> MarksFile {
    fs::read_to_string(maps_dir().join("marks.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn write_marks(m: &MarksFile) -> Result<(), String> {
    fs::create_dir_all(maps_dir()).map_err(|e| e.to_string())?;
    fs::write(
        maps_dir().join("marks.json"),
        serde_json::to_string_pretty(m).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("could not save map marks: {e}"))
}

// --- sources: a zip read in place, or an already-extracted folder -------------

#[derive(Debug, Clone)]
enum Source {
    /// `prefix` is the folder inside the zip that holds map.json ("data/").
    Zip { path: PathBuf, prefix: String },
    Dir { root: PathBuf },
}

impl Source {
    fn open(path: &Path) -> Result<(Source, SourceKind), String> {
        if path.is_dir() {
            for root in [path.to_path_buf(), path.join("data")] {
                if root.join("map.json").exists() && root.join("locations.json").exists() {
                    return Ok((Source::Dir { root }, SourceKind::Export));
                }
            }
            return Err("That folder has no map.json + locations.json. Pick the valheim-map.world \"All Data\" zip, or the folder it was unzipped to.".into());
        }
        let f = fs::File::open(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
        let zip = zip::ZipArchive::new(f).map_err(|e| format!("not a readable zip: {e}"))?;
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
        // A MapAtlas / MegaServer pack: pack.json at the root.
        if names.iter().any(|n| n == "pack.json") {
            return Ok((Source::Zip { path: path.to_path_buf(), prefix: String::new() }, SourceKind::Pack));
        }
        for n in &names {
            if let Some(prefix) = n.strip_suffix("map.json") {
                if prefix.is_empty() || prefix.ends_with('/') {
                    let loc = format!("{prefix}locations.json");
                    if names.iter().any(|x| *x == loc) {
                        return Ok((
                            Source::Zip { path: path.to_path_buf(), prefix: prefix.to_string() },
                            SourceKind::Export,
                        ));
                    }
                }
            }
        }
        Err("This zip is not a valheim-map.world export: it has no map.json + locations.json. Download \"All Data\" rather than \"Image Only\".".into())
    }

    /// One handle per worker thread; the zip's central directory is a few KB.
    fn reader(&self) -> Result<Reader, String> {
        match self {
            Source::Zip { path, prefix } => {
                let f = fs::File::open(path).map_err(|e| e.to_string())?;
                let zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
                Ok(Reader::Zip(Box::new(zip), prefix.clone()))
            }
            Source::Dir { root } => Ok(Reader::Dir(root.clone())),
        }
    }
}

enum Reader {
    Zip(Box<zip::ZipArchive<fs::File>>, String),
    Dir(PathBuf),
}

impl Reader {
    fn read(&mut self, rel: &str) -> Result<Vec<u8>, String> {
        match self {
            Reader::Zip(zip, prefix) => {
                let name = format!("{prefix}{rel}");
                let mut f = zip.by_name(&name).map_err(|e| format!("{name}: {e}"))?;
                let mut out = Vec::with_capacity(f.size() as usize);
                f.read_to_end(&mut out).map_err(|e| format!("{name}: {e}"))?;
                Ok(out)
            }
            Reader::Dir(root) => {
                let p = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
                fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))
            }
        }
    }

    fn has(&mut self, rel: &str) -> bool {
        match self {
            Reader::Zip(zip, prefix) => zip.index_for_name(&format!("{prefix}{rel}")).is_some(),
            Reader::Dir(root) => root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)).exists(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SourceKind {
    Export,
    Pack,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
struct MapInfo {
    WorldSeed: String,
    WorldVersion: String,
    TileRowCount: usize,
    TileSize: f64,
    TileSideCount: usize,
    WorldWidth: f64,
}

/// What a file holds, read without building anything — for the confirm step
/// and the Downloads scan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePeek {
    pub path: String,
    pub kind: String,
    pub seed: String,
    pub world_version: String,
    pub id: String,
    pub tile_side: u32,
    pub resolution: u32,
    pub bytes: u64,
    pub modified: u64,
    pub installed: bool,
}

fn peek(path: &Path) -> Result<SourcePeek, String> {
    let (src, kind) = Source::open(path)?;
    let mut r = src.reader()?;
    let meta = fs::metadata(path).ok();
    let bytes = if path.is_dir() { 0 } else { meta.as_ref().map(|m| m.len()).unwrap_or(0) };
    let modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (seed, version, side, rows) = match kind {
        SourceKind::Export => {
            let info: MapInfo = serde_json::from_slice(&r.read("map.json")?)
                .map_err(|e| format!("map.json: {e}"))?;
            (info.WorldSeed, info.WorldVersion, info.TileSideCount, info.TileRowCount)
        }
        SourceKind::Pack => {
            let p: PackInfo = serde_json::from_slice(&r.read("pack.json")?)
                .map_err(|e| format!("pack.json: {e}"))?;
            (p.seed, p.world_version, 0, 0)
        }
    };
    let id = world_id(&seed, &version);
    Ok(SourcePeek {
        path: path.to_string_lossy().to_string(),
        kind: match kind { SourceKind::Export => "export".into(), SourceKind::Pack => "pack".into() },
        installed: read_pack(&id).is_some(),
        seed,
        world_version: version,
        id,
        tile_side: side as u32,
        resolution: (side * rows) as u32,
        bytes,
        modified,
    })
}

// --- progress -----------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: String,
    detail: String,
    /// 0..1 across the whole import.
    fraction: f32,
}

struct Reporter<'a> {
    app: Option<&'a AppHandle>,
}

impl Reporter<'_> {
    fn emit(&self, stage: &str, detail: impl Into<String>, fraction: f32) {
        let detail = detail.into();
        app_log(&format!("[map] {stage}: {detail}"));
        if let Some(app) = self.app {
            let _ = app.emit(
                "map-import-progress",
                Progress { stage: stage.into(), detail, fraction: fraction.clamp(0.0, 1.0) },
            );
        }
    }
}

// --- locations.json -------------------------------------------------------------

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawLoc {
    #[serde(default)]
    PrefabName: Option<String>,
    #[serde(default)]
    Position: Option<String>,
    #[serde(default)]
    ImportantContents: Option<Vec<RawContent>>,
    #[serde(default)]
    DungeonComponents: Option<Vec<RawRoom>>,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawContent {
    #[serde(default)]
    Count: Option<f64>,
    #[serde(default)]
    FriendlyName: Option<String>,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawRoom {
    #[serde(default)]
    ImageKey: Option<RawImageKey>,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawImageKey {
    #[serde(default)]
    Parent: Option<String>,
}

/// "(x, y, z)" → the three numbers, the way build_atlas.py's POS_RE reads it.
fn parse_pos(s: &str) -> Option<(f64, f64, f64)> {
    let mut nums = Vec::with_capacity(3);
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() && nums.len() < 3 {
        let c = b[i];
        if c == b'-' || c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < b.len() && (b[i].is_ascii_digit() || matches!(b[i], b'.' | b'e' | b'E' | b'+' | b'-')) {
                // a '-' only continues a number straight after an exponent marker
                if matches!(b[i], b'+' | b'-') && !matches!(b[i - 1], b'e' | b'E') {
                    break;
                }
                i += 1;
            }
            if let Ok(v) = s[start..i].parse::<f64>() {
                nums.push(v);
            }
        } else {
            i += 1;
        }
    }
    if nums.len() == 3 { Some((nums[0], nums[1], nums[2])) } else { None }
}

/// "Pickable: SurtlingCore" → (Some("Pickable"), "SurtlingCore").
fn split_friendly(fn_: &str) -> (Option<String>, Option<String>) {
    if fn_.is_empty() {
        return (None, None);
    }
    match fn_.split_once(':') {
        Some((head, tail)) => (Some(head.trim().to_string()), Some(tail.trim().to_string())),
        None => (None, Some(fn_.trim().to_string())),
    }
}

// --- atlas.json -----------------------------------------------------------------

/// Field order matches export_web.py's payload dict, so the JSON reads the same.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    seed: String,
    version: String,
    world: f64,
    edge: f64,
    prefabs: Vec<String>,
    biomes: Vec<String>,
    kinds: Vec<String>,
    details: Vec<String>,
    rooms: Vec<String>,
    ids: Vec<u32>,
    p: Vec<u32>,
    x: Vec<f64>,
    y: Vec<f64>,
    z: Vec<f64>,
    b: Vec<u32>,
    h: Vec<f64>,
    f: Vec<f64>,
    s: Vec<u8>,
    c_off: Vec<u32>,
    c_kind: Vec<u32>,
    c_detail: Vec<u32>,
    c_count: Vec<i64>,
    r_off: Vec<u32>,
    r_room: Vec<u32>,
    r_count: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loot: Option<Vec<LootTable>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    c_loot: Option<Vec<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_names: Option<Vec<String>>,
}

#[derive(Serialize, Clone)]
struct LootTable {
    n: [i64; 2],
    c: f64,
    o: u8,
    d: Vec<(u32, i64, i64, f64)>,
}

#[derive(Default)]
struct Interner {
    map: HashMap<String, u32>,
    list: Vec<String>,
}

impl Interner {
    fn get(&mut self, v: Option<&str>) -> u32 {
        let v = v.unwrap_or("");
        if let Some(&i) = self.map.get(v) {
            return i;
        }
        let i = self.list.len() as u32;
        self.map.insert(v.to_string(), i);
        self.list.push(v.to_string());
        i
    }
}

fn round_to(v: f64, places: i32) -> f64 {
    let m = 10f64.powi(places);
    (v * m).round() / m
}

/// Per location, what the tile under it says: (biome id, height, forest).
type Sample = (u16, f32, f32);

fn build_payload(info: &MapInfo, edge: f64, locs: &[RawLoc], pos: &[(f64, f64, f64)], samples: &[Sample]) -> Payload {
    let (mut prefabs, mut biomes, mut kinds, mut details, mut rooms) =
        (Interner::default(), Interner::default(), Interner::default(), Interner::default(), Interner::default());
    let n = locs.len();
    let mut p = Vec::with_capacity(n);
    let (mut x, mut y, mut z) = (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n));
    let (mut b, mut h, mut f, mut s) = (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n));
    let mut c_off = Vec::with_capacity(n + 1);
    let (mut c_kind, mut c_detail, mut c_count) = (Vec::new(), Vec::new(), Vec::new());
    let mut r_off = Vec::with_capacity(n + 1);
    let (mut r_room, mut r_count) = (Vec::new(), Vec::new());

    // Interning order matters for parity with the Python: every prefab and biome
    // first (location order), then kinds/details, then rooms.
    for (i, l) in locs.iter().enumerate() {
        p.push(prefabs.get(l.PrefabName.as_deref()));
        let (px, py, pz) = pos[i];
        x.push(round_to(px, 1));
        y.push(round_to(py, 1));
        z.push(round_to(pz, 1));
        let (bid, th, ff) = samples[i];
        b.push(biomes.get(Some(&biome_name(bid))));
        h.push(round_to(th as f64, 1));
        f.push(round_to(ff as f64, 2));
        s.push(if th < WATER_LEVEL { 1 } else { 0 });
    }

    for l in locs {
        c_off.push(c_kind.len() as u32);
        let mut rows: Vec<(Option<String>, Option<String>, i64)> = l
            .ImportantContents
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|c| {
                let (k, d) = split_friendly(c.FriendlyName.as_deref().unwrap_or(""));
                (k, d, c.Count.unwrap_or(0.0) as i64)
            })
            .collect();
        rows.sort_by(|a, b| b.2.cmp(&a.2)); // stable: count DESC, ties keep export order
        for (k, d, cnt) in rows {
            c_kind.push(kinds.get(k.as_deref()));
            c_detail.push(details.get(d.as_deref()));
            c_count.push(cnt);
        }
    }
    c_off.push(c_kind.len() as u32);

    for l in locs {
        r_off.push(r_room.len() as u32);
        // Distinct rooms in order of first placement, then count DESC (stable).
        let mut rows: Vec<(String, u32)> = Vec::new();
        for c in l.DungeonComponents.as_deref().unwrap_or(&[]) {
            let room = c.ImageKey.as_ref().and_then(|k| k.Parent.clone()).unwrap_or_default();
            match rows.iter_mut().find(|r| r.0 == room) {
                Some(r) => r.1 += 1,
                None => rows.push((room, 1)),
            }
        }
        rows.sort_by(|a, b| b.1.cmp(&a.1));
        for (room, cnt) in rows {
            r_room.push(rooms.get(Some(&room)));
            r_count.push(cnt);
        }
    }
    r_off.push(r_room.len() as u32);

    let mut payload = Payload {
        seed: info.WorldSeed.clone(),
        version: info.WorldVersion.clone(),
        world: info.WorldWidth,
        edge,
        prefabs: prefabs.list,
        biomes: biomes.list,
        kinds: kinds.list,
        details: details.list,
        rooms: rooms.list,
        ids: (1..=n as u32).collect(),
        p, x, y, z, b, h, f, s,
        c_off, c_kind, c_detail, c_count,
        r_off, r_room, r_count,
        loot: None,
        c_loot: None,
        items: None,
        item_names: None,
    };
    attach_loot(&mut payload);
    payload
}

// Chest drop tables, read out of the game's asset bundles by
// tools/unitypy/dump_containers.py: valheim-map.world records which chest sits
// at a location, never what it rolls. Item names are MegaLoad's own list.
const CONTAINERS_JSON: &str = include_str!("../../resources/map/containers.json");
const ITEM_NAMES_JSON: &str = include_str!("../../resources/map/itemNames.json");

#[derive(Deserialize)]
struct ContainersFile {
    containers: Vec<Container>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Container {
    location: String,
    name: String,
    prefab: String,
    drop_min: i64,
    drop_max: i64,
    drop_chance: f64,
    one_of_each: bool,
    drops: Vec<Drop>,
}

#[derive(Deserialize)]
struct Drop {
    item: String,
    min: i64,
    max: i64,
    weight: f64,
}

/// "TreasureChest_forest (3)" → "TreasureChest_forest".
fn strip_copy_suffix(s: &str) -> &str {
    let t = s.trim_end();
    if let Some(open) = t.rfind('(') {
        let inner = &t[open + 1..];
        if let Some(num) = inner.strip_suffix(')') {
            if !num.is_empty() && num.bytes().all(|c| c.is_ascii_digit()) {
                return t[..open].trim_end();
            }
        }
    }
    s
}

fn tokens(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let st = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            out.push(&s[st..i]);
        } else {
            i += 1;
        }
    }
    out
}

fn attach_loot(pl: &mut Payload) {
    let names: HashMap<String, String> = serde_json::from_str(ITEM_NAMES_JSON).unwrap_or_default();
    let mut items = Interner::default();

    if let Ok(cf) = serde_json::from_str::<ContainersFile>(CONTAINERS_JSON) {
        let mut exact: HashMap<(String, String), usize> = HashMap::new();
        let mut by_name: HashMap<String, usize> = HashMap::new();
        let mut by_prefab: HashMap<String, usize> = HashMap::new();
        for (i, c) in cf.containers.iter().enumerate() {
            exact.entry((c.location.clone(), c.name.clone())).or_insert(i);
            by_name.entry(c.name.clone()).or_insert(i);
            by_prefab.entry(c.prefab.clone()).or_insert(i);
        }
        let mut tables: Vec<LootTable> = Vec::new();
        let mut table_idx: HashMap<String, usize> = HashMap::new();
        let container_kind = pl.kinds.iter().position(|k| k == "Container").map(|i| i as u32);
        let mut c_loot = vec![-1i32; pl.c_kind.len()];
        let (mut hit, mut miss) = (0, 0);
        for li in 0..pl.p.len() {
            let loc = &pl.prefabs[pl.p[li] as usize];
            for j in pl.c_off[li] as usize..pl.c_off[li + 1] as usize {
                if Some(pl.c_kind[j]) != container_kind {
                    continue;
                }
                let name = &pl.details[pl.c_detail[j] as usize];
                let found = exact
                    .get(&(loc.clone(), name.clone()))
                    .or_else(|| by_name.get(name))
                    .or_else(|| by_prefab.get(strip_copy_suffix(name)));
                let Some(&ci) = found else {
                    miss += 1;
                    continue;
                };
                let c = &cf.containers[ci];
                let t = LootTable {
                    n: [c.drop_min, c.drop_max],
                    c: c.drop_chance,
                    o: c.one_of_each as u8,
                    d: c.drops.iter().map(|d| (items.get(Some(&d.item)), d.min, d.max, d.weight)).collect(),
                };
                let key = format!("{:?}|{}|{}|{:?}", t.n, t.c, t.o, t.d);
                let idx = *table_idx.entry(key).or_insert_with(|| {
                    tables.push(t);
                    tables.len() - 1
                });
                c_loot[j] = idx as i32;
                hit += 1;
            }
        }
        app_log(&format!("[map] loot: {hit} chests matched to {} drop tables, {miss} with none", tables.len()));
        pl.loot = Some(tables);
        pl.c_loot = Some(c_loot);
    }

    // Items named inside content details ("One Of: Coins[5-20], Ruby[1-2]",
    // "Pickable_Mushroom") get names too, so they search in English as well.
    for d in &pl.details {
        for tok in tokens(d) {
            if names.contains_key(tok) {
                items.get(Some(tok));
            }
            if let Some(rest) = tok.strip_prefix("Pickable_") {
                if names.contains_key(rest) {
                    items.get(Some(rest));
                }
            }
        }
    }
    if !items.list.is_empty() {
        pl.item_names = Some(items.list.iter().map(|id| names.get(id).cloned().unwrap_or_default()).collect());
        pl.items = Some(items.list);
    }
}

// --- the render -----------------------------------------------------------------

/// Assembled world grids at render resolution, row 0 = north, col 0 = west.
struct Grids {
    n: usize,
    height: Vec<f32>,
    /// Palette index (see BIOMES), UNKNOWN for ids the palette lacks.
    biome: Vec<u8>,
    /// smoothstep(clip((1.15 - forest) / 0.5)) quantised to 0..255. The forest
    /// factor reaches the colour only through this mask, so storing the mask
    /// rather than the factor costs nothing and saves 192 MB at 8192 px.
    fmask: Vec<u8>,
}

fn forest_mask(forest: f32) -> u8 {
    let mut t = ((FOREST_THRESHOLD - forest) * (1.0 / FOREST_RAMP)).clamp(0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    (t * 255.0 + 0.5) as u8
}

#[inline]
fn tile_sample(raw: &[u8], off: usize) -> (u16, f32, f32) {
    let bio = u16::from_le_bytes([raw[off], raw[off + 1]]);
    let h = f32::from_le_bytes([raw[off + 2], raw[off + 3], raw[off + 4], raw[off + 5]]);
    let fo = f32::from_le_bytes([raw[off + 6], raw[off + 7], raw[off + 8], raw[off + 9]]);
    (bio, h, fo)
}

/// Manhattan distance to the nearest wet pixel, capped at `cap`. A k-step
/// 4-neighbour dilation covers exactly the pixels within distance k, so the
/// Python's "how many of `steps` dilations reach me" is `steps + 1 - d`.
fn wet_distance(g: &Grids, cap: u8) -> Vec<u8> {
    let n = g.n;
    let mut d: Vec<u8> = (0..n * n)
        .into_par_iter()
        .map(|i| {
            let depth = WATER_LEVEL - g.height[i];
            let wet = if g.biome[i] == OCEAN_IDX { depth > 0.0 } else { depth > SHALLOW_HOLD };
            if wet { 0 } else { cap }
        })
        .collect();
    // Two-pass city-block transform: exact for the 4-neighbour metric.
    for r in 0..n {
        for c in 0..n {
            let i = r * n + c;
            let mut v = d[i];
            if v == 0 {
                continue;
            }
            if r > 0 { v = v.min(d[i - n].saturating_add(1)); }
            if c > 0 { v = v.min(d[i - 1].saturating_add(1)); }
            d[i] = v.min(cap);
        }
    }
    for r in (0..n).rev() {
        for c in (0..n).rev() {
            let i = r * n + c;
            let mut v = d[i];
            if v == 0 {
                continue;
            }
            if r + 1 < n { v = v.min(d[i + n].saturating_add(1)); }
            if c + 1 < n { v = v.min(d[i + 1].saturating_add(1)); }
            d[i] = v.min(cap);
        }
    }
    d
}

fn render_rgba(g: &Grids, metres_per_px: f32, rep: &Reporter) -> Vec<u8> {
    let n = g.n;
    let steps = (SAND_METRES / metres_per_px).round().max(0.0) as u32;
    let steps = steps.min(250) as u8;
    rep.emit("Rendering", format!("shoreline rim {} px", steps), 0.62);
    let dist = if steps >= 1 { Some(wet_distance(g, steps + 1)) } else { None };

    rep.emit("Rendering", "hillshade + colour", 0.68);
    let scale = EXAGGERATION / metres_per_px;
    let az = AZIMUTH.to_radians();
    let alt = ALTITUDE.to_radians();
    let lx = alt.cos() * az.sin();
    let ly = -alt.cos() * az.cos();
    let lz = alt.sin();
    let h = &g.height;

    let mut out = vec![0u8; n * n * 4];
    out.par_chunks_mut(n * 4).enumerate().for_each(|(r, row)| {
        for c in 0..n {
            let i = r * n + c;
            // Central differences, one-sided at the edges (np.gradient-style).
            let gx = if n < 2 { 0.0 } else if c == 0 { h[i + 1] - h[i] } else if c == n - 1 { h[i] - h[i - 1] } else { (h[i + 1] - h[i - 1]) * 0.5 } * scale;
            let gy = if n < 2 { 0.0 } else if r == 0 { h[i + n] - h[i] } else if r == n - 1 { h[i] - h[i - n] } else { (h[i + n] - h[i - n]) * 0.5 } * scale;
            let inv_len = 1.0 / (gx * gx + gy * gy + 1.0).sqrt();
            let shade = (((-gx * lx - gy * ly + lz) * inv_len).max(0.0) / lz).clamp(AMBIENT, MAX_LIGHT);

            let bi = g.biome[i];
            let (base, canopy, weight) = if bi == UNKNOWN {
                ([0.0; 3], [0.0; 3], 0.0)
            } else {
                let e = &BIOMES[bi as usize];
                (e.2, e.3, e.4)
            };
            let fm = g.fmask[i] as f32 / 255.0 * weight;
            let mut rgb = [0f32; 3];
            for k in 0..3 {
                rgb[k] = (base[k] + (canopy[k] - base[k]) * fm) * shade;
            }

            let hh = h[i];
            let depth = WATER_LEVEL - hh;
            let hold = if bi == OCEAN_IDX { 0.0 } else { SHALLOW_HOLD };
            let w_a = ((depth - hold + SHORE_SOFT) * (1.0 / (2.0 * SHORE_SOFT))).clamp(0.0, 1.0);

            let shore = match &dist {
                Some(d) => (steps as f32 + 1.0 - d[i] as f32).clamp(0.0, steps as f32) / steps as f32,
                None => 0.0,
            };
            let sand_t = shore * shore * (SAND_STRENGTH * (1.0 - w_a));
            for k in 0..3 {
                rgb[k] += (SAND[k] - rgb[k]) * sand_t;
            }

            let wd = depth.max(0.0);
            let dd = (wd * (1.0 / WATER_DEPTH)).clamp(0.0, 1.0);
            let clarity = (1.0 - wd * (1.0 / WATER_CLARITY)).clamp(0.0, 1.0);
            let opacity = w_a * (1.0 - 0.55 * clarity);
            for k in 0..3 {
                let water = WATER_SHALLOW[k] + (WATER_DEEP[k] - WATER_SHALLOW[k]) * dd;
                rgb[k] += (water - rgb[k]) * opacity;
            }

            let alpha = ((hh - OFF_WORLD_LO) * (255.0 / (OFF_WORLD_HI - OFF_WORLD_LO))).clamp(0.0, 255.0);
            let o = c * 4;
            row[o] = rgb[0].clamp(0.0, 255.0) as u8;
            row[o + 1] = rgb[1].clamp(0.0, 255.0) as u8;
            row[o + 2] = rgb[2].clamp(0.0, 255.0) as u8;
            row[o + 3] = alpha as u8;
        }
    });
    out
}

fn encode_webp(rgba: &[u8], n: usize) -> Result<Vec<u8>, String> {
    let mut cfg = webp::WebPConfig::new().map_err(|_| "libwebp config failed".to_string())?;
    cfg.lossless = 0;
    cfg.quality = WEBP_QUALITY;
    cfg.method = 4;
    cfg.alpha_compression = 1;
    cfg.exact = 1;
    cfg.thread_level = 1;
    let enc = webp::Encoder::from_rgba(rgba, n as u32, n as u32);
    let mem = enc
        .encode_advanced(&cfg)
        .map_err(|e| format!("WebP encode failed: {e:?}"))?;
    Ok(mem.to_vec())
}

// --- the import -----------------------------------------------------------------

pub struct Built {
    pub info: PackInfo,
    pub atlas: Vec<u8>,
    pub basemap: Vec<u8>,
}

fn build_from_export(src: &Source, rep: &Reporter) -> Result<Built, String> {
    let t0 = std::time::Instant::now();
    let mut r = src.reader()?;
    let info: MapInfo = serde_json::from_slice(&r.read("map.json")?).map_err(|e| format!("map.json: {e}"))?;
    let rows = info.TileRowCount;
    let side = info.TileSideCount;
    if rows == 0 || side == 0 || rows > 8192 || side > 64 {
        return Err(format!("map.json describes an odd tile grid ({side} x {rows} rows)"));
    }
    for tz in 0..side {
        for tx in 0..side {
            let rel = format!("tiles/{tx:02}-{tz:02}.bin.gz");
            if !r.has(&rel) {
                return Err(format!("the export is incomplete: {rel} is missing. Download it again."));
            }
        }
    }
    rep.emit("Reading", format!("seed {} · world {} · {side}x{side} tiles", info.WorldSeed, info.WorldVersion), 0.02);

    let locs_raw = r.read("locations.json")?;
    rep.emit("Reading", format!("locations.json ({:.1} MB)", locs_raw.len() as f64 / 1e6), 0.05);
    let locs: Vec<RawLoc> = serde_json::from_slice(&locs_raw).map_err(|e| format!("locations.json: {e}"))?;
    drop(locs_raw);
    let mut pos = Vec::with_capacity(locs.len());
    for (i, l) in locs.iter().enumerate() {
        let p = parse_pos(l.Position.as_deref().unwrap_or(""))
            .ok_or_else(|| format!("location {} has an unreadable position {:?}", i + 1, l.Position))?;
        pos.push(p);
    }
    rep.emit("Reading", format!("{} locations", locs.len()), 0.08);

    // Locations grouped by tile, so the one pass over the tiles samples them too.
    let half = info.WorldWidth / 2.0;
    let ts = info.TileSize;
    let tile_of = |x: f64, z: f64| -> (usize, usize) {
        let tx = ((x + half) / ts).floor() as i64;
        let tz = ((z + half) / ts).floor() as i64;
        (tx.clamp(0, side as i64 - 1) as usize, tz.clamp(0, side as i64 - 1) as usize)
    };
    let mut by_tile: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (i, &(x, _, z)) in pos.iter().enumerate() {
        by_tile.entry(tile_of(x, z)).or_default().push(i);
    }

    // Render plan: halve until the grid fits the cap (render_map.plan).
    let native = rows * side;
    let mut step = 1;
    while native / step > NATIVE_CAP {
        step *= 2;
    }
    let per = rows / step;
    let n = per * side;
    let metres_per_px = (info.WorldWidth / n as f64) as f32;

    let grids = Mutex::new(Grids {
        n,
        height: vec![0f32; n * n],
        biome: vec![0u8; n * n],
        fmask: vec![0u8; n * n],
    });
    let samples = Mutex::new(vec![(0u16, 0f32, 0f32); locs.len()]);
    let edge_row = side / 2;
    let edge_hits = Mutex::new(vec![None::<f64>; side]);
    let done = std::sync::atomic::AtomicUsize::new(0);
    let total = side * side;

    let tiles: Vec<(usize, usize)> = (0..side).flat_map(|tz| (0..side).map(move |tx| (tx, tz))).collect();
    tiles
        .par_iter()
        .map_init(
            || src.reader(),
            |reader, &(tx, tz)| -> Result<(), String> {
                let reader = reader.as_mut().map_err(|e| e.clone())?;
                let rel = format!("tiles/{tx:02}-{tz:02}.bin.gz");
                let gz = reader.read(&rel)?;
                let mut raw = Vec::with_capacity(rows * rows * STRIDE);
                GzDecoder::new(&gz[..]).read_to_end(&mut raw).map_err(|e| format!("{rel}: {e}"))?;
                drop(gz);
                if raw.len() != rows * rows * STRIDE {
                    return Err(format!("{rel}: {} bytes, expected {}", raw.len(), rows * rows * STRIDE));
                }

                // Point samples for the locations in this tile (TileSampler.sample).
                if let Some(idxs) = by_tile.get(&(tx, tz)) {
                    let mut out = Vec::with_capacity(idxs.len());
                    for &i in idxs {
                        let (x, _, z) = pos[i];
                        let lx = x + half - tx as f64 * ts;
                        let lz = z + half - tz as f64 * ts;
                        let sx = ((lx / ts * rows as f64) as i64).clamp(0, rows as i64 - 1) as usize;
                        let sz = ((lz / ts * rows as f64) as i64).clamp(0, rows as i64 - 1) as usize;
                        out.push((i, tile_sample(&raw, (sx * rows + sz) * STRIDE)));
                    }
                    let mut s = samples.lock().unwrap();
                    for (i, v) in out {
                        s[i] = v;
                    }
                }

                // World edge (render_map.measure_edge): on the row through z = 0,
                // the westernmost tile with any on-world sample holds the disc's
                // westernmost point, so its largest on-world radius is the edge.
                if tz == edge_row {
                    let st = ts / rows as f64;
                    let mut best: Option<f64> = None;
                    for sx in 0..rows {
                        let wx = (sx as f64 + 0.5) * st - half + tx as f64 * ts;
                        for sz in 0..rows {
                            let (_, hh, _) = tile_sample(&raw, (sx * rows + sz) * STRIDE);
                            if hh > OFF_WORLD_HI {
                                let wz = (sz as f64 + 0.5) * st - half + tz as f64 * ts;
                                let rr = (wx * wx + wz * wz).sqrt();
                                best = Some(best.map_or(rr, |b: f64| b.max(rr)));
                            }
                        }
                    }
                    edge_hits.lock().unwrap()[tx] = best;
                }

                // Decimated block for the render (render_map.assemble): source is
                // [x][z]; output row 0 is north, so z runs backwards down the rows.
                let mut bh = vec![0f32; per * per];
                let mut bb = vec![0u8; per * per];
                let mut bf = vec![0u8; per * per];
                for j in 0..per {
                    let sz = rows - 1 - j * step;
                    for c in 0..per {
                        let sx = c * step;
                        let (bio, hh, fo) = tile_sample(&raw, (sx * rows + sz) * STRIDE);
                        let k = j * per + c;
                        bh[k] = hh;
                        bb[k] = palette_index(bio);
                        bf[k] = forest_mask(fo);
                    }
                }
                drop(raw);
                {
                    let mut g = grids.lock().unwrap();
                    let r0 = (side - 1 - tz) * per;
                    let c0 = tx * per;
                    for j in 0..per {
                        let dst = (r0 + j) * n + c0;
                        g.height[dst..dst + per].copy_from_slice(&bh[j * per..(j + 1) * per]);
                        g.biome[dst..dst + per].copy_from_slice(&bb[j * per..(j + 1) * per]);
                        g.fmask[dst..dst + per].copy_from_slice(&bf[j * per..(j + 1) * per]);
                    }
                }
                let k = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if k % side == 0 || k == total {
                    rep.emit("Decompressing tiles", format!("{k} / {total}"), 0.08 + 0.52 * k as f32 / total as f32);
                }
                Ok(())
            },
        )
        .collect::<Result<Vec<()>, String>>()?;

    let edge = edge_hits
        .into_inner()
        .unwrap()
        .into_iter()
        .flatten()
        .next()
        .map(|e| round_to(e, 1))
        .unwrap_or(10500.0);
    let samples = samples.into_inner().unwrap();
    let grids = grids.into_inner().unwrap();

    let rgba = render_rgba(&grids, metres_per_px, rep);
    drop(grids);
    rep.emit("Encoding basemap", format!("{n} x {n} WebP"), 0.78);
    let basemap = encode_webp(&rgba, n)?;
    drop(rgba);

    rep.emit("Indexing", "locations, contents, chest loot", 0.94);
    let payload = build_payload(&info, edge, &locs, &pos, &samples);
    let atlas = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let id = world_id(&info.WorldSeed, &info.WorldVersion);
    let now = now_secs();
    let pack = PackInfo {
        schema: PACK_SCHEMA,
        seed: info.WorldSeed.clone(),
        world_version: info.WorldVersion.clone(),
        world: info.WorldWidth,
        edge,
        locations: locs.len(),
        basemap: BASEMAP_NAME.into(),
        built_at: iso_utc(now),
        id,
        atlas_sha: sha256_hex(&atlas),
        basemap_sha: sha256_hex(&basemap),
        atlas_bytes: atlas.len() as u64,
        basemap_bytes: basemap.len() as u64,
        updated_at: now,
        source: "export".into(),
        tile_side: side as u32,
    };
    app_log(&format!(
        "[map] built {} in {:.1}s: {} locations, edge {:.1} m, basemap {n}px {:.1} MB, atlas {:.1} MB",
        pack.id,
        t0.elapsed().as_secs_f64(),
        pack.locations,
        edge,
        basemap.len() as f64 / 1e6,
        atlas.len() as f64 / 1e6
    ));
    Ok(Built { info: pack, atlas, basemap })
}

/// A ready-made pack (MapAtlas `--pack`, or one exported from here/MegaServer).
fn build_from_pack(path: &Path) -> Result<Built, String> {
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let read = |zip: &mut zip::ZipArchive<fs::File>, name: &str, cap: u64| -> Result<Vec<u8>, String> {
        let mut e = zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
        if e.size() > cap {
            return Err(format!("{name} is implausibly large"));
        }
        let mut out = Vec::new();
        e.read_to_end(&mut out).map_err(|e| e.to_string())?;
        Ok(out)
    };
    let mut info: PackInfo = serde_json::from_slice(&read(&mut zip, "pack.json", 1 << 20)?)
        .map_err(|e| format!("pack.json: {e}"))?;
    if info.schema > PACK_SCHEMA {
        return Err(format!("this pack is schema {}, newer than MegaLoad reads ({PACK_SCHEMA}) — update MegaLoad", info.schema));
    }
    if info.basemap.is_empty() || info.basemap.contains(['/', '\\']) || info.basemap.starts_with('.') {
        return Err("pack.json names an unsafe basemap file".into());
    }
    let basemap = read(&mut zip, &info.basemap.clone(), 96 << 20)?;
    let atlas = read(&mut zip, "atlas.json", 96 << 20)?;
    let v: serde_json::Value = serde_json::from_slice(&atlas).map_err(|e| format!("atlas.json: {e}"))?;
    for k in ["seed", "world", "edge", "p", "x", "y", "z"] {
        if v.get(k).is_none() {
            return Err(format!("atlas.json has no `{k}`"));
        }
    }
    let now = now_secs();
    info.id = world_id(&info.seed, &info.world_version);
    info.atlas_sha = sha256_hex(&atlas);
    info.basemap_sha = sha256_hex(&basemap);
    info.atlas_bytes = atlas.len() as u64;
    info.basemap_bytes = basemap.len() as u64;
    info.updated_at = now;
    info.source = "pack".into();
    Ok(Built { info, atlas, basemap })
}

fn import_path(path: &Path, rep: &Reporter) -> Result<PackInfo, String> {
    let (src, kind) = Source::open(path)?;
    let built = match kind {
        SourceKind::Export => build_from_export(&src, rep)?,
        SourceKind::Pack => {
            rep.emit("Reading", "atlas pack", 0.3);
            build_from_pack(path)?
        }
    };
    rep.emit("Installing", built.info.id.clone(), 0.98);
    install_world(&built.info, &built.atlas, &built.basemap)?;
    crate::commands::map_sync::clear_tombstone(&built.info.id);
    let mut st = read_state();
    st.active = Some(built.info.id.clone());
    write_state(&st)?;
    rep.emit("Done", built.info.id.clone(), 1.0);
    Ok(built.info)
}

// --- commands -------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapWorlds {
    pub worlds: Vec<PackInfo>,
    pub active: Option<String>,
}

#[command(async)]
pub fn map_list_worlds() -> MapWorlds {
    let worlds = list_packs();
    let mut active = read_state().active;
    if active.as_ref().map_or(true, |a| !worlds.iter().any(|w| &w.id == a)) {
        active = worlds.first().map(|w| w.id.clone());
    }
    MapWorlds { worlds, active }
}

#[command(async)]
pub fn map_set_active(id: String) -> Result<(), String> {
    if read_pack(&id).is_none() {
        return Err(format!("no world {id} installed"));
    }
    write_state(&MapState { active: Some(id) })
}

#[command(async)]
pub fn map_atlas_payload(id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("bad world id".into());
    }
    fs::read_to_string(world_dir(&id).join("atlas.json")).map_err(|e| format!("could not read the atlas: {e}"))
}

/// Raw bytes, so an 8 MB image does not cross IPC as a JSON number array.
#[command(async)]
pub fn map_basemap(id: String) -> Result<tauri::ipc::Response, String> {
    let info = read_pack(&id).ok_or_else(|| format!("no world {id} installed"))?;
    let bytes = fs::read(world_dir(&id).join(&info.basemap)).map_err(|e| format!("could not read the basemap: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[command(async)]
pub fn map_peek_source(path: String) -> Result<SourcePeek, String> {
    peek(Path::new(&path))
}

/// valheim-map.world downloads land in Downloads as `MapData_<seed>*.zip`.
/// Offer them before making the player go hunting through a file picker.
#[command(async)]
pub fn map_find_downloads() -> Vec<SourcePeek> {
    let Ok(home) = std::env::var("USERPROFILE") else { return vec![] };
    let dir = PathBuf::from(home).join("Downloads");
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            let wanted = name.ends_with(".zip") && (name.starts_with("mapdata") || name.starts_with("atlas-"));
            if !wanted {
                continue;
            }
            if let Ok(p) = peek(&e.path()) {
                out.push(p);
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

#[command]
pub async fn map_import(app: AppHandle, path: String) -> Result<PackInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rep = Reporter { app: Some(&app) };
        let res = import_path(Path::new(&path), &rep);
        if let Err(e) = &res {
            app_log(&format!("[map] import failed: {e}"));
        }
        res
    })
    .await
    .map_err(|e| format!("import task failed: {e}"))?
}

#[command(async)]
pub fn map_delete_world(id: String) -> Result<(), String> {
    remove_world_files(&id)?;
    crate::commands::map_sync::add_tombstone(&id);
    let mut st = read_state();
    if st.active.as_deref() == Some(id.as_str()) {
        st.active = list_packs().first().map(|w| w.id.clone());
        write_state(&st)?;
    }
    Ok(())
}

/// Write a world back out as a pack zip — the same thing MegaServer imports.
#[command(async)]
pub fn map_export_pack(id: String, dest: String) -> Result<(), String> {
    let info = read_pack(&id).ok_or_else(|| format!("no world {id} installed"))?;
    let dir = world_dir(&id);
    let f = fs::File::create(&dest).map_err(|e| format!("could not create {dest}: {e}"))?;
    let mut zw = zip::ZipWriter::new(f);
    let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let pack = serde_json::json!({
        "schema": info.schema, "seed": info.seed, "worldVersion": info.world_version,
        "world": info.world, "edge": info.edge, "locations": info.locations,
        "basemap": info.basemap, "builtAt": info.built_at,
    });
    let mut put = |name: &str, opts, bytes: &[u8]| -> Result<(), String> {
        use std::io::Write;
        zw.start_file(name, opts).map_err(|e| e.to_string())?;
        zw.write_all(bytes).map_err(|e| e.to_string())
    };
    put("pack.json", deflate, (serde_json::to_string_pretty(&pack).unwrap() + "\n").as_bytes())?;
    put(&info.basemap, stored, &fs::read(dir.join(&info.basemap)).map_err(|e| e.to_string())?)?;
    put("atlas.json", deflate, &fs::read(dir.join("atlas.json")).map_err(|e| e.to_string())?)?;
    zw.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[command(async)]
pub fn map_marks() -> MarksFile {
    read_marks()
}

#[command(async)]
pub fn map_set_trader_marks(seed: String, ids: Vec<u32>) -> Result<MarksFile, String> {
    let mut m = read_marks();
    let mut ids = ids;
    ids.sort_unstable();
    ids.dedup();
    // An emptied seed keeps its entry: the timestamp is what tells another
    // machine the marks were cleared rather than never set.
    m.insert(seed, SeedMarks { traders: ids, updated_at: now_secs() });
    write_marks(&m)?;
    Ok(m)
}

#[command(async)]
pub fn map_open_generator() -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg("https://valheim-map.world/")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command(async)]
pub fn map_open_folder() -> Result<(), String> {
    let dir = maps_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_parse_like_the_python_regex() {
        assert_eq!(parse_pos("(-123.5, 30.25, 4e2)"), Some((-123.5, 30.25, 400.0)));
        assert_eq!(parse_pos("(1, -2, -3)"), Some((1.0, -2.0, -3.0)));
        assert_eq!(parse_pos("(1, 2)"), None);
    }

    #[test]
    fn friendly_names_split_on_the_first_colon() {
        assert_eq!(
            split_friendly("Item: One Of: Coins[5-30]"),
            (Some("Item".into()), Some("One Of: Coins[5-30]".into()))
        );
        assert_eq!(split_friendly("Thing"), (None, Some("Thing".into())));
        assert_eq!(split_friendly(""), (None, None));
    }

    #[test]
    fn copy_suffix_is_stripped() {
        assert_eq!(strip_copy_suffix("TreasureChest_forest (3)"), "TreasureChest_forest");
        assert_eq!(strip_copy_suffix("TreasureChest_forest"), "TreasureChest_forest");
        assert_eq!(strip_copy_suffix("Box (a)"), "Box (a)");
    }

    #[test]
    fn ids_are_safe_path_segments() {
        assert_eq!(world_id("Super Seed!", "1.0.7"), "Super-Seed-1.0.7");
        assert!(valid_id("SuperSeed-1.0.7"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(".SuperSeed.incoming"));
    }

    #[test]
    fn iso_stamp_matches_known_dates() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_757_974_279), "2025-09-15T22:11:19Z");
    }

    /// End to end on a real download. `MAP_EXPORT=<zip> MAP_OUT=<dir> cargo test
    /// --release real_export -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_export() {
        let zip = std::env::var("MAP_EXPORT").expect("MAP_EXPORT");
        let out = PathBuf::from(std::env::var("MAP_OUT").expect("MAP_OUT"));
        let t = std::time::Instant::now();
        let (src, kind) = Source::open(Path::new(&zip)).unwrap();
        assert_eq!(kind, SourceKind::Export);
        let b = build_from_export(&src, &Reporter { app: None }).unwrap();
        eprintln!("built in {:.1}s", t.elapsed().as_secs_f64());
        fs::create_dir_all(&out).unwrap();
        fs::write(out.join("atlas.json"), &b.atlas).unwrap();
        fs::write(out.join("basemap.webp"), &b.basemap).unwrap();
        fs::write(out.join("pack.json"), serde_json::to_string_pretty(&b.info).unwrap()).unwrap();
    }

    #[test]
    fn distance_transform_matches_repeated_dilation() {
        // A single wet pixel in the middle of a 9x9 land grid.
        let n = 9;
        let mut g = Grids { n, height: vec![100.0; n * n], biome: vec![1; n * n], fmask: vec![0; n * n] };
        g.height[4 * n + 4] = 0.0;
        let d = wet_distance(&g, 4);
        assert_eq!(d[4 * n + 4], 0);
        assert_eq!(d[4 * n + 5], 1);
        assert_eq!(d[5 * n + 5], 2);
        assert_eq!(d[0], 4); // capped (true distance 8)
    }
}
