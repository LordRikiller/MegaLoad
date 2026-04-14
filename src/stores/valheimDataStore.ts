import { create } from "zustand";
import { VALHEIM_ITEMS, type ValheimItem } from "../data/valheim-items";

export type SortOption = "name-asc" | "name-desc" | "tier-asc" | "tier-desc" | "biome-grouped";
export type ViewMode = "grid" | "table";
export type TableSortKey = "name" | "type" | "subcategory" | "biome" | "from" | "weight" | "stack";
export type TableSortDir = "asc" | "desc";

// ── Vendor Data ──────────────────────────────────────────────
export interface VendorItem {
  id: string;       // item prefab id
  price: number;    // cost in coins or specific currency
  currency: string; // "Coins", "Coins + ForsakenKill", etc.
  requirement?: string; // e.g. "Defeat Eikthyr" unlock condition
}

export interface VendorBuyback {
  id: string;
  sellPrice: number;
}

export interface Vendor {
  name: string;
  description: string;
  biome: string;
  location: string;
  sells: VendorItem[];
  buys: VendorBuyback[];
}

export const VENDORS: Record<string, Vendor> = {
  Haldor: {
    name: "Haldor",
    description: "A Dvergr merchant found in the Black Forest. He sells useful tools and cosmetics for coins, with additional items unlocking as the world progresses.",
    biome: "Black Forest",
    location: "Random spawn in Black Forest (one per world seed)",
    sells: [
      { id: "HelmetYule", price: 100, currency: "Coins" },
      { id: "HelmetDverger", price: 620, currency: "Coins" },
      { id: "BeltStrength", price: 950, currency: "Coins" },
      { id: "YmirRemains", price: 120, currency: "Coins", requirement: "Defeat The Elder" },
      { id: "FishingRod", price: 350, currency: "Coins" },
      { id: "FishingBait", price: 10, currency: "Coins" },
      { id: "Thunderstone", price: 50, currency: "Coins", requirement: "Defeat The Elder" },
      { id: "ChickenEgg", price: 1500, currency: "Coins", requirement: "Defeat Yagluth" },
      { id: "BarrelRings", price: 100, currency: "Coins" },
    ],
    buys: [
      { id: "Amber", sellPrice: 5 },
      { id: "AmberPearl", sellPrice: 10 },
      { id: "Ruby", sellPrice: 20 },
      { id: "SilverNecklace", sellPrice: 30 },
    ],
  },
  Hildir: {
    name: "Hildir",
    description: "A spirited Dvergr adventurer found in the Meadows. She sells unique cosmetic armour, accessories and novelties. Her finest wares unlock after returning her stolen chests from dungeon quests.",
    biome: "Meadows",
    location: "Random spawn in Meadows (one per world seed)",
    sells: [
      // Always available
      { id: "ArmorDress10", price: 250, currency: "Coins" },
      { id: "ArmorTunic10", price: 250, currency: "Coins" },
      { id: "HelmetHat5", price: 150, currency: "Coins" },
      { id: "HelmetHat10", price: 150, currency: "Coins" },
      { id: "HelmetSweatBand", price: 175, currency: "Coins" },
      { id: "Sparkler", price: 150, currency: "Coins" },
      { id: "Ironpit", price: 75, currency: "Coins" },
      { id: "BarberKit", price: 600, currency: "Coins" },
      // Brass chest (Black Forest dungeon)
      { id: "ArmorDress1", price: 350, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorDress4", price: 350, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorDress7", price: 350, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorTunic1", price: 350, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorTunic4", price: 350, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorTunic7", price: 350, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "HelmetHat1", price: 200, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "HelmetHat3", price: 200, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "HelmetStrawHat", price: 300, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorHarvester1", price: 550, currency: "Coins", requirement: "Return Brass Chest" },
      { id: "ArmorHarvester2", price: 550, currency: "Coins", requirement: "Return Brass Chest" },
      // Silver chest (Mountain dungeon)
      { id: "ArmorDress2", price: 450, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "ArmorDress5", price: 450, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "ArmorDress8", price: 450, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "ArmorTunic2", price: 450, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "ArmorTunic5", price: 450, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "ArmorTunic8", price: 450, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "HelmetHat2", price: 250, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "HelmetHat4", price: 250, currency: "Coins", requirement: "Return Silver Chest" },
      { id: "HelmetHat6", price: 250, currency: "Coins", requirement: "Return Silver Chest" },
      // Bronze chest (Plains dungeon)
      { id: "ArmorDress3", price: 550, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "ArmorDress6", price: 550, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "ArmorDress9", price: 550, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "ArmorTunic3", price: 550, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "ArmorTunic6", price: 550, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "ArmorTunic9", price: 550, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "HelmetHat7", price: 300, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "HelmetHat8", price: 300, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "HelmetHat9", price: 300, currency: "Coins", requirement: "Return Bronze Chest" },
      { id: "FireworksRocket_White", price: 50, currency: "Coins", requirement: "Return Bronze Chest" },
    ],
    buys: [
      { id: "Amber", sellPrice: 5 },
      { id: "AmberPearl", sellPrice: 10 },
      { id: "Ruby", sellPrice: 20 },
      { id: "SilverNecklace", sellPrice: 30 },
    ],
  },
  "Bog Witch": {
    name: "Bog Witch",
    description: "A mysterious Greydwarf crone dwelling in the Swamp. She sells unique crafting ingredients and spices for coins, with additional items unlocking as the world progresses.",
    biome: "Swamp",
    location: "Random spawn in Swamp (one per world seed)",
    sells: [
      { id: "CandleWick", price: 100, currency: "Coins" },
      { id: "FreshSeaweed", price: 75, currency: "Coins" },
      { id: "CuredSquirrelHamstring", price: 80, currency: "Coins" },
      { id: "PowderedDragonEgg", price: 120, currency: "Coins" },
      { id: "PungentPebbles", price: 125, currency: "Coins" },
      { id: "LovePotion", price: 110, currency: "Coins" },
      { id: "IvySeeds", price: 65, currency: "Coins" },
      { id: "Feaster", price: 140, currency: "Coins" },
      { id: "BlobVial", price: 150, currency: "Coins", requirement: "Defeat The Elder" },
      { id: "SpiceForests", price: 120, currency: "Coins", requirement: "Defeat The Elder" },
      { id: "SpiceSea", price: 130, currency: "Coins", requirement: "Kill a Serpent" },
      { id: "MushroomBzerker", price: 85, currency: "Coins", requirement: "Defeat Moder" },
      { id: "FragrantBundle", price: 140, currency: "Coins", requirement: "Defeat Moder" },
      { id: "ScytheHandle", price: 200, currency: "Coins", requirement: "Defeat Moder" },
      { id: "SpiceMountains", price: 140, currency: "Coins", requirement: "Defeat Moder" },
      { id: "SpicePlains", price: 160, currency: "Coins", requirement: "Defeat Yagluth" },
      { id: "SpiceMistlands", price: 180, currency: "Coins", requirement: "Defeat The Queen" },
      { id: "SpiceAshlands", price: 200, currency: "Coins", requirement: "Defeat Fader" },
    ],
    buys: [
      { id: "Amber", sellPrice: 5 },
      { id: "AmberPearl", sellPrice: 10 },
      { id: "Ruby", sellPrice: 20 },
      { id: "SilverNecklace", sellPrice: 30 },
    ],
  },
};

