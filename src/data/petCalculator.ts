// ── Pet Calculator game data ────────────────────────────────
// Taming / breeding constants for Valheim's tameable creatures, plus the
// wall-piece catalogue used by the pen planner.
//
// Costs, names, icons and drops are NOT duplicated here — the calculator reads
// them live from VALHEIM_ITEMS via getItemById() so a remote data hot-swap
// keeps the calculator in step with the Valheim Data page.
//
// Sources: Valheim taming/breeding mechanics (600 taming ticks = 30 min, 10 min
// fed duration, 10 s eating interval), per-species procreation caps and ranges.
// Piece footprints are the build-grid nominal sizes encoded in the prefab names
// (wood_wall = 2x2 m, stone_wall_4x2 = 4x2 m, …); wall thickness is the
// approximate collider depth and only feeds the inner-area subtraction.

export interface PetSpecies {
  /** Stable key for UI state. */
  key: string;
  /** Creature prefab id — used for the icon, drops and the Valheim Data link. */
  creatureId: string;
  label: string;
  /** Biome the wild population lives in (Hen has none — hatched, not found). */
  biome: string;
  /** How close you must stand for the creature to accept food, in metres. */
  feedRange: number;
  /** Feeds required before a tamed pair will breed (love points). */
  lovePoints: number;
  /** Max creatures inside `popRadius` before breeding stops. */
  popCap: number;
  /** Radius the procreation check counts creatures within, in metres. */
  popRadius: number;
  /** How close a partner must be for a pairing, in metres. */
  partnerRange: number;
  /** Pregnancy duration in minutes. */
  pregnancyMinutes: number;
  /** Minutes for a newborn to reach breeding adulthood. */
  growthMinutes: number;
  /** Egg-hatch time in minutes when kept warm — egg-layers only. */
  eggHatchMinutes?: number;
  /** Wild adults can't be tamed for these — you hatch them instead. */
  hatchOnly?: boolean;
  /** Recommended enclosure height in metres (guidance, not a game constant). */
  wallHeight: number;
  /** Practical pen-building notes shown alongside the results. */
  notes: string[];
}

/** Taming is identical across species: 600 successful ticks at 3 s each. */
export const TAMING = {
  /** Minutes of uninterrupted taming. */
  minutes: 30,
  /** Minutes with Brew of Animal Whispers active. */
  brewMinutes: 15,
  /** How long one food item keeps a creature fed, in minutes. */
  fedMinutes: 10,
  /** Seconds between eating checks while food is in reach. */
  eatIntervalSeconds: 10,
  /** Seconds between taming ticks while fed and unafraid. */
  tickSeconds: 3,
  /** Successful ticks needed to finish taming. */
  ticks: 600,
} as const;

export const PET_SPECIES: PetSpecies[] = [
  {
    key: "boar",
    creatureId: "Boar",
    label: "Boar",
    biome: "Meadows",
    feedRange: 1,
    lovePoints: 3,
    popCap: 5,
    popRadius: 10,
    partnerRange: 3,
    pregnancyMinutes: 1,
    growthMinutes: 50,
    wallHeight: 2,
    notes: [
      "Boars can't jump — a 2 m wall or a single stakewall ring holds them.",
      "Never ring a boar pen with Sharp Stakes: the spikes damage the livestock, not just raiders.",
      "Drop food through a 1 m gap in the roof line so you never have to open the gate.",
    ],
  },
  {
    key: "wolf",
    creatureId: "Wolf",
    label: "Wolf",
    biome: "Mountain",
    feedRange: 1.4,
    lovePoints: 3,
    popCap: 4,
    popRadius: 10,
    partnerRange: 3,
    pregnancyMinutes: 1,
    growthMinutes: 50,
    wallHeight: 3,
    notes: [
      "Wolves take fall damage and claw at wooden walls — stone or black marble lasts longer.",
      "Tame from behind a 1 m raised wall or a pit: an untamed wolf hits for 70 damage.",
      "Cubs follow you before they're grown — pen the parents before the litter matures.",
    ],
  },
  {
    key: "lox",
    creatureId: "Lox",
    label: "Lox",
    biome: "Plains",
    feedRange: 4,
    lovePoints: 4,
    popCap: 4,
    popRadius: 20,
    partnerRange: 8,
    pregnancyMinutes: 2,
    growthMinutes: 100,
    wallHeight: 4,
    notes: [
      "A lox flattens wooden walls when it panics — build the pen from stone or black marble.",
      "The 20 m density check is double everyone else's: a wide pen still counts as one cluster.",
      "Feed from outside the wall — a lox slap does 120 blunt damage through a gate opening.",
    ],
  },
  {
    key: "hen",
    creatureId: "Hen",
    label: "Hen / Chicken",
    biome: "Ashlands",
    feedRange: 1,
    lovePoints: 3,
    popCap: 10,
    popRadius: 10,
    partnerRange: 4,
    pregnancyMinutes: 1,
    growthMinutes: 50,
    eggHatchMinutes: 30,
    hatchOnly: true,
    wallHeight: 1,
    notes: [
      "Eggs only hatch near a heat source — campfire, hearth or bonfire inside the coop.",
      "Chicks are tiny and slip through 1 m gaps; use whole walls or a 1x1 grate floor.",
      "Hens are already tame on hatching — you never run the 30-minute taming clock.",
    ],
  },
  {
    key: "asksvin",
    creatureId: "Asksvin",
    label: "Asksvin",
    biome: "Ashlands",
    feedRange: 4,
    lovePoints: 3,
    popCap: 10,
    popRadius: 10,
    partnerRange: 4,
    pregnancyMinutes: 1,
    growthMinutes: 50,
    eggHatchMinutes: 30,
    hatchOnly: true,
    wallHeight: 4,
    notes: [
      "Asksvin hatch from eggs kept warm — wild adults can't be tamed.",
      "Grausten or flametal walls only: an Ashlands pen also has to survive the neighbours.",
      "Saddle an adult once it's grown — the pen only needs to hold it until then.",
    ],
  },
];

