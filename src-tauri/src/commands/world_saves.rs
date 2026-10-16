//! What is in the containers of a world save on this PC, for the World Map.
//!
//! A world map knows what each chest *can* roll; the save knows what every
//! container actually holds. This reads a Valheim 1.0 world save (the chunked
//! layout, `Version.World.DeepNorth = 41`) straight off disk and lists each
//! container with its items. It is a Rust port of the parser in
//! `C:\Valhalla\tools\cheat-audit\valsave.py`, which was verified against the
//! shipped 1.0.7 assembly.
//!
//! Per world, not per server: a single-player or self-hosted world lives in
//! Steam Cloud (`Steam\userdata\<id>\892970\remote\worlds\<World>\`) or, with
//! cloud saves off, in `LocalLow\IronGate\Valheim\worlds_local\<World>\`. A
//! world is a folder of `_main.<n>.{fwl2,db2,chunks,ok}` plus one `.chunk` per
//! saved zone. Only reads; the save is never touched.
//!
//! Containers are found by what they store, not by prefab: any ZDO with an
//! `items` inventory (chests, tombstones, carts, ships, modded storage).

use crate::commands::app_log::app_log;
use crate::commands::player_data::{prefab_name_for_hash, stable_hash_code};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::command;

// --- ZPackage reader (valsave.Pkg) -----------------------------------------------

struct Pkg<'a> {
    b: &'a [u8],
    i: usize,
}

type R<T> = Result<T, String>;