// ── Armor Sets ───────────────────────────────────────────────
export interface ArmorSet {
  setId: string;
  setName: string;
  pieces: ValheimItem[];
  setSize: number;
  setBonus?: string;
}

export function getArmorSet(item: ValheimItem): ArmorSet | null {
  const setStat = item.stats.find((s) => s.label === "Set");
  if (!setStat) return null;
  // Parse "AshlandsMediumArmor (3pc)" → setId + setSize
  const match = setStat.value.match(/^(.+?)\s+\((\d+)pc\)$/);
  if (!match) return null;
  const setId = match[1];
  const setSize = parseInt(match[2], 10);
  const pieces = VALHEIM_ITEMS.filter((i) =>
    i.stats.some((s) => s.label === "Set" && s.value.startsWith(setId))
  );
  return { setId, setName: formatSetName(setId), pieces, setSize };
}

function formatSetName(setId: string): string {
  // Convert "AshlandsMediumArmor" → "Ashlands Medium Armor"
  return setId.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

// ── Vendor lookup ────────────────────────────────────────────
export function getVendorForItem(itemId: string): { vendor: Vendor; entry: VendorItem } | null {
  for (const v of Object.values(VENDORS)) {
    const entry = v.sells.find((s) => s.id === itemId);
    if (entry) return { vendor: v, entry };
  }
  return null;
}

export function getVendorBuyPrice(itemId: string): { vendor: Vendor; sellPrice: number } | null {
  for (const v of Object.values(VENDORS)) {
    const entry = v.buys.find((b) => b.id === itemId);
    if (entry) return { vendor: v, sellPrice: entry.sellPrice };
  }
  return null;
}

// Valheim biome progression order — maps directly to gear quality tiers
export const BIOME_ORDER = [
  "Meadows",
  "Black Forest",
  "Ocean",
  "Swamp",
  "Mountain",
  "Plains",
  "Mistlands",
  "Ashlands",
  "Deep North",
] as const;

export type BiomeName = (typeof BIOME_ORDER)[number];

const BIOME_TIER: Record<string, number> = {};
BIOME_ORDER.forEach((b, i) => (BIOME_TIER[b] = i));
// Items with no biome go last in ascending, first in descending
const NO_BIOME_TIER = BIOME_ORDER.length;

export const STATION_LIST = [
  "Workbench",
  "Forge",
  "Cauldron",
  "Mead Ketill",
  "Stonecutter",
  "Artisan Table",
  "Black Forge",
  "Galdr Table",
  "Food Preparation Table",
] as const;

// ── Station icon lookup ──────────────────────────────────────
export const STATION_ICONS: Record<string, string> = {
  "Workbench": "piece_workbench",
  "Forge": "forge",
  "Cauldron": "piece_cauldron",
  "Stonecutter": "piece_stonecutter",
  "Artisan Table": "piece_artisanstation",
  "Black Forge": "blackforge",
  "Galdr Table": "piece_magetable",
  "Mead Ketill": "fermenter",
  "Food Preparation Table": "piece_cookingstation",
};

// ── Processing Stations (Factories) ──────────────────────────
// These stations convert raw materials into refined products (smelting, grinding, etc.)
// The game dump doesn't include conversion recipes, so we define them here.

export interface ProcessingConversion {
  inputId: string;
  inputName: string;
  outputId: string;
  outputName: string;
  inputAmount?: number;  // default 1
  outputAmount?: number; // default 1
}

export interface ProcessingStation {
  name: string;
  prefab: string;        // build piece prefab ID (for icon + build recipe lookup)
  description: string;
  biome: string;
  fuel?: string;         // fuel item name (e.g. "Coal")
  fuelId?: string;       // fuel prefab ID
  conversions: ProcessingConversion[];
}

export const PROCESSING_STATIONS: Record<string, ProcessingStation> = {
  "Charcoal Kiln": {
    name: "Charcoal Kiln",
    prefab: "charcoal_kiln",
    description: "Converts wood into coal. Accepts regular wood and fine wood. Essential for fuelling smelters and blast furnaces.",
    biome: "Black Forest",
    conversions: [
      { inputId: "Wood", inputName: "Wood", outputId: "Coal", outputName: "Coal" },
      { inputId: "FineWood", inputName: "Fine Wood", outputId: "Coal", outputName: "Coal" },
      { inputId: "RoundLog", inputName: "Core Wood", outputId: "Coal", outputName: "Coal" },
    ],
  },
  "Smelter": {
    name: "Smelter",
    prefab: "smelter",
    description: "Smelts basic ores into metal bars using coal as fuel. Processes copper, tin, iron, and silver ores.",
    biome: "Black Forest",
    fuel: "Coal",
    fuelId: "Coal",
    conversions: [
      { inputId: "CopperOre", inputName: "Copper Ore", outputId: "Copper", outputName: "Copper" },
      { inputId: "TinOre", inputName: "Tin Ore", outputId: "Tin", outputName: "Tin" },
      { inputId: "IronScrap", inputName: "Scrap Iron", outputId: "Iron", outputName: "Iron" },
      { inputId: "SilverOre", inputName: "Silver Ore", outputId: "Silver", outputName: "Silver" },
      { inputId: "CopperScrap", inputName: "Copper Scrap", outputId: "Copper", outputName: "Copper" },
      { inputId: "IronOre", inputName: "Iron Ore", outputId: "Iron", outputName: "Iron" },
      { inputId: "BronzeScrap", inputName: "Scrap Bronze", outputId: "Bronze", outputName: "Bronze" },
    ],
  },
  "Blast Furnace": {
    name: "Blast Furnace",
    prefab: "blastfurnace",
    description: "An advanced furnace that smelts high-tier ores. Processes black metal scraps and flametal ore using coal.",
    biome: "Plains",
    fuel: "Coal",
    fuelId: "Coal",
    conversions: [
      { inputId: "BlackMetalScrap", inputName: "Black Metal Scrap", outputId: "BlackMetal", outputName: "Black Metal" },
      { inputId: "FlametalOreNew", inputName: "Flametal Ore", outputId: "FlametalNew", outputName: "Refined Flametal" },
    ],
  },
  "Spinning Wheel": {
    name: "Spinning Wheel",
    prefab: "piece_spinningwheel",
    description: "Spins raw flax into linen thread. Required for crafting padded armour and some Plains-tier gear.",
    biome: "Plains",
    conversions: [
      { inputId: "Flax", inputName: "Flax", outputId: "LinenThread", outputName: "Linen Thread" },
    ],
  },
  "Windmill": {
    name: "Windmill",
    prefab: "windmill",
    description: "Grinds barley into barley flour. Must be placed outdoors with wind exposure to function.",
    biome: "Plains",
    conversions: [
      { inputId: "Barley", inputName: "Barley", outputId: "BarleyFlour", outputName: "Barley Flour" },
    ],
  },
  "Eitr Refinery": {
    name: "Eitr Refinery",
    prefab: "eitrrefinery",
    description: "Refines soft tissue and sap into refined Eitr — the magical essence needed for Mistlands-tier staffs and gear.",
    biome: "Mistlands",
    conversions: [
      { inputId: "Sap", inputName: "Sap", outputId: "Eitr", outputName: "Refined Eitr" },
      { inputId: "Softtissue", inputName: "Soft Tissue", outputId: "Eitr", outputName: "Refined Eitr" },
    ],
  },
  "Stone Oven": {
    name: "Stone Oven",
    prefab: "piece_oven",
    description: "Bakes bread and pies from prepared dough. Produces high-tier food items that cannot be made on a regular cooking station.",
    biome: "Plains",
    conversions: [
      { inputId: "BreadDough", inputName: "Bread Dough", outputId: "Bread", outputName: "Bread" },
      { inputId: "LoxPie_uncooked", inputName: "Unbaked Lox Pie", outputId: "LoxPie", outputName: "Lox Meat Pie" },
      { inputId: "FishAndBread_uncooked", inputName: "Unbaked Fish & Bread", outputId: "FishAndBread", outputName: "Fish & Bread" },
      { inputId: "MeatPlatter_uncooked", inputName: "Unbaked Meat Platter", outputId: "MeatPlatter", outputName: "Meat Platter" },
      { inputId: "HoneyGlazedChicken_uncooked", inputName: "Honey Glazed Chicken (raw)", outputId: "HoneyGlazedChicken", outputName: "Honey Glazed Chicken" },
      { inputId: "MisthareSupreme_uncooked", inputName: "Unbaked Misthare Supreme", outputId: "MisthareSupreme", outputName: "Misthare Supreme" },
      { inputId: "MagicallyStuffedShroom_uncooked", inputName: "Unbaked Stuffed Shroom", outputId: "MagicallyStuffedShroom", outputName: "Magically Stuffed Shroom" },
      { inputId: "PiquantPie_uncooked", inputName: "Unbaked Piquant Pie", outputId: "PiquantPie", outputName: "Piquant Pie" },
      { inputId: "RoastedCrustPie_uncooked", inputName: "Unbaked Roasted Crust Pie", outputId: "RoastedCrustPie", outputName: "Roasted Crust Pie" },
      { inputId: "VikingCupcake_uncooked", inputName: "Unbaked Viking Cupcake", outputId: "VikingCupcake", outputName: "Viking Cupcake" },
    ],
  },
  "Shield Generator": {
    name: "Shield Generator",
    prefab: "piece_shieldgenerator",
    description: "Creates a protective shield against weather and projectiles. Fuelled by bones — consumes Bone Fragments to maintain its barrier.",
    biome: "Mistlands",
    fuel: "Bone Fragments",
    fuelId: "BoneFragments",
    conversions: [],
  },
  "Ballista": {
    name: "Ballista",
    prefab: "piece_turret",
    description: "Automated defensive turret that fires missiles at hostile targets. Must be loaded with turret missiles — available in wood, black metal, and flametal variants.",
    biome: "Mistlands",
    conversions: [
      { inputId: "TurretBoltWood", inputName: "Wooden Missile", outputId: "TurretBoltWood", outputName: "Wooden Missile" },
      { inputId: "TurretBolt", inputName: "Black Metal Missile", outputId: "TurretBolt", outputName: "Black Metal Missile" },
      { inputId: "TurretBoltFlametal", inputName: "Flametal Missile", outputId: "TurretBoltFlametal", outputName: "Flametal Missile" },
    ],
  },
};

export const PROCESSING_STATION_LIST = [
  "Charcoal Kiln", "Smelter", "Blast Furnace", "Spinning Wheel",
  "Windmill", "Eitr Refinery", "Stone Oven", "Shield Generator", "Ballista",
] as const;

export const PROCESSING_STATION_ICONS: Record<string, string> = {
  "Charcoal Kiln": "charcoal_kiln",
  "Smelter": "smelter",
  "Blast Furnace": "blastfurnace",
  "Spinning Wheel": "piece_spinningwheel",
  "Windmill": "windmill",
  "Eitr Refinery": "eitrrefinery",
  "Stone Oven": "piece_oven",
  "Shield Generator": "piece_shieldgenerator",
  "Ballista": "piece_turret",
};

/** Check if a station name is a processing station (factory) */
export function isProcessingStation(name: string): boolean {
  return name in PROCESSING_STATIONS;
}

/** Get the processing station that produces a given item (by output ID) */
export function getProcessingStationForOutput(outputId: string): { station: ProcessingStation; conversion: ProcessingConversion } | null {
  for (const ps of Object.values(PROCESSING_STATIONS)) {
    const conv = ps.conversions.find((c) => c.outputId === outputId);
    if (conv) return { station: ps, conversion: conv };
  }
  return null;
}

/** Get all output item IDs for a processing station */
export function getProcessingStationOutputIds(stationName: string): Set<string> {
  const ps = PROCESSING_STATIONS[stationName];
  if (!ps) return new Set();
  return new Set(ps.conversions.map((c) => c.outputId));
}

/** Get all input + output item IDs for a processing station (for filtering) */
export function getProcessingStationItemIds(stationName: string): Set<string> {
  const ps = PROCESSING_STATIONS[stationName];
  if (!ps) return new Set();
  const ids = new Set<string>();
  if (ps.fuelId) ids.add(ps.fuelId);
  for (const c of ps.conversions) {
    ids.add(c.inputId);
    ids.add(c.outputId);
  }
  return ids;
}

// ── Creature trophy icon fallback ────────────────────────────
// Creatures without direct icons use their trophy drop icon instead
const CREATURE_TROPHY_OVERRIDE: Record<string, string> = {
  "Asksvin_hatchling": "TrophyAsksvin",
  "Charred_Archer_Fader": "TrophyCharredArcher",
  "Charred_Twitcher": "TrophyCharredMelee",
  "BlobFrost": "TrophyBlob",

  "Greyling": "TrophyGreydwarf",
  "BlobLava": "TrophySurtling",
  "SeekerBrood": "TrophySeeker",
  "GoblinBrute_Hildir": "TrophyGoblinBrute",
};

/** Get the icon ID for a creature (trophy fallback if no direct icon) */
export function getCreatureIconId(creature: ValheimItem): string {
  // Check hardcoded overrides first
  if (CREATURE_TROPHY_OVERRIDE[creature.id]) return CREATURE_TROPHY_OVERRIDE[creature.id];
  // Use trophy from drops if available
  const trophyDrop = creature.drops.find((d) => d.id.startsWith("Trophy"));
  if (trophyDrop) return trophyDrop.id;
  return creature.id;
}

// ── Vendor filter list ───────────────────────────────────────
export const VENDOR_LIST = ["Haldor", "Hildir", "Bog Witch"] as const;

/** Get all item IDs a vendor SELLS (excludes items they buy) */
export function getVendorItemIds(vendorName: string): Set<string> {
  const vendor = VENDORS[vendorName];
  if (!vendor) return new Set();
  const ids = new Set<string>();
  for (const s of vendor.sells) ids.add(s.id);
  return ids;
}

/** Get items for a station detail view */
export function getStationItems(stationName: string): ValheimItem[] {
  return VALHEIM_ITEMS.filter((i) => i.station === stationName);
}

/** Get items grouped by station level */
export function getStationItemsByLevel(stationName: string): Map<number, ValheimItem[]> {
  const items = getStationItems(stationName);
  const byLevel = new Map<number, ValheimItem[]>();
  for (const item of items) {
    const lvl = item.stationLevel || 1;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(item);
  }
  return byLevel;
}

// ── Station upgrade pieces ───────────────────────────────────
// Maps each station to its upgrade piece prefab IDs (in upgrade order)
export const STATION_UPGRADES: Record<string, string[]> = {
  "Workbench": ["piece_workbench_ext1", "piece_workbench_ext2", "piece_workbench_ext3", "piece_workbench_ext4"],
  "Forge": ["forge_ext1", "forge_ext2", "forge_ext3", "forge_ext4", "forge_ext5", "forge_ext6"],
  "Cauldron": ["cauldron_ext1_spice", "cauldron_ext3_butchertable", "cauldron_ext4_pots", "cauldron_ext5_mortarandpestle", "cauldron_ext6_rollingpins"],
  "Black Forge": ["blackforge_ext1", "blackforge_ext2_vise", "blackforge_ext3_metalcutter", "blackforge_ext4_gemcutter"],
  "Galdr Table": ["piece_magetable_ext", "piece_magetable_ext2", "piece_magetable_ext3"],
  "Artisan Table": ["artisan_ext1"],
};

/** Get upgrade pieces for a station as full item entries */
export function getStationUpgrades(stationName: string): ValheimItem[] {
  const upgradeIds = STATION_UPGRADES[stationName];
  if (!upgradeIds) return [];
  return upgradeIds
    .map((id) => VALHEIM_ITEMS.find((i) => i.id === id))
    .filter((i): i is ValheimItem => i != null);
}

interface ValheimDataState {
  query: string;
  activeTypes: string[];
  activeSubcategories: string[];
  activeBiomes: string[];
  activeStations: string[];
  activeFactories: string[];
  activeVendors: string[];
  sortBy: SortOption;
  selectedItem: ValheimItem | null;
  selectedStation: string | null;
  selectedFactory: string | null;
  selectedVendor: string | null;
  // View mode
  viewMode: ViewMode;
  tableSortKey: TableSortKey;
  tableSortDir: TableSortDir;
  setQuery: (q: string) => void;
  // Set single value (for detail view navigation)
  setActiveType: (t: string) => void;
  setActiveSubcategory: (s: string) => void;
  setActiveBiome: (b: string) => void;
  setActiveStation: (s: string) => void;
  setActiveFactory: (f: string) => void;
  setActiveVendor: (v: string) => void;
  // Toggle in/out of array (for sidebar checkboxes)
  toggleType: (t: string) => void;
  toggleSubcategory: (s: string) => void;
  toggleBiome: (b: string) => void;
  toggleStation: (s: string) => void;
  toggleFactory: (f: string) => void;
  toggleVendor: (v: string) => void;
  setSortBy: (s: SortOption) => void;
  setSelectedItem: (item: ValheimItem | null) => void;
  setSelectedStation: (station: string | null) => void;
  setSelectedFactory: (factory: string | null) => void;
  setSelectedVendor: (vendor: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setTableSort: (key: TableSortKey) => void;
  // Cart
  cartItems: CartEntry[];
  cartOpen: boolean;
  addToCart: (id: string, targetLevel: number) => void;
  removeFromCart: (id: string) => void;
  updateCartLevel: (id: string, targetLevel: number) => void;
  clearCart: () => void;
  setCartOpen: (open: boolean) => void;
}

export interface CartEntry {
  id: string;
  targetLevel: number;
}

const savedViewMode = (typeof localStorage !== "undefined" ? localStorage.getItem("valheim-view-mode") : null) as ViewMode | null;

export const useValheimDataStore = create<ValheimDataState>((set) => ({
  query: "",
  activeTypes: [],
  activeSubcategories: [],
  activeBiomes: [],
  activeStations: [],
  activeFactories: [],
  activeVendors: [],
  sortBy: "name-asc",
  selectedItem: null,
  selectedStation: null,
  selectedFactory: null,
  selectedVendor: null,
  viewMode: savedViewMode === "table" ? "table" : "grid",
  tableSortKey: "name",
  tableSortDir: "asc",
  cartItems: [],
  cartOpen: false,
  setQuery: (query) => set({ query }),
  // Set single value (for detail view navigation)
  setActiveType: (t) => set({ activeTypes: t ? [t] : [], activeSubcategories: [] }),
  setActiveSubcategory: (s) => set({ activeSubcategories: s ? [s] : [] }),
  setActiveBiome: (b) => set({ activeBiomes: b ? [b] : [] }),
  setActiveStation: (s) => set({ activeStations: s ? [s] : [] }),
  setActiveFactory: (f) => set({ activeFactories: f ? [f] : [] }),
  setActiveVendor: (v) => set({ activeVendors: v ? [v] : [] }),
  // Toggle in/out of array (for sidebar checkboxes)
  toggleType: (t) => set((s) => ({
    activeTypes: s.activeTypes.includes(t) ? s.activeTypes.filter(x => x !== t) : [...s.activeTypes, t],
    activeSubcategories: [],
  })),
  toggleSubcategory: (sub) => set((s) => ({
    activeSubcategories: s.activeSubcategories.includes(sub) ? s.activeSubcategories.filter(x => x !== sub) : [...s.activeSubcategories, sub],
  })),
  toggleBiome: (b) => set((s) => ({
    activeBiomes: s.activeBiomes.includes(b) ? s.activeBiomes.filter(x => x !== b) : [...s.activeBiomes, b],
  })),
  toggleStation: (st) => set((s) => ({
    activeStations: s.activeStations.includes(st) ? s.activeStations.filter(x => x !== st) : [...s.activeStations, st],
  })),
  toggleFactory: (f) => set((s) => ({
    activeFactories: s.activeFactories.includes(f) ? s.activeFactories.filter(x => x !== f) : [...s.activeFactories, f],
  })),
  toggleVendor: (v) => set((s) => ({
    activeVendors: s.activeVendors.includes(v) ? s.activeVendors.filter(x => x !== v) : [...s.activeVendors, v],
  })),
  setSortBy: (sortBy) => set({ sortBy }),
  setSelectedItem: (selectedItem) => set({ selectedItem }),
  setSelectedStation: (selectedStation) => set({ selectedStation }),
  setSelectedFactory: (selectedFactory) => set({ selectedFactory }),
  setSelectedVendor: (selectedVendor) => set({ selectedVendor }),
  setViewMode: (viewMode) => {
    localStorage.setItem("valheim-view-mode", viewMode);
    set({ viewMode });
  },
  setTableSort: (key) =>
    set((s) => ({
      tableSortKey: key,
      tableSortDir: s.tableSortKey === key && s.tableSortDir === "asc" ? "desc" : "asc",
    })),
  addToCart: (id, targetLevel) =>
    set((s) => {
      if (s.cartItems.some((c) => c.id === id)) return s;
      return { cartItems: [...s.cartItems, { id, targetLevel }] };
    }),
  removeFromCart: (id) =>
    set((s) => ({ cartItems: s.cartItems.filter((c) => c.id !== id) })),
  updateCartLevel: (id, targetLevel) =>
    set((s) => ({
      cartItems: s.cartItems.map((c) => (c.id === id ? { ...c, targetLevel } : c)),
    })),
  clearCart: () => set({ cartItems: [] }),
  setCartOpen: (cartOpen) => set({ cartOpen }),
}));

function sortItems(items: ValheimItem[], sortBy: SortOption): ValheimItem[] {
  const sorted = [...items];
  switch (sortBy) {
    case "name-asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "name-desc":
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "tier-asc":
      return sorted.sort((a, b) => {
        const ta = Math.min(...(a.biomes.length ? a.biomes.map((b) => BIOME_TIER[b] ?? NO_BIOME_TIER) : [NO_BIOME_TIER]));
        const tb = Math.min(...(b.biomes.length ? b.biomes.map((b) => BIOME_TIER[b] ?? NO_BIOME_TIER) : [NO_BIOME_TIER]));
        return ta !== tb ? ta - tb : a.name.localeCompare(b.name);
      });
    case "tier-desc":
      return sorted.sort((a, b) => {
        const ta = Math.min(...(a.biomes.length ? a.biomes.map((b) => BIOME_TIER[b] ?? NO_BIOME_TIER) : [NO_BIOME_TIER]));
        const tb = Math.min(...(b.biomes.length ? b.biomes.map((b) => BIOME_TIER[b] ?? NO_BIOME_TIER) : [NO_BIOME_TIER]));
        return ta !== tb ? tb - ta : a.name.localeCompare(b.name);
      });
    case "biome-grouped":
      return sorted.sort((a, b) => {
        const ta = Math.min(...(a.biomes.length ? a.biomes.map((b) => BIOME_TIER[b] ?? NO_BIOME_TIER) : [NO_BIOME_TIER]));
        const tb = Math.min(...(b.biomes.length ? b.biomes.map((b) => BIOME_TIER[b] ?? NO_BIOME_TIER) : [NO_BIOME_TIER]));
        return ta !== tb ? ta - tb : a.name.localeCompare(b.name);
      });
  }
}

export function getFilteredItems(
  query: string,
  activeTypes: string[],
  activeBiomes: string[] = [],
  activeStations: string[] = [],
  activeVendors: string[] = [],
  sortBy: SortOption = "name-asc",
  activeSubcategories: string[] = [],
  activeFactories: string[] = []
): ValheimItem[] {
  let items = VALHEIM_ITEMS;
  if (activeTypes.length > 0) {
    items = items.filter((i) => activeTypes.includes(i.type));
  }
  if (activeSubcategories.length > 0) {
    items = items.filter((i) => activeSubcategories.includes(i.subcategory));
  }
  if (activeBiomes.length > 0) {
    items = items.filter((i) => i.biomes.some(b => activeBiomes.includes(b)));
  }
  if (activeStations.length > 0) {
    items = items.filter((i) => i.station != null && activeStations.includes(i.station));
  }
  if (activeFactories.length > 0) {
    const factoryIds = new Set<string>();
    for (const f of activeFactories) {
      for (const id of getProcessingStationItemIds(f)) factoryIds.add(id);
    }
    items = items.filter((i) => factoryIds.has(i.id));
  }
  if (activeVendors.length > 0) {
    const vendorIds = new Set<string>();
    for (const v of activeVendors) {
      for (const id of getVendorItemIds(v)) vendorIds.add(id);
    }
    items = items.filter((i) => vendorIds.has(i.id));
  }
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.subcategory.toLowerCase().includes(q) ||
        i.biomes.some((b) => b.toLowerCase().includes(q)) ||
        i.source.some((s) => s.toLowerCase().includes(q))
    );
  }
  return sortItems(items, sortBy);
}

