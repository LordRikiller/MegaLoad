// Chest loot search + odds for the World Map. Ported from MegaServer's
// src/lib/loot.ts, minus the live-chest parts (those read the server's world).
import type { AtlasData, LootTable } from "../tauri-api";

/** Item names and chest loot, indexed for search. Everything here is optional
 *  in the atlas, so an older pack yields empty tables rather than an error. */
export interface LootIndex {
  /** Per atlas detail: English names of the item prefabs named inside it. */
  detailExtra: string[];
  /** Per atlas detail: indexes of the item prefabs named inside it. */
  detailItems: number[][];
  /** Per loot table: "id name id name …", lowercased, for the haystack. */
  tableText: string[];
  /** Per item index: "id name", lowercased, for matching a query to items. */
  itemText: string[];
}

const TOKEN = /[A-Za-z_][A-Za-z0-9_]*/g;

export function buildLootIndex(A: AtlasData): LootIndex {
  const ids = A.items ?? [];
  const names = A.itemNames ?? [];
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));

  // "One Of: Coins[5-20], Ruby[1-2]" and "Pickable_Mushroom" name items by
  // prefab only; adding the English lets "ruby" or "mushroom" find them too.
  const detailItems = A.details.map((d) => {
    const out: number[] = [];
    for (const tok of (d ?? "").match(TOKEN) ?? []) {
      const i = index.get(tok) ?? (tok.startsWith("Pickable_") ? index.get(tok.slice(9)) : undefined);
      if (i !== undefined && !out.includes(i)) out.push(i);
    }
    return out;
  });
  const detailExtra = detailItems.map((list) =>
    list
      .map((i) => names[i])
      .filter(Boolean)
      .join(" "),
  );

  const itemText = ids.map((id, i) => `${id} ${names[i] ?? ""}`.toLowerCase());
  const tableText = (A.loot ?? []).map((t) => t.d.map((e) => itemText[e[0]]).join(" "));
  return { detailExtra, detailItems, tableText, itemText };
}

export function itemLabel(A: AtlasData, idx: number): { id: string; name: string } {
  const id = A.items?.[idx] ?? "?";
  return { id, name: A.itemNames?.[idx] || id };
}

/** Chance each entry ends up in one chest at least once. Simulated rather than
 *  solved: oneOfEach is weighted sampling without replacement over up to a
 *  couple of dozen entries, which has no tidy closed form. Mirrors
 *  DropTable.GetDropListItems in the shipped 1.0 IL: miss m_dropChance and the
 *  chest is empty; else Range(min, max + 1) picks, each a float in
 *  [0, total) walked over cumulative weights, falling back to the first entry. */
const oddsCache = new WeakMap<LootTable, number[]>();

export function lootOdds(t: LootTable, runs = 20000): number[] {
  const hit = oddsCache.get(t);
  if (hit) return hit;
  let seed = 0x9e3779b9;
  const rnd = () => {
    // mulberry32: fixed seed, so the figures never jitter between renders.
    seed = (seed + 0x6d2b79f5) | 0;
    let x = seed;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const n = t.d.length;
  const got = new Array<number>(n).fill(0);
  const seen = new Uint8Array(n);
  const pool: number[] = [];
  for (let r = 0; r < runs; r++) {
    if (rnd() > t.c) continue;
    seen.fill(0);
    pool.length = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      pool.push(i);
      total += t.d[i][3];
    }
    const picks = t.n[0] + Math.floor(rnd() * (t.n[1] - t.n[0] + 1));
    for (let p = 0; p < picks; p++) {
      if (!pool.length) break;
      const v = rnd() * total;
      let cum = 0;
      let at = -1;
      for (let k = 0; k < pool.length; k++) {
        cum += t.d[pool[k]][3];
        if (v <= cum) {
          at = k;
          break;
        }
      }
      if (at < 0) at = 0;
      const e = pool[at];
      seen[e] = 1;
      if (t.o) {
        total -= t.d[e][3];
        pool.splice(at, 1);
      }
    }
    for (let i = 0; i < n; i++) got[i] += seen[i];
  }
  const out = got.map((g) => g / runs);
  oddsCache.set(t, out);
  return out;
}