impl<'a> Pkg<'a> {
    fn new(b: &'a [u8]) -> Self {
        Self { b, i: 0 }
    }
    fn need(&self, n: usize) -> R<()> {
        if self.i + n > self.b.len() {
            Err(format!("short read at 0x{:x}", self.i))
        } else {
            Ok(())
        }
    }
    fn u8(&mut self) -> R<u8> {
        self.need(1)?;
        self.i += 1;
        Ok(self.b[self.i - 1])
    }
    fn take<const N: usize>(&mut self) -> R<[u8; N]> {
        self.need(N)?;
        let mut a = [0u8; N];
        a.copy_from_slice(&self.b[self.i..self.i + N]);
        self.i += N;
        Ok(a)
    }
    fn i16(&mut self) -> R<i16> {
        Ok(i16::from_le_bytes(self.take()?))
    }
    fn u16(&mut self) -> R<u16> {
        Ok(u16::from_le_bytes(self.take()?))
    }
    fn i32(&mut self) -> R<i32> {
        Ok(i32::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> R<i64> {
        Ok(i64::from_le_bytes(self.take()?))
    }
    fn f32(&mut self) -> R<f32> {
        Ok(f32::from_le_bytes(self.take()?))
    }
    fn vec3(&mut self) -> R<[f32; 3]> {
        Ok([self.f32()?, self.f32()?, self.f32()?])
    }
    fn skip(&mut self, n: usize) -> R<()> {
        self.need(n)?;
        self.i += n;
        Ok(())
    }
    /// ZPackage.ReadNumItems: one byte, or two when the high bit is set.
    fn num_items(&mut self) -> R<usize> {
        let b = self.u8()?;
        if b & 0x80 != 0 {
            Ok((((b & 0x7F) as usize) << 8) | self.u8()? as usize)
        } else {
            Ok(b as usize)
        }
    }
    /// BinaryReader.ReadString: 7-bit encoded byte length, then UTF-8.
    fn string(&mut self) -> R<String> {
        let mut n: usize = 0;
        let mut shift = 0;
        loop {
            let b = self.u8()?;
            n |= ((b & 0x7F) as usize) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 28 {
                return Err("bad string length".into());
            }
        }
        self.need(n)?;
        let s = String::from_utf8_lossy(&self.b[self.i..self.i + n]).into_owned();
        self.i += n;
        Ok(s)
    }
    fn byte_array(&mut self) -> R<&'a [u8]> {
        let n = self.i32()?;
        if !(0..=50_000_000).contains(&n) {
            return Err("bad byte array length".into());
        }
        let n = n as usize;
        self.need(n)?;
        let v = &self.b[self.i..self.i + n];
        self.i += n;
        Ok(v)
    }
}

// --- ZDO (valsave.read_zdo, chunked) -------------------------------------------------

const F_CONNECTIONS: u16 = 1;
const F_FLOATS: u16 = 2;
const F_VEC3: u16 = 4;
const F_QUATS: u16 = 8;
const F_INTS: u16 = 0x10;
const F_LONGS: u16 = 0x20;
const F_STRINGS: u16 = 0x40;
const F_BYTEARRAYS: u16 = 0x80;
const F_ROTATION: u16 = 0x1000;
const F_SMALLPOS: u16 = 0x2000;

/// The parts of a ZDO this needs. Everything else is read past, not kept.
#[derive(Default)]
struct Zdo<'a> {
    pos: [f32; 3],
    prefab: i32,
    longs: Vec<(i32, i64)>,
    strings: Vec<(i32, String)>,
    bytes: Vec<(i32, &'a [u8])>,
}

fn read_zdo<'a>(p: &mut Pkg<'a>) -> R<Zdo<'a>> {
    let mut z = Zdo::default();
    let flags = p.u16()?;
    z.pos = if flags & F_SMALLPOS != 0 {
        let (x, y) = (p.i16()?, p.i16()?);
        [x as f32, 0.0, y as f32]
    } else {
        p.vec3()?
    };
    z.prefab = p.i32()?;
    if flags & F_ROTATION != 0 {
        // small rotation: u16, or u32 when the high bit is clear
        let n = p.u16()?;
        if n & 0x8000 == 0 {
            p.u16()?;
        }
    }
    if flags & 0xFF != 0 {
        if flags & F_CONNECTIONS != 0 {
            p.u8()?;
            p.i32()?;
        }
        if flags & F_FLOATS != 0 {
            for _ in 0..p.num_items()? {
                p.skip(8)?;
            }
        }
        if flags & F_VEC3 != 0 {
            for _ in 0..p.num_items()? {
                p.skip(16)?;
            }
        }
        if flags & F_QUATS != 0 {
            for _ in 0..p.num_items()? {
                p.skip(20)?;
            }
        }
        if flags & F_INTS != 0 {
            for _ in 0..p.num_items()? {
                p.skip(8)?;
            }
        }
        if flags & F_LONGS != 0 {
            for _ in 0..p.num_items()? {
                let h = p.i32()?;
                z.longs.push((h, p.i64()?));
            }
        }
        if flags & F_STRINGS != 0 {
            for _ in 0..p.num_items()? {
                let h = p.i32()?;
                z.strings.push((h, p.string()?));
            }
        }
        if flags & F_BYTEARRAYS != 0 {
            for _ in 0..p.num_items()? {
                let h = p.i32()?;
                z.bytes.push((h, p.byte_array()?));
            }
        }
    }
    Ok(z)
}

// --- inventories (valsave.read_itemdata, Version.Item 109) ----------------------------

/// [item prefab, stack, quality] — MegaServer's chest-contents shape.
type ItemRow = (String, u32, u32);

fn read_inventory(raw: &[u8]) -> R<Vec<ItemRow>> {
    let mut p = Pkg::new(raw);
    let ver = p.i32()?;
    if ver < 108 {
        // Pre-1.0 item layout; a world loaded once in 1.0 is rewritten as 109.
        return Err(format!("inventory version {ver}"));
    }
    let n = p.u16()?;
    let mut out = Vec::with_capacity(n as usize);
    for _ in 0..n {
        p.i32()?; // durability * 100
        p.u8()?; // grid x
        p.u8()?; // grid y
        p.u8()?; // world level
        let b = p.u8()?;
        let quality = if b & 4 != 0 { p.u16()? as u32 } else { 1 };
        let stack = if b & 8 != 0 { p.u16()? as u32 } else { 1 };
        if b & 0x10 != 0 {
            p.i32()?; // variant
        }
        if b & 0x20 != 0 {
            p.i64()?; // crafter id
            p.string()?; // crafter name
        }
        let hash = if b & 0x40 != 0 { p.i32()? } else { 0 };
        if b & 0x80 != 0 {
            for _ in 0..p.num_items()? {
                p.string()?;
                p.string()?;
            }
        }
        if ver >= 109 || ver == 107 {
            p.u8()?; // cheated flag
        }
        out.push((item_name(hash), stack, quality));
    }
    Ok(out)
}