export function getUsedIn(itemId: string): ValheimItem[] {
  return VALHEIM_ITEMS.filter((item) =>
    item.recipe?.some((r) => r.id === itemId)
  );
}

export function getDroppedBy(itemId: string): ValheimItem[] {
  return VALHEIM_ITEMS.filter((item) =>
    item.drops?.some((d) => d.id === itemId)
  );
}

// ── Precomputed "dropped by" index for O(1) lookups in table view ──
const _droppedByIndex = new Map<string, string[]>();
for (const item of VALHEIM_ITEMS) {
  for (const drop of item.drops || []) {
    const arr = _droppedByIndex.get(drop.id);
    if (arr) arr.push(item.name);
    else _droppedByIndex.set(drop.id, [item.name]);
  }
}

/** Returns a short "From" label for the table column — station, vendor, creature, or source */
export function getItemSource(item: ValheimItem): string {
  // Crafting station takes priority for craftable items
  if (item.station) return item.station;
  // Processing station (e.g. Smelter, Fermenter)
  const ps = getProcessingStationForOutput(item.id);
  if (ps) return ps.station.name;
  // Vendor
  const vendor = getVendorForItem(item.id);
  if (vendor) return vendor.vendor.name;
  // Creature drops
  const creatures = _droppedByIndex.get(item.id);
  if (creatures?.length) return creatures.length <= 2 ? creatures.join(", ") : `${creatures[0]} +${creatures.length - 1}`;
  // World sources (trees, rocks, chests, pickups)
  if (item.worldSources?.length) return item.worldSources[0].source + (item.worldSources.length > 1 ? ` +${item.worldSources.length - 1}` : "");
  // Fallback to source array
  if (item.source?.length) return item.source.join(", ");
  return "";
}