// ── Wall pieces ─────────────────────────────────────────────

export interface WallPiece {
  /** Build-piece prefab id — resolves name, icon, station and recipe live. */
  id: string;
  /** Material family used to group the picker. */
  group: string;
  /** Short label for the picker chip (the full name comes from the dataset). */
  short: string;
  /** Piece width along the wall run, in metres. */
  width: number;
  /** Piece height, in metres. */
  height: number;
  /** Approximate collider depth — subtracted twice from the outer span. */
  thickness: number;
  /** Livestock can be seen (and shot) through it. */
  seeThrough?: boolean;
  /** Damages anything that touches it — never wrap livestock in these. */
  damaging?: boolean;
  /** Extra note surfaced when the piece is selected. */
  note?: string;
}

export const WALL_PIECES: WallPiece[] = [
  // Wood — Workbench
  { id: "woodwall", group: "Wood", short: "Wall 2x2", width: 2, height: 2, thickness: 0.2 },
  { id: "wood_wall_half", group: "Wood", short: "Half 2x1", width: 2, height: 1, thickness: 0.2 },
  { id: "wood_wall_quarter", group: "Wood", short: "Quarter 1x1", width: 1, height: 1, thickness: 0.2 },
  { id: "wood_wall_log", group: "Wood", short: "Log beam 2 m", width: 2, height: 0.5, thickness: 0.5, note: "Log beams stack into a solid palisade and take more punishment than plank walls." },
  { id: "wood_wall_log_4x0.5", group: "Wood", short: "Log beam 4 m", width: 4, height: 0.5, thickness: 0.5 },
  { id: "stake_wall", group: "Wood", short: "Stakewall", width: 2, height: 1.5, thickness: 0.3, note: "Cheapest ring in the game — 4 Wood per 2 m, and boars can't clear it." },
  { id: "piece_sharpstakes", group: "Wood", short: "Sharp Stakes", width: 2, height: 1, thickness: 1, damaging: true, note: "Sharp Stakes damage your own livestock. Use them as an outer ring only." },

  // Ashwood — Workbench (Ashlands)
  { id: "ashwood_wall_2x2", group: "Ashwood", short: "Wall 2x2", width: 2, height: 2, thickness: 0.2 },
  { id: "ashwood_halfwall_1x2", group: "Ashwood", short: "Half 2x1", width: 2, height: 1, thickness: 0.2 },
  { id: "ashwood_quarterwall_1x1", group: "Ashwood", short: "Quarter 1x1", width: 1, height: 1, thickness: 0.2 },
  { id: "piece_stakewall_blackwood", group: "Ashwood", short: "Stakewall", width: 2, height: 2, thickness: 0.3 },

  // Stone — Stonecutter
  { id: "stone_wall_1x1", group: "Stone", short: "1x1", width: 1, height: 1, thickness: 0.5 },
  { id: "stone_wall_2x1", group: "Stone", short: "2x1", width: 2, height: 1, thickness: 0.5 },
  { id: "stone_wall_4x2", group: "Stone", short: "4x2", width: 4, height: 2, thickness: 0.5, note: "Best stone-per-metre in the game — 6 Stone covers 8 m² of wall." },

  // Grausten — Stonecutter (Ashlands)
  { id: "Piece_grausten_wall_1x2", group: "Grausten", short: "1x2", width: 1, height: 2, thickness: 0.5 },
  { id: "Piece_grausten_wall_2x2", group: "Grausten", short: "2x2", width: 2, height: 2, thickness: 0.5 },
  { id: "Piece_grausten_wall_4x2", group: "Grausten", short: "4x2", width: 4, height: 2, thickness: 0.5 },

  // Black marble — Stonecutter (Mistlands)
  { id: "blackmarble_tile_wall_1x1", group: "Black Marble", short: "Tile 1x1", width: 1, height: 1, thickness: 0.5 },
  { id: "blackmarble_tile_wall_2x2", group: "Black Marble", short: "Tile 2x2", width: 2, height: 2, thickness: 0.5 },
  { id: "blackmarble_tile_wall_2x4", group: "Black Marble", short: "Tile 2x4", width: 2, height: 4, thickness: 0.5, note: "One course of tall tiles clears a 4 m lox wall with no second layer." },

  // Iron cage — Forge
  { id: "iron_wall_1x1", group: "Iron Cage", short: "Cage 1x1", width: 1, height: 1, thickness: 0.1, seeThrough: true },
  { id: "iron_wall_2x2", group: "Iron Cage", short: "Cage 2x2", width: 2, height: 2, thickness: 0.1, seeThrough: true, note: "See-through walls let you count the herd without opening the gate." },

  // Crystal — Workbench
  { id: "crystal_wall_1x1", group: "Crystal", short: "Crystal 1x1", width: 1, height: 1, thickness: 0.1, seeThrough: true },

  // Dvergr — Black Forge
  { id: "piece_dvergr_wood_wall", group: "Dvergr", short: "Wall 2x2", width: 2, height: 2, thickness: 0.2 },
  { id: "piece_dvergr_metal_wall_2x2", group: "Dvergr", short: "Metal 2x2", width: 2, height: 2, thickness: 0.2 },
  { id: "piece_dvergr_stake_wall", group: "Dvergr", short: "Stakewall", width: 2, height: 2, thickness: 0.3 },
];