export function fmtOdds(p: number) {
  if (p >= 0.995) return "always";
  if (p <= 0) return "—";
  if (p < 0.01) return "<1%";
  return Math.round(p * 100) + "%";
}

// --- what is in the containers of a world save ----------------------------------

import itemNames from "./itemNames.json";
import type { SaveChest, SaveScan } from "../tauri-api";

/** Every item in the game, id -> English name. The atlas only names items its
 *  loot tables mention; a player's chest can hold anything. */
const ITEM_NAMES: Record<string, string> = itemNames;

export function itemName(id: string, A?: AtlasData): string {
  if (ITEM_NAMES[id]) return ITEM_NAMES[id];
  const i = A?.items?.indexOf(id) ?? -1;
  return (i >= 0 && A?.itemNames?.[i]) || id;
}

const ALL_ITEM_TEXT = Object.entries(ITEM_NAMES).map(([id, name]) => [id, `${id} ${name}`.toLowerCase()] as const);

/** Item ids the WHOLE query names (every term in one item's id + name). */
export function queryItemIds(query: string, A: AtlasData): Set<string> {
  const out = new Set<string>();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return out;
  const hit = (t: string) => terms.every((q) => t.includes(q));
  for (const [id, t] of ALL_ITEM_TEXT) if (hit(t)) out.add(id);
  (A.items ?? []).forEach((id, i) => {
    if (!out.has(id) && hit(`${id} ${A.itemNames?.[i] ?? ""}`.toLowerCase())) out.add(id);
  });
  return out;
}

/** How far from a location's centre a container still counts as in it. Dungeon
 *  rooms sprawl (and their interiors sit ~5000 m up at the same x, z), so they
 *  get more room than a ruin. */
const NEAR_DUNGEON = 100;
const NEAR_OTHER = 40;

export interface SaveIndex {
  /** Per chest: the atlas location it belongs to, or -1 for open ground. */
  near: Int32Array;
  /** Atlas location -> chest indexes in it. */
  byLoc: globalThis.Map<number, number[]>;
}

export function buildSaveIndex(scan: SaveScan, A: AtlasData): SaveIndex {
  const CELL = 200;
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const grid = new globalThis.Map<string, number[]>();
  for (let i = 0; i < A.p.length; i++) {
    const k = key(A.x[i], A.z[i]);
    const b = grid.get(k);
    if (b) b.push(i);
    else grid.set(k, [i]);
  }
  const near = new Int32Array(scan.chests.length).fill(-1);
  const byLoc = new globalThis.Map<number, number[]>();
  scan.chests.forEach((c, ci) => {
    const [x, , z] = c.pos;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (const i of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d = Math.hypot(A.x[i] - x, A.z[i] - z);
          const reach = A.rOff[i + 1] > A.rOff[i] ? NEAR_DUNGEON : NEAR_OTHER;
          if (d <= reach && d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    near[ci] = best;
    if (best >= 0) {
      const list = byLoc.get(best);
      if (list) list.push(ci);
      else byLoc.set(best, [ci]);
    }
  });
  return { near, byLoc };
}

const CONTAINER_LABEL: Record<string, string> = {
  piece_chest_wood: "Wood chest",
  piece_chest: "Reinforced chest",
  piece_chest_private: "Personal chest",
  piece_chest_blackmetal: "Black metal chest",
  piece_chest_barrel: "Barrel",
  piece_chest_treasure: "Treasure chest",
  Cart: "Cart",
  Karve: "Karve",
  Raft: "Raft",
  VikingShip: "Longship",
  VikingShip_Ashlands: "Drakkar",
  Trailership: "Trailership",
  piece_incinerator: "Obliterator",
};

/** What a container is, in words: built ones by kind and who built them. */
export function chestLabel(c: SaveChest): string {
  if (c.prefab === "Player_tombstone") return c.creatorName ? `Tombstone (${c.creatorName})` : "Tombstone";
  const kind = CONTAINER_LABEL[c.prefab];
  if (c.creator) return `${kind ?? "Container"} · built by ${c.creatorName || "a player"}`;
  return kind ?? "World chest";
}