export function getItemById(id: string): ValheimItem | undefined {
  return VALHEIM_ITEMS.find((i) => i.id === id);
}

export function getWikiUrl(item: ValheimItem): string {
  return item.wikiUrl || "";
}

export function getRelatedItems(item: ValheimItem): ValheimItem[] {
  if (!item.wikiGroup) return [];
  return VALHEIM_ITEMS.filter(
    (i) => i.wikiGroup === item.wikiGroup && i.id !== item.id
  );
}

export function getTypeCounts(
  query: string,
  activeBiomes: string[] = [],
  activeStations: string[] = []
): Record<string, number> {
  const base = getFilteredItems(query, [], activeBiomes, activeStations);
  const counts: Record<string, number> = {};
  for (const item of base) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }
  return counts;
}

export function getBiomeCounts(
  query: string,
  activeTypes: string[] = [],
  activeStations: string[] = []
): Record<string, number> {
  const base = getFilteredItems(query, activeTypes, [], activeStations);
  const counts: Record<string, number> = {};
  for (const item of base) {
    for (const b of item.biomes) {
      counts[b] = (counts[b] || 0) + 1;
    }
  }
  return counts;
}

export function getStationCounts(
  query: string,
  activeTypes: string[] = [],
  activeBiomes: string[] = []
): Record<string, number> {
  const base = getFilteredItems(query, activeTypes, activeBiomes);
  const counts: Record<string, number> = {};
  for (const item of base) {
    if (item.station) counts[item.station] = (counts[item.station] || 0) + 1;
  }
  return counts;
}

