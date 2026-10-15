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
