import { create } from "zustand";
import { VALHEIM_ITEMS, type ValheimItem } from "../data/valheim-items";

export type SortOption = "name-asc" | "name-desc" | "tier-asc" | "tier-desc" | "biome-grouped";
export type ViewMode = "grid" | "table";
export type TableSortKey = "name" | "type" | "subcategory" | "biome" | "from" | "found";
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
export interface ArmorSetBonus {
  name: string;
  tooltip: string;
}

export interface ArmorSet {
  setId: string;
  setName: string;
  pieces: ValheimItem[];
  setSize: number;
  bonus?: ArmorSetBonus;
  /**
   * Human-readable mechanical breakdown of the set's status effect.
   * One line per modifier, e.g. "+25 Sneak skill" or "Run stamina cost -5%".
   * Empty when MegaDataExtractor hasn't dumped a `setEffect` yet for this set.
   */
  bonusLines: string[];
}

// Set bonus name + tooltip strings, sourced from Valheim's localization
// (`se_<setId>seteffect_name` / `_tooltip` keys in the data dump). The dump
// doesn't link these to items directly — `equipEffect` is empty on individual
// pieces — so we map setId → bonus here. Update this table when the game
// adds a new full-set effect.
const SET_BONUSES: Record<string, ArmorSetBonus> = {
  AshlandsMediumArmor: {
    name: "Ask's Endurance",
    tooltip: "A lighter armour lets you move more freely, every move requiring less energy.",
  },
  berserker_armor: {
    name: "Berserk",
    tooltip: "Increases damage and regeneration, but weakens you against physical damage.",
  },
  berserker_armor_undead: {
    name: "Vilebone Wrath",
    tooltip: "Increases damage and regeneration, but weakens you against physical damage.",
  },
  fenring_armor: {
    name: "Fenris blessing",
    tooltip:
      "The Fenris armour makes you quick on your feet so you can pass through fire, and your fists feel the power of the beast.",
  },
  harvester: {
    name: "Harvester",
    tooltip: "Wearing the right clothes makes the chores easier.",
  },
  root_armor: {
    name: "Improved archery",
    tooltip: "The ancient roots help you focus your bow skill.",
  },
  troll: {
    name: "Sneaky",
    tooltip: "Makes you more sneaky.",
  },
};

export function getArmorSetBonus(setId: string): ArmorSetBonus | undefined {
  return SET_BONUSES[setId];
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
  // Set effect mechanics live on the chest piece; find whichever piece carries it.
  const setEffect = pieces.find((p) => p.setEffect)?.setEffect ?? null;
  return {
    setId,
    setName: formatSetName(setId),
    pieces,
    setSize,
    bonus: SET_BONUSES[setId],
    bonusLines: setEffect ? formatSetEffectModifiers(setEffect.modifiers) : [],
  };
}

// Human label + suffix for known SE_Stats modifier fields. Pair-bound fields
// (skillLevel/skillType, modifyAttackSkill/modifyAttackSkillAmount) are handled
// separately in `formatSetEffectModifiers`. Anything not in this map but with
// a non-zero numeric value falls back to a humanised key + raw value.
// Modifier fields whose default value is 1.0 (multipliers). Skip them when they
// equal 1.0 so the bullet list isn't padded with "Eitr regen +0%" lines.
const MULTIPLIER_FIELDS = new Set([
  "healthRegenMultiplier",
  "staminaRegenMultiplier",
  "eitrRegenMultiplier",
  "damageModifier",
  "pheromoneLevelUpMultiplier",
]);

// Always-skip noise from the dump: Unity defaults, internal flags, or fields
// whose user-facing meaning is opaque without game context.
const ALWAYS_SKIP_FIELDS = new Set([
  "hitType",
  "isNew",
  "pheromoneLevelUpMultiplier",
]);