// --- names ----------------------------------------------------------------------

const CONTAINERS_JSON: &str = include_str!("../../resources/map/containers.json");

/// Storage the player builds or leaves behind. World chests come from the
/// bundled loot table file, items from the generated prefab table.
const EXTRA_PREFABS: &[&str] = &[
    "piece_chest_wood",
    "piece_chest",
    "piece_chest_private",
    "piece_chest_blackmetal",
    "piece_chest_barrel",
    "piece_chest_treasure",
    "loot_chest_wood",
    "loot_chest_stone",
    "Player_tombstone",
    "Cart",
    "Karve",
    "Raft",
    "VikingShip",
    "VikingShip_Ashlands",
    "Trailership",
    "piece_incinerator",
];

fn container_name(hash: i32) -> String {
    static MAP: OnceLock<HashMap<i32, String>> = OnceLock::new();
    let map = MAP.get_or_init(|| {
        let mut m: HashMap<i32, String> = HashMap::new();
        for n in EXTRA_PREFABS {
            m.insert(stable_hash_code(n), n.to_string());
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(CONTAINERS_JSON) {
            for c in v["containers"].as_array().into_iter().flatten() {
                for k in ["prefab", "name"] {
                    if let Some(s) = c[k].as_str() {
                        m.insert(stable_hash_code(s), s.to_string());
                    }
                }
            }
        }
        m
    });
    map.get(&hash)
        .cloned()
        .or_else(|| prefab_name_for_hash(hash).map(|s| s.to_string()))
        .unwrap_or_else(|| format!("#{hash}"))
}

fn item_name(hash: i32) -> String {
    prefab_name_for_hash(hash)
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("#{hash}"))
}

// --- finding worlds -----------------------------------------------------------------