export function getVendorCounts(
  query: string,
  activeTypes: string[] = [],
  activeBiomes: string[] = [],
  activeStations: string[] = []
): Record<string, number> {
  const base = getFilteredItems(query, activeTypes, activeBiomes, activeStations);
  const baseIds = new Set(base.map((i) => i.id));
  const counts: Record<string, number> = {};
  for (const [name, vendor] of Object.entries(VENDORS)) {
    let count = 0;
    for (const s of vendor.sells) if (baseIds.has(s.id)) count++;
    counts[name] = count;
  }
  return counts;
}

export function getFactoryCounts(
  query: string,
  activeTypes: string[] = [],
  activeBiomes: string[] = [],
  activeStations: string[] = []
): Record<string, number> {
  const base = getFilteredItems(query, activeTypes, activeBiomes, activeStations);
  const baseIds = new Set(base.map((i) => i.id));
  const counts: Record<string, number> = {};
  for (const [name, ps] of Object.entries(PROCESSING_STATIONS)) {
    const seen = new Set<string>();
    if (ps.fuelId && baseIds.has(ps.fuelId)) seen.add(ps.fuelId);
    for (const c of ps.conversions) {
      if (baseIds.has(c.inputId)) seen.add(c.inputId);
      if (baseIds.has(c.outputId)) seen.add(c.outputId);
    }
    counts[name] = seen.size;
  }
  return counts;
}