const MODIFIER_LABELS: Record<string, { label: string; format: "percent-cost" | "percent-bonus" | "percent-multiplier" | "additive" | "raw" }> = {
  runStaminaUseModifier:    { label: "Run stamina cost",    format: "percent-cost" },
  runStaminaDrainModifier:  { label: "Run stamina drain",   format: "percent-cost" },
  jumpStaminaUseModifier:   { label: "Jump stamina cost",   format: "percent-cost" },
  swimStaminaUseModifier:   { label: "Swim stamina cost",   format: "percent-cost" },
  attackStaminaUseModifier: { label: "Attack stamina cost", format: "percent-cost" },
  blockStaminaUseModifier:  { label: "Block stamina cost",  format: "percent-cost" },
  dodgeStaminaUseModifier:  { label: "Dodge stamina cost",  format: "percent-cost" },
  sneakStaminaUseModifier:  { label: "Sneak stamina cost",  format: "percent-cost" },
  speedModifier:            { label: "Run speed",           format: "percent-bonus" },
  jumpModifier:             { label: "Jump height",         format: "percent-bonus" },
  noiseModifier:            { label: "Noise",               format: "percent-bonus" },
  stealthModifier:          { label: "Stealth",             format: "percent-bonus" },
  fallDamageModifier:       { label: "Fall damage",         format: "percent-bonus" },
  meleeDamageModifier:      { label: "Melee damage",        format: "percent-bonus" },
  damageModifier:           { label: "Damage dealt",        format: "percent-multiplier" },
  eitrRegenMultiplier:      { label: "Eitr regen",          format: "percent-multiplier" },
  healthRegenMultiplier:    { label: "Health regen",        format: "percent-multiplier" },
  staminaRegenMultiplier:   { label: "Stamina regen",       format: "percent-multiplier" },
  addMaxCarryWeight:        { label: "Max carry weight",    format: "additive" },
  pierceArmor:              { label: "Pierce armour",       format: "additive" },
  armorModifier:            { label: "Armour",              format: "percent-bonus" },
};

const SKILL_NAME_OVERRIDES: Record<string, string> = {
  Bows: "Bow",
  BloodMagic: "Blood Magic",
  ElementalMagic: "Elemental Magic",
  Crossbows: "Crossbow",
};

function humaniseSkillName(skill: string): string {
  return SKILL_NAME_OVERRIDES[skill] ?? skill;
}