fn steam_world_roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let base = PathBuf::from(r"C:\Program Files (x86)\Steam\userdata");
    if let Ok(rd) = fs::read_dir(&base) {
        for e in rd.flatten() {
            let p = e.path().join(r"892970\remote\worlds");
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    out
}

fn world_roots() -> Vec<(PathBuf, &'static str)> {
    let mut out: Vec<(PathBuf, &'static str)> = steam_world_roots().into_iter().map(|p| (p, "cloud")).collect();
    if let Ok(home) = std::env::var("USERPROFILE") {
        let local = PathBuf::from(home).join(r"AppData\LocalLow\IronGate\Valheim\worlds_local");
        if local.is_dir() {
            out.push((local, "local"));
        }
    }
    out
}

/// The current save is the highest `_main.<n>.fwl2`; the number moves on
/// every save, so it is discovered, never constructed.
fn current_save(dir: &Path) -> Option<(u64, PathBuf)> {
    let mut best: Option<(u64, PathBuf)> = None;
    for e in fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(n) = name.strip_prefix("_main.").and_then(|r| r.strip_suffix(".fwl2")) else { continue };
        let Ok(n) = n.parse::<u64>() else { continue };
        if best.as_ref().map_or(true, |b| n > b.0) {
            best = Some((n, e.path()));
        }
    }
    best
}

/// `.fwl2`: i32 payload length, then worldVersion, name, seedName, seed, uid.
fn read_meta(path: &Path) -> R<(i32, String, String, i64)> {
    let b = fs::read(path).map_err(|e| e.to_string())?;
    let mut p = Pkg::new(&b);
    p.i32()?;
    let version = p.i32()?;
    let name = p.string()?;
    let seed_name = p.string()?;
    p.i32()?;
    let uid = p.i64()?;
    Ok((version, name, seed_name, uid))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSave {
    /// The world folder; what `map_scan_world_save` takes.
    pub path: String,
    pub name: String,
    pub seed: String,
    pub uid: String,
    /// "cloud" | "local" | "folder" (picked by hand)
    pub location: String,
    /// Valheim's own copy (`<World>_backup_auto-…`), not the live world.
    pub backup: bool,
    pub save_number: u64,
    /// Unix secs the current save was written.
    pub saved_at: u64,
}

fn describe(dir: &Path, location: &str) -> Option<WorldSave> {
    let (n, meta) = current_save(dir)?;
    let (_, name, seed, uid) = read_meta(&meta).ok()?;
    let saved_at = fs::metadata(&meta)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let folder = dir.file_name()?.to_string_lossy().to_string();
    Some(WorldSave {
        path: dir.to_string_lossy().to_string(),
        name,
        seed,
        uid: uid.to_string(),
        location: location.into(),
        backup: folder.contains("_backup"),
        save_number: n,
        saved_at,
    })
}

#[command(async)]
pub fn map_list_world_saves() -> Vec<WorldSave> {
    let mut out = Vec::new();
    for (root, loc) in world_roots() {
        let Ok(rd) = fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            if e.path().is_dir() {
                if let Some(w) = describe(&e.path(), loc) {
                    out.push(w);
                }
            }
        }
    }
    // Live worlds first, newest save first.
    out.sort_by(|a, b| a.backup.cmp(&b.backup).then(b.saved_at.cmp(&a.saved_at)));
    out
}

/// A world folder the player picked by hand (a self-hosted server's save, a
/// copy from another PC). Checked the same way.
#[command(async)]
pub fn map_describe_world_save(path: String) -> Result<WorldSave, String> {
    describe(Path::new(&path), "folder").ok_or_else(|| {
        "That folder is not a Valheim 1.0 world: it has no _main.<n>.fwl2. Pick the world's own folder (inside worlds or worlds_local).".to_string()
    })
}

// --- the scan ------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChest {
    pub prefab: String,
    pub pos: [f32; 3],
    /// Player id for a built container, 0 for a world one.
    pub creator: i64,
    pub creator_name: String,
    pub items: Vec<ItemRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScan {
    pub world: WorldSave,
    pub chests: Vec<SaveChest>,
    /// Chunk files that could not be read (mid-write, damaged). The rest of
    /// the world still scans.
    pub skipped_chunks: u32,
    pub empty_containers: u32,
}

static CACHE: OnceLock<Mutex<HashMap<String, (u64, SaveScan)>>> = OnceLock::new();

fn scan(dir: &Path, location: &str) -> R<SaveScan> {
    let world = describe(dir, location).ok_or("not a Valheim 1.0 world folder (no _main.<n>.fwl2)")?;
    let key = world.path.clone();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((n, s)) = cache.lock().unwrap().get(&key) {
        if *n == world.save_number {
            return Ok(s.clone());
        }
    }

    let t0 = std::time::Instant::now();
    let h_items = stable_hash_code("items");
    let h_creator = stable_hash_code("creator");
    let h_owner = stable_hash_code("owner");
    let h_owner_name = stable_hash_code("ownerName");

    let chunks: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |x| x == "chunk"))
        .collect();

    struct Part {
        chests: Vec<SaveChest>,
        names: Vec<(i64, String)>,
        empty: u32,
        bad: bool,
    }
    let parts: Vec<Part> = chunks
        .par_iter()
        .map(|path| {
            let mut part = Part { chests: vec![], names: vec![], empty: 0, bad: false };
            let Ok(b) = fs::read(path) else {
                part.bad = true;
                return part;
            };
            let mut p = Pkg::new(&b);
            let header = (|| -> R<i32> {
                p.u16()?; // save version
                p.i32()
            })();
            let Ok(count) = header else {
                part.bad = true;
                return part;
            };
            for _ in 0..count.max(0) {
                let z = match read_zdo(&mut p) {
                    Ok(z) => z,
                    Err(_) => {
                        part.bad = true;
                        break;
                    }
                };
                let long = |h| z.longs.iter().find(|(k, _)| *k == h).map(|(_, v)| *v);
                let string = |h| z.strings.iter().find(|(k, _)| *k == h).map(|(_, v)| v.clone());
                if let (Some(id), Some(name)) = (long(h_owner), string(h_owner_name)) {
                    if id != 0 && !name.is_empty() {
                        part.names.push((id, name));
                    }
                }
                let raw: Option<Vec<u8>> = z
                    .bytes
                    .iter()
                    .find(|(k, _)| *k == h_items)
                    .map(|(_, v)| v.to_vec())
                    .or_else(|| {
                        // pre-migration saves kept the inventory as base64 text
                        use base64::Engine;
                        string(h_items).and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
                    });
                let Some(raw) = raw else { continue };
                match read_inventory(&raw) {
                    Ok(items) if items.is_empty() => part.empty += 1,
                    Ok(items) => part.chests.push(SaveChest {
                        prefab: container_name(z.prefab),
                        pos: z.pos.map(|c| (c * 10.0).round() / 10.0),
                        creator: long(h_creator).unwrap_or(0),
                        creator_name: string(h_owner_name).unwrap_or_default(),
                        items,
                    }),
                    Err(_) => {}
                }
            }
            part
        })
        .collect();

    let mut names: HashMap<i64, String> = HashMap::new();
    let mut chests = Vec::new();
    let (mut skipped, mut empty) = (0u32, 0u32);
    for part in parts {
        names.extend(part.names);
        chests.extend(part.chests);
        skipped += part.bad as u32;
        empty += part.empty;
    }
    // A built chest records only its creator's id; beds and tombstones carry
    // id and character name together, which is enough to say whose it is.
    for c in &mut chests {
        if c.creator_name.is_empty() && c.creator != 0 {
            if let Some(n) = names.get(&c.creator) {
                c.creator_name = n.clone();
            }
        }
    }
    chests.sort_by(|a, b| (a.pos[0], a.pos[2]).partial_cmp(&(b.pos[0], b.pos[2])).unwrap_or(std::cmp::Ordering::Equal));

    app_log(&format!(
        "[map] scanned {} ({} chunks, {} skipped): {} containers with items, {} empty, {:.0} ms",
        world.name,
        chunks.len(),
        skipped,
        chests.len(),
        empty,
        t0.elapsed().as_secs_f64() * 1000.0
    ));
    let out = SaveScan { world, chests, skipped_chunks: skipped, empty_containers: empty };
    cache.lock().unwrap().insert(key, (out.world.save_number, out.clone()));
    Ok(out)
}