export const WALL_GROUPS: string[] = Array.from(new Set(WALL_PIECES.map((p) => p.group)));

// ── Access pieces (gates + doors) ───────────────────────────

export interface AccessPiece {
  id: string;
  short: string;
  /** Opening width consumed from the wall run, in metres. */
  width: number;
}

export const ACCESS_PIECES: AccessPiece[] = [
  { id: "wood_gate", short: "Wood Gate", width: 2 },
  { id: "wood_door", short: "Wood Door", width: 1 },
  { id: "iron_grate", short: "Iron Gate", width: 2 },
  { id: "darkwood_gate", short: "Darkwood Gate", width: 2 },
  { id: "piece_hexagonal_door", short: "Hexagonal Gate", width: 2 },
  { id: "flametal_gate", short: "Flametal Gate", width: 2 },
  { id: "ashwood_door", short: "Ashwood Door", width: 1 },
  { id: "piece_dvergr_wood_door", short: "Dvergr Door", width: 1 },
];

// ── Pen geometry ────────────────────────────────────────────

export type PenShape = "octagon" | "rectangle" | "square";

export interface PenGeometry {
  /** Length of wall to build, in metres, after gate openings are removed. */
  wallRun: number;
  /** Full outer perimeter before gates, in metres. */
  perimeter: number;
  /** Usable floor area inside the walls, in m². */
  innerArea: number;
  /** Human-readable inner dimensions. */
  innerLabel: string;
  /** Straight runs the wall breaks into — pieces can't span a corner. */
  sides: number[];
}

/** Regular octagon: side = span × (√2 − 1), area = 2(√2 − 1) × span². */
const OCT_SIDE_RATIO = Math.SQRT2 - 1;
const OCT_AREA_RATIO = 2 * (Math.SQRT2 - 1);