function formatSignedPercent(value: number): string {
  const pct = Math.round(value * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Convert a raw SE_Stats modifier object (as dumped by MegaDataExtractor) into
 * a list of human-readable bullet strings for the UI. Order is stable but not
 * meaningful — sets are tiny so a flat alphabetical-ish render is fine.
 */
export function formatSetEffectModifiers(
  modifiers: Record<string, string | number | boolean | Record<string, string>>
): string[] {
  const lines: string[] = [];

  // Skill bonus pair as dumped by Valheim's SE_Stats:
  //   skillLevel = SkillType enum (string, e.g. "Sneak")
  //   skillLevelModifier = float amount (e.g. 15)
  // Renders as "+15 Sneak skill".
  const skillType = modifiers.skillLevel;
  const skillAmount = modifiers.skillLevelModifier;
  if (typeof skillType === "string" && typeof skillAmount === "number" && skillAmount !== 0) {
    const sign = skillAmount > 0 ? "+" : "";
    lines.push(`${sign}${skillAmount} ${humaniseSkillName(skillType)} skill`);
  }

  // Standalone "attacks scale with this skill" effect — Fenris ("Bows" makes
  // unarmed punches scale with your bow skill) and Root use this.
  const modAttackSkill = modifiers.modifyAttackSkill;
  if (typeof modAttackSkill === "string" && modAttackSkill !== "None") {
    lines.push(`Attack damage scales with ${humaniseSkillName(modAttackSkill)} skill`);
  }

  // Per-type damage resistances (DamageModifiers struct, dumped as a sub-object).
  // Not present in any current vanilla set effect, but supported for forward-compat.
  const mods = modifiers.mods;
  if (mods && typeof mods === "object" && !Array.isArray(mods)) {
    for (const [dmgType, level] of Object.entries(mods as Record<string, string>)) {
      const human = dmgType.charAt(0).toUpperCase() + dmgType.slice(1);
      lines.push(`${human}: ${level}`);
    }
  }

  // Walk the rest using the label map
  const handledKeys = new Set([
    "skillLevel", "skillLevelModifier", "modifyAttackSkill", "mods",
  ]);
  for (const [key, raw] of Object.entries(modifiers)) {
    if (handledKeys.has(key)) continue;
    if (ALWAYS_SKIP_FIELDS.has(key)) continue;
    if (typeof raw !== "number" || raw === 0) continue;
    // Skip default-1.0 multipliers (no actual effect)
    if (MULTIPLIER_FIELDS.has(key) && Math.abs(raw - 1) < 0.0001) continue;

    const meta = MODIFIER_LABELS[key];
    if (!meta) {
      // Fallback: humanise camelCase key, render as raw signed value
      const human = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
      const sign = raw > 0 ? "+" : "";
      lines.push(`${human} ${sign}${raw}`);
      continue;
    }
    switch (meta.format) {
      case "percent-cost": {
        // Negative = reduction, render as `-N%`. Positive = penalty, render `+N%`.
        const pct = Math.round(raw * 100);
        const display = pct > 0 ? `+${pct}%` : `${pct}%`;
        lines.push(`${meta.label} ${display}`);
        break;
      }
      case "percent-bonus": {
        lines.push(`${meta.label} ${formatSignedPercent(raw)}`);
        break;
      }
      case "percent-multiplier": {
        // Multiplier of 1.05 = +5%. Multiplier of 0.95 = -5%.
        lines.push(`${meta.label} ${formatSignedPercent(raw - 1)}`);
        break;
      }
      case "additive": {
        const sign = raw > 0 ? "+" : "";
        lines.push(`${meta.label} ${sign}${raw}`);
        break;
      }
      case "raw": {
        lines.push(`${meta.label}: ${raw}`);
        break;
      }
    }
  }

  return lines;
}

// Lightweight helper for list views — just returns the display name, no piece lookup.
// Used by ValheimData card/table rows; getArmorSet() is for the detail page.
export function getArmorSetName(item: ValheimItem): string | null {
  const setStat = item.stats.find((s) => s.label === "Set");
  if (!setStat) return null;
  const match = setStat.value.match(/^(.+?)\s+\((\d+)pc\)$/);
  if (!match) return null;
  return formatSetName(match[1]);
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
  "Cooking Station",
  "Iron Cooking Station",
  "Stone Oven",
  "Forge",
  "Cauldron",
  "Mead Ketill",
  "Fermenter",
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
  "Mead Ketill": "piece_MeadCauldron",
  "Fermenter": "fermenter",
  "Food Preparation Table": "piece_preptable",
  "Cooking Station": "piece_cookingstation",
  "Iron Cooking Station": "piece_cookingstation_iron",
  "Stone Oven": "piece_oven",
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
  fuels?: Array<{ name: string; id: string }>;
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
    fuels: [{ name: "Coal", id: "Coal" }],
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
    fuels: [{ name: "Coal", id: "Coal" }],
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
  "Shield Generator": {
    name: "Shield Generator",
    prefab: "piece_shieldgenerator",
    description: "Creates a protective shield against weather and projectiles. Fuelled by bones — consumes Bone Fragments or Charred Bones to maintain its barrier.",
    biome: "Mistlands",
    fuels: [
      { name: "Bone Fragments", id: "BoneFragments" },
      { name: "Charred Bones", id: "CharredBone" },
    ],
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
  "Charcoal Kiln", "Smelter", "Blast Furnace",
  "Spinning Wheel", "Windmill", "Eitr Refinery", "Shield Generator", "Ballista",
] as const;

export const PROCESSING_STATION_ICONS: Record<string, string> = {
  "Charcoal Kiln": "charcoal_kiln",
  "Smelter": "smelter",
  "Blast Furnace": "blastfurnace",
  "Spinning Wheel": "piece_spinningwheel",
  "Windmill": "windmill",
  "Eitr Refinery": "eitrrefinery",
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
  if (ps.fuels) for (const f of ps.fuels) ids.add(f.id);
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

// ── Creature filter sources ─────────────────────────────────
/** Combat damage types the game exposes — used for creature filters. */
export const DAMAGE_TYPES = [
  "Blunt",
  "Slash",
  "Pierce",
  "Fire",
  "Frost",
  "Lightning",
  "Poison",
  "Spirit",
] as const;

/** All distinct factions present on current creature data, alphabetical. */
export const FACTION_LIST: string[] = (() => {
  const set = new Set<string>();
  for (const i of VALHEIM_ITEMS) if (i.type === "Creature" && i.faction) set.add(i.faction);
  return Array.from(set).sort();
})();

// ── Pre-computed totals (for Dashboard / PlayerData "out of" stats) ──
/** All obtainable trophies in the game database. */
export const TOTAL_TROPHIES = VALHEIM_ITEMS.filter((i) => i.subcategory === "Trophy").length;
/** All craftable things (items with a recipe). */
export const TOTAL_RECIPES = VALHEIM_ITEMS.filter((i) => i.recipe && i.recipe.length > 0).length;
/** Everything the player can realistically "discover" — all items that aren't creatures. */
export const TOTAL_DISCOVERABLE = VALHEIM_ITEMS.filter((i) => i.type !== "Creature").length;

/** Get all item IDs a vendor SELLS (excludes items they buy) */
export function getVendorItemIds(vendorName: string): Set<string> {
  const vendor = VENDORS[vendorName];
  if (!vendor) return new Set();
  const ids = new Set<string>();
  for (const s of vendor.sells) ids.add(s.id);
  return ids;
}

/** Iron Cooking Station is a superset of Cooking Station — anything grilled
 *  on the basic rack can also be grilled on the iron one, so item lists and
 *  craft-mat rollups for Iron Cooking Station include Cooking Station too. */
function expandStationSupersets(stationNames: string[]): string[] {
  if (!stationNames.includes("Iron Cooking Station")) return stationNames;
  if (stationNames.includes("Cooking Station")) return stationNames;
  return [...stationNames, "Cooking Station"];
}

/** Get items for a station detail view */
export function getStationItems(stationName: string): ValheimItem[] {
  const names = expandStationSupersets([stationName]);
  return VALHEIM_ITEMS.filter((i) => names.includes(i.station));
}

// Types that are "items in their own right" — exclude from materials lists when used as ingredients
const ITEM_INGREDIENT_TYPES = new Set(["Weapon", "Armor", "Tool", "Ammo"]);

/** Get all unique raw ingredients needed to craft/build at the given stations */
export function getStationMaterials(stationNames: string[], mode: "craft" | "build"): CartMaterial[] {
  const expanded = expandStationSupersets(stationNames);
  const totals = new Map<string, CartMaterial>();
  for (const name of expanded) {
    for (const item of VALHEIM_ITEMS.filter((i) => i.station === name)) {
      // Split: "craft" = non-BuildPiece items, "build" = BuildPiece items.
      // Siege engines (Catapult, Battering Ram) and Vehicles (Cart, boats) are
      // BuildPiece by game model but are crafted assemblies, not construction —
      // group their mats with Craft so they sit alongside their payloads / each
      // other instead of inflating wall-and-floor totals.
      const isAssembly = item.subcategory === "Siege" || item.subcategory === "Vehicle";
      if (mode === "craft" && item.type === "BuildPiece" && !isAssembly) continue;
      if (mode === "build" && (item.type !== "BuildPiece" || isAssembly)) continue;
      for (const ing of item.recipe) {
        const prev = totals.get(ing.id);
        totals.set(ing.id, { id: ing.id, name: ing.name, amount: (prev?.amount || 0) + ing.amount });
      }
      for (const uc of item.upgradeCosts) {
        for (const r of uc.resources) {
          const prev = totals.get(r.id);
          totals.set(r.id, { id: r.id, name: r.name, amount: (prev?.amount || 0) + r.amount });
        }
      }
    }
  }
  // Filter out ingredients that are themselves craftable weapons/armor/tools
  // (e.g. Berserkir Axes used to craft Bleeding Berserkir Axes — that's an upgrade path, not a raw material).
  // Exception: Torch-subcategory items (Dvergr Lantern) are genuine BuildPiece
  // ingredients (piece_dvergr_lantern + piece_dvergr_lantern_pole), not upgrade chains — keep them.
  const itemMap = new Map(VALHEIM_ITEMS.map(i => [i.id, i]));
  for (const [id] of totals) {
    const ingItem = itemMap.get(id);
    if (ingItem && ITEM_INGREDIENT_TYPES.has(ingItem.type) && ingItem.subcategory !== "Torch") {
      totals.delete(id);
    }
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Items that can show up as ingredients but should never count as raw mats:
// crafted weapons/armor/tools/ammo (already filtered) plus plantables (saplings
// drop here as upgrade-recipes for Hammer pieces in some mods — keep the list
// raw-resource only).
const NON_RAW_MAT_TYPES = new Set([...ITEM_INGREDIENT_TYPES, "Plantable"]);

/** "Player-obtainable" check used to weed out decoration-only BuildPieces.
 *  An ingredient counts as obtainable if it has any of: a recipe (craftable),
 *  drops (creature loot), worldSources (located in the world), or a source
 *  tag indicating a player-direct route (Pickup, Tree, Mining, Looting,
 *  Pickable, Crafting, Foraging, Fishing, Creature Drop, Chest Loot, Vendor).
 *  Pot_Shard_Red / CharcoalResin / etc. fail this — Ashlands ruin pots are
 *  decoration spawns, not Hammer-buildable. */
const PLAYER_OBTAINABLE_SOURCES = new Set([
  "Pickup", "Tree", "Mining", "Looting", "Pickable", "Crafting",
  "Foraging", "Fishing", "Creature Drop", "Chest Loot", "Vendor",
  // Destructibles drop materials when broken — Charcoal Resin (charred trees,
  // Ashlands), Pot Shards (ruin pots), Asksvin carrion bones, Dvergr Extractor
  // (Mistlands devices). Required for the Green Pot Furniture pieces to show
  // their CharcoalResin + Pot_Shard_Green ingredients in the build-mats rollup.
  "Destructible",
]);

const _bpItemMap = new Map(VALHEIM_ITEMS.map(i => [i.id, i]));

function isMaterialObtainable(itemId: string): boolean {
  const it = _bpItemMap.get(itemId);
  if (!it) return false;
  if ((it.recipe || []).length > 0) return true;
  if ((it.drops || []).length > 0) return true;
  if ((it.worldSources || []).length > 0) return true;
  return (it.source || []).some(s => PLAYER_OBTAINABLE_SOURCES.has(s));
}

/** A BuildPiece is "really player-buildable" when either its station is set
 *  (Hammer / Workbench / etc.) or all its recipe ingredients are obtainable.
 *  Catches the 9 Ashlands ruin pot pieces (empty station + un-obtainable
 *  Pot_Shard / CharcoalResin ingredients) without false-flagging legit Hammer
 *  pieces like Cooking Station / Campfire (empty station but Wood/Stone ings). */
function isPlayerBuildable(piece: ValheimItem): boolean {
  if (piece.station) return true;
  return (piece.recipe || []).every(ing => isMaterialObtainable(ing.id));
}

/** Get all unique raw ingredients needed to build BuildPieces (optionally
 *  filtered to specific sub-categories — Wall, Floor, Roof, etc.). Mirrors
 *  getStationMaterials but pivots on the BuildPiece sub-category axis instead
 *  of the station axis. Skips decoration-only pieces (see isPlayerBuildable)
 *  so Ashlands ruin pots don't pollute the rollup. */
export function getBuildPieceMaterials(subcategories: string[]): CartMaterial[] {
  const totals = new Map<string, CartMaterial>();
  const filterSet = subcategories.length > 0 ? new Set(subcategories) : null;
  for (const item of VALHEIM_ITEMS) {
    if (item.type !== "BuildPiece") continue;
    if (filterSet && !filterSet.has(item.subcategory)) continue;
    if (!isPlayerBuildable(item)) continue;
    for (const ing of item.recipe) {
      const canonical = _bpItemMap.get(ing.id);
      // Prefer the canonical name from the item record so manually-added
      // entries (ITEM_ADDITIONS) override raw token names left over from the
      // pieces dump (e.g. "$item_pot_shard_red" → "Red Pot Shard").
      const displayName = canonical?.name || ing.name;
      const prev = totals.get(ing.id);
      totals.set(ing.id, { id: ing.id, name: displayName, amount: (prev?.amount || 0) + ing.amount });
    }
    for (const uc of item.upgradeCosts) {
      for (const r of uc.resources) {
        const canonical = _bpItemMap.get(r.id);
        const displayName = canonical?.name || r.name;
        const prev = totals.get(r.id);
        totals.set(r.id, { id: r.id, name: displayName, amount: (prev?.amount || 0) + r.amount });
      }
    }
  }
  // Drop ingredients that are themselves crafted weapons/armor/tools/ammo so
  // the list stays raw materials only (matches getStationMaterials).
  // Exception: Torch-subcategory tools (Dvergr Lantern) are real building
  // ingredients for piece_dvergr_lantern + piece_dvergr_lantern_pole — keep them.
  for (const [id] of totals) {
    const ingItem = _bpItemMap.get(id);
    if (ingItem && NON_RAW_MAT_TYPES.has(ingItem.type) && ingItem.subcategory !== "Torch") {
      totals.delete(id);
    }
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Count BuildPieces aggregated by getBuildPieceMaterials for header display. */
export function getBuildPieceCount(subcategories: string[]): number {
  const filterSet = subcategories.length > 0 ? new Set(subcategories) : null;
  let n = 0;
  for (const item of VALHEIM_ITEMS) {
    if (item.type !== "BuildPiece") continue;
    if (filterSet && !filterSet.has(item.subcategory)) continue;
    if (!isPlayerBuildable(item)) continue;
    n++;
  }
  return n;
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
  onlyTameable: boolean;
  activeFactions: string[];
  activeDealsDamage: string[];
  activeWeakTo: string[];
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
  setOnlyTameable: (v: boolean) => void;
  toggleOnlyTameable: () => void;
  toggleFaction: (f: string) => void;
  toggleDealsDamage: (d: string) => void;
  toggleWeakTo: (d: string) => void;
  setSortBy: (s: SortOption) => void;
  setSelectedItem: (item: ValheimItem | null) => void;
  setSelectedStation: (station: string | null) => void;
  setSelectedFactory: (factory: string | null) => void;
  setSelectedVendor: (vendor: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setTableSort: (key: TableSortKey) => void;
  // Station materials mode: false = show items, "craft" = craft materials, "build" = build materials
  stationMaterialsMode: false | "craft" | "build";
  setStationMaterialsMode: (mode: false | "craft" | "build") => void;
  // Build piece materials mode: false = show pieces, "materials" = show aggregated build mats
  buildPieceMaterialsMode: false | "materials";
  setBuildPieceMaterialsMode: (mode: false | "materials") => void;
  // Return path — when set, the Back button on item/station/vendor detail
  // navigates to this route instead of clearing selection in place.
  // Set by cross-page links (e.g. PlayerData inventory click → item detail).
  returnPath: string | null;
  setReturnPath: (path: string | null) => void;
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
  onlyTameable: false,
  activeFactions: [],
  activeDealsDamage: [],
  activeWeakTo: [],
  sortBy: "name-asc",
  selectedItem: null,
  selectedStation: null,
  selectedFactory: null,
  selectedVendor: null,
  viewMode: savedViewMode === "table" ? "table" : "grid",
  tableSortKey: "name",
  tableSortDir: "asc",
  stationMaterialsMode: false,
  setStationMaterialsMode: (on) => set({ stationMaterialsMode: on }),
  buildPieceMaterialsMode: false,
  setBuildPieceMaterialsMode: (on) => set({ buildPieceMaterialsMode: on }),
  returnPath: null,
  setReturnPath: (returnPath) => set({ returnPath }),
  cartItems: [],
  cartOpen: false,
  setQuery: (query) => set({ query }),
  // Set single value (for detail view navigation)
  setActiveType: (t) => set((s) => ({
    activeTypes: t ? [t] : [],
    activeSubcategories: [],
    buildPieceMaterialsMode: t === "BuildPiece" ? s.buildPieceMaterialsMode : false,
  })),
  setActiveSubcategory: (s) => set({ activeSubcategories: s ? [s] : [] }),
  setActiveBiome: (b) => set({ activeBiomes: b ? [b] : [] }),
  setActiveStation: (s) => set({ activeStations: s ? [s] : [] }),
  setActiveFactory: (f) => set({ activeFactories: f ? [f] : [] }),
  setActiveVendor: (v) => set({ activeVendors: v ? [v] : [] }),
  // Toggle in/out of array (for sidebar checkboxes)
  toggleType: (t) => set((s) => {
    const nextTypes = s.activeTypes.includes(t) ? s.activeTypes.filter(x => x !== t) : [...s.activeTypes, t];
    return {
      activeTypes: nextTypes,
      activeSubcategories: [],
      buildPieceMaterialsMode: nextTypes.includes("BuildPiece") ? s.buildPieceMaterialsMode : false,
    };
  }),
  toggleSubcategory: (sub) => set((s) => ({
    activeSubcategories: s.activeSubcategories.includes(sub) ? s.activeSubcategories.filter(x => x !== sub) : [...s.activeSubcategories, sub],
  })),
  toggleBiome: (b) => set((s) => ({
    activeBiomes: s.activeBiomes.includes(b) ? s.activeBiomes.filter(x => x !== b) : [...s.activeBiomes, b],
  })),
  toggleStation: (st) => set((s) => {
    const next = s.activeStations.includes(st) ? s.activeStations.filter(x => x !== st) : [...s.activeStations, st];
    return { activeStations: next, stationMaterialsMode: next.length === 0 ? false : s.stationMaterialsMode };
  }),
  toggleFactory: (f) => set((s) => ({
    activeFactories: s.activeFactories.includes(f) ? s.activeFactories.filter(x => x !== f) : [...s.activeFactories, f],
  })),
  toggleVendor: (v) => set((s) => ({
    activeVendors: s.activeVendors.includes(v) ? s.activeVendors.filter(x => x !== v) : [...s.activeVendors, v],
  })),
  setOnlyTameable: (v) => set({ onlyTameable: v }),
  toggleOnlyTameable: () => set((s) => ({ onlyTameable: !s.onlyTameable })),
  toggleFaction: (f) => set((s) => ({
    activeFactions: s.activeFactions.includes(f) ? s.activeFactions.filter((x) => x !== f) : [...s.activeFactions, f],
  })),
  toggleDealsDamage: (d) => set((s) => ({
    activeDealsDamage: s.activeDealsDamage.includes(d) ? s.activeDealsDamage.filter((x) => x !== d) : [...s.activeDealsDamage, d],
  })),
  toggleWeakTo: (d) => set((s) => ({
    activeWeakTo: s.activeWeakTo.includes(d) ? s.activeWeakTo.filter((x) => x !== d) : [...s.activeWeakTo, d],
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
  activeFactories: string[] = [],
  onlyTameable: boolean = false,
  activeFactions: string[] = [],
  activeDealsDamage: string[] = [],
  activeWeakTo: string[] = []
): ValheimItem[] {
  let items = VALHEIM_ITEMS;
  if (onlyTameable) {
    items = items.filter((i) => i.tameable === true);
  }
  if (activeFactions.length > 0) {
    items = items.filter((i) => i.faction && activeFactions.includes(i.faction));
  }
  if (activeDealsDamage.length > 0) {
    items = items.filter((i) => i.dealsDamage && activeDealsDamage.every((d) => i.dealsDamage!.includes(d)));
  }
  if (activeWeakTo.length > 0) {
    items = items.filter((i) => i.weakTo && activeWeakTo.every((d) => i.weakTo!.includes(d)));
  }
  if (activeTypes.length > 0) {
    // "Plantable" matches both type==="Plantable" (the 17 sapling pieces) AND
    // any item flagged plantable===true (seeds/crops/mushrooms that keep their
    // primary Material/Food typing). Without this, Carrot/Onion/etc. wouldn't
    // surface under the Plantable filter.
    const plantableActive = activeTypes.includes("Plantable");
    items = items.filter((i) =>
      activeTypes.includes(i.type) || (plantableActive && i.plantable === true)
    );
  }
  if (activeSubcategories.length > 0) {
    items = items.filter((i) => activeSubcategories.includes(i.subcategory));
  }
  if (activeBiomes.length > 0) {
    items = items.filter((i) => i.biomes.some(b => activeBiomes.includes(b)));
  }
  if (activeStations.length > 0) {
    // Iron Cooking Station is a superset of Cooking Station — anything grilled on
    // the basic rack also grills on the iron one, so include both when Iron is selected.
    const stationMatch = activeStations.includes("Iron Cooking Station")
      ? new Set([...activeStations, "Cooking Station"])
      : new Set(activeStations);
    items = items.filter((i) => i.station != null && stationMatch.has(i.station));
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
    // Plantable is a union: type==="Plantable" OR plantable===true. Count items
    // whose primary type is something else (Material/Food) but have plantable
    // tagged so the Plantable filter shows the right total.
    if (item.plantable === true && item.type !== "Plantable") {
      counts["Plantable"] = (counts["Plantable"] || 0) + 1;
    }
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
    if (ps.fuels) for (const f of ps.fuels) if (baseIds.has(f.id)) seen.add(f.id);
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