export function getSubcategoryCounts(
  query: string,
  activeTypes: string[],
  activeBiomes: string[] = [],
  activeStations: string[] = []
): Record<string, number> {
  if (activeTypes.length === 0) return {};
  const base = getFilteredItems(query, activeTypes, activeBiomes, activeStations);
  const counts: Record<string, number> = {};
  for (const item of base) {
    if (item.subcategory) counts[item.subcategory] = (counts[item.subcategory] || 0) + 1;
  }
  return counts;
}

// ── Cart material aggregation ────────────────────────────────
export interface CartMaterial {
  id: string;
  name: string;
  amount: number;
}

export function getCartMaterials(cartItems: CartEntry[]): CartMaterial[] {
  const totals = new Map<string, CartMaterial>();
  for (const entry of cartItems) {
    const item = VALHEIM_ITEMS.find((i) => i.id === entry.id);
    if (!item) continue;
    // Add base recipe
    for (const ing of item.recipe) {
      const prev = totals.get(ing.id);
      totals.set(ing.id, { id: ing.id, name: ing.name, amount: (prev?.amount || 0) + ing.amount });
    }
    // Add upgrades up to targetLevel
    for (const uc of item.upgradeCosts) {
      if (uc.level > entry.targetLevel) break;
      for (const r of uc.resources) {
        const prev = totals.get(r.id);
        totals.set(r.id, { id: r.id, name: r.name, amount: (prev?.amount || 0) + r.amount });
      }
    }
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}