/// Scan one world folder. Cached per save number, so re-opening the page is
/// free until Valheim saves again.
#[command(async)]
pub fn map_scan_world_save(path: String) -> Result<SaveScan, String> {
    let dir = PathBuf::from(&path);
    let location = world_roots()
        .into_iter()
        .find(|(root, _)| dir.starts_with(root))
        .map(|(_, l)| l)
        .unwrap_or("folder");
    scan(&dir, location)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_hash_matches_the_game() {
        // valsave.self_test: 'scale' is on nearly every ZDO.
        assert_eq!(stable_hash_code("scale"), -528916476);
    }

    #[test]
    fn container_names_resolve() {
        assert_eq!(container_name(stable_hash_code("piece_chest_wood")), "piece_chest_wood");
        assert_eq!(container_name(stable_hash_code("TreasureChest_meadows")), "TreasureChest_meadows");
        assert_eq!(item_name(stable_hash_code("Coins")), "Coins");
    }

    /// `MAP_WORLD=<world folder> cargo test --release real_world_save -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_world_save() {
        let dir = std::env::var("MAP_WORLD").expect("MAP_WORLD");
        let s = scan(Path::new(&dir), "folder").unwrap();
        eprintln!(
            "{} seed {} save {}: {} containers, {} empty, {} skipped chunks",
            s.world.name, s.world.seed, s.world.save_number, s.chests.len(), s.empty_containers, s.skipped_chunks
        );
        if let Ok(out) = std::env::var("MAP_SCAN_OUT") {
            fs::write(out, serde_json::to_string(&s).unwrap()).unwrap();
        }
        for c in s.chests.iter().take(5) {
            eprintln!("  {} {:?} by {:?}: {:?}", c.prefab, c.pos, c.creator_name, &c.items[..c.items.len().min(4)]);
        }
    }
}