export function computePenGeometry(
  shape: PenShape,
  outerA: number,
  outerB: number,
  thickness: number,
): PenGeometry {
  if (shape === "octagon") {
    const innerSpan = Math.max(0, outerA - 2 * thickness);
    const side = outerA * OCT_SIDE_RATIO;
    return {
      perimeter: 8 * side,
      wallRun: 8 * side,
      innerArea: OCT_AREA_RATIO * innerSpan * innerSpan,
      innerLabel: `${innerSpan.toFixed(1)} m across the flats`,
      sides: Array(8).fill(side),
    };
  }
  const len = outerA;
  const wid = shape === "square" ? outerA : outerB;
  const innerL = Math.max(0, len - 2 * thickness);
  const innerW = Math.max(0, wid - 2 * thickness);
  return {
    perimeter: 2 * (len + wid),
    wallRun: 2 * (len + wid),
    innerArea: innerL * innerW,
    innerLabel: `${innerL.toFixed(1)} m × ${innerW.toFixed(1)} m`,
    sides: [len, wid, len, wid],
  };
}

/**
 * Pieces needed for one course of wall. Counted per straight side because a
 * piece can't bridge a corner — `ceil(perimeter / width)` under-counts every
 * wall whose sides aren't a clean multiple of the piece width.
 */
export function piecesPerCourse(sides: number[], pieceWidth: number): number {
  return sides.reduce((sum, side) => sum + Math.ceil(side / pieceWidth), 0);
}

/**
 * Breeding clusters a pen can hold. The procreation check counts creatures
 * within `popRadius`, so a pen wider than one check circle can carry several
 * independent clusters — the classic "one big paddock beats four small ones"
 * trick. Upper bound: livestock huddle, so real herds land under this.
 */
export function breedingClusters(innerArea: number, popRadius: number): number {
  const clusterArea = Math.PI * popRadius * popRadius;
  return Math.max(1, Math.floor(innerArea / clusterArea));
}

// ── Breeding simulation ─────────────────────────────────────

export interface HerdSample {
  minute: number;
  adults: number;
  young: number;
  total: number;
}

export interface HerdProjection {
  samples: HerdSample[];
  /** Minutes to reach the population cap, or null if it never gets there. */
  minutesToCap: number | null;
  /** Population at the end of the window. */
  finalTotal: number;
  /** Food items eaten across the whole window. */
  foodEaten: number;
  cap: number;
}

/**
 * Step a herd forward a minute at a time. Each pregnancy cycle every pair of
 * adults produces one newborn while the counted population is under the cap;
 * newborns become breeding adults after `growthMinutes`. Food burn assumes a
 * stocked trough — one item per animal per fed-duration.
 */
export function projectHerd(
  species: PetSpecies,
  startAdults: number,
  cap: number,
  windowMinutes: number,
): HerdProjection {
  let adults = Math.max(0, Math.floor(startAdults));
  const growing: number[] = []; // minutes remaining until adulthood
  const samples: HerdSample[] = [{ minute: 0, adults, young: 0, total: adults }];
  let minutesToCap: number | null = adults >= cap ? 0 : null;
  let foodEaten = 0;
  const sampleEvery = Math.max(1, Math.round(windowMinutes / 24));

  for (let minute = 1; minute <= windowMinutes; minute++) {
    // Growth first — a newborn that matures this minute can breed next cycle.
    for (let i = growing.length - 1; i >= 0; i--) {
      growing[i] -= 1;
      if (growing[i] <= 0) {
        growing.splice(i, 1);
        adults += 1;
      }
    }
    const population = adults + growing.length;
    foodEaten += population / TAMING.fedMinutes;

    if (minute % species.pregnancyMinutes === 0 && population < cap && adults >= 2) {
      const births = Math.min(Math.floor(adults / 2), cap - population);
      for (let b = 0; b < births; b++) growing.push(species.growthMinutes);
    }

    const total = adults + growing.length;
    if (minutesToCap === null && total >= cap) minutesToCap = minute;
    if (minute % sampleEvery === 0 || minute === windowMinutes) {
      samples.push({ minute, adults, young: growing.length, total });
    }
  }

  return {
    samples,
    minutesToCap,
    finalTotal: adults + growing.length,
    foodEaten: Math.ceil(foodEaten),
    cap,
  };
}

/** Expected units of a drop per kill, folding in drop chance and min/max roll. */
export function expectedDrop(min: number, max: number, chance: number): number {
  return ((min + max) / 2) * chance;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
