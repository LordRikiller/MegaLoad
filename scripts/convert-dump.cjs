/**
 * Converts valheim_data_dump.json (from MegaDataExtractor BepInEx plugin)
 * into the TypeScript data file used by MegaLoad's Valheim Data page.
 * 
 * Usage: node convert-dump.cjs
 * Output: src/data/valheim-items.ts
 */

const fs = require("fs");
const path = require("path");

// MegaDataExtractor 1.4.3+ writes to %APPDATA%\MegaLoad\. Fall back to the
// legacy workspace-root location for old dumps captured before the migration.
const APPDATA_DUMP = process.env.APPDATA
  ? path.join(process.env.APPDATA, "MegaLoad", "valheim_data_dump.json")
  : null;
const LEGACY_DUMP = path.join(__dirname, "..", "..", "valheim_data_dump.json");
const DUMP_PATH = APPDATA_DUMP && fs.existsSync(APPDATA_DUMP) ? APPDATA_DUMP : LEGACY_DUMP;
const OUTPUT_PATH = path.join(__dirname, "..", "src", "data", "valheim-items.ts");
const WIKI_MAP_PATH = path.join(__dirname, "wiki-map.json");

// Wiki map: prefab ID → [url] or [url, groupName]
const WIKI_MAP = fs.existsSync(WIKI_MAP_PATH) ? JSON.parse(fs.readFileSync(WIKI_MAP_PATH, "utf-8")) : {};

let rawText = fs.readFileSync(DUMP_PATH, "utf-8");
// Strip BOM if present (C# UTF8 encoding adds it)
if (rawText.charCodeAt(0) === 0xFEFF) rawText = rawText.substring(1);
const raw = JSON.parse(rawText);
const { items, recipes, creatureDrops, pieces, localization } = raw;

// ── Plantable taxonomy ─────────────────────────────────────
// Plantables are items the player places via the Cultivator (or seeds/produce
// that loop back into a Cultivator placement). The 17 sapling BuildPieces are
// re-typed to "Plantable" so they don't pollute the BuildPiece list (saplings
// inflate the build-mat rollups with seed recipes that have nothing to do with
// structures). Seeds, crops, and plantable mushrooms keep their primary type
// (Material/Food) so they stay in those category filters, but get plantable=true
// so the Plantable filter still surfaces them.

// Sapling BuildPieces — re-typed to Plantable + sub="Sapling".
const PLANTABLE_PIECES = new Set([
  "sapling_barley", "sapling_carrot", "sapling_flax", "sapling_jotunpuffs",
  "sapling_magecap", "sapling_onion", "sapling_seedcarrot", "sapling_seedonion",
  "sapling_seedturnip", "sapling_turnip",
  "Beech_Sapling", "Birch_Sapling", "FirTree_Sapling", "Oak_Sapling",
  "PineTree_Sapling", "VineAsh_sapling", "VineGreen_sapling",
]);

// Seeds + plantable produce — flagged plantable=true while keeping their
// primary type for the Material/Food filters.
const PLANTABLE_FLAG = new Set([
  // Crop seeds
  "CarrotSeeds", "OnionSeeds", "TurnipSeeds",
  // Tree seeds (Acorn = oak)
  "BeechSeeds", "BirchSeeds", "Acorn", "FirCone", "PineCone",
  // Vine seeds (VineGreen = ivy)
  "VineberrySeeds", "VineGreenSeeds",
  // Plantable produce / grains
  "Carrot", "Onion", "Turnip", "Barley", "Flax",
  // Plantable mushrooms (used as their own seed)
  "MushroomJotunPuffs", "MushroomMagecap",
]);

// ── Localization resolver ──
function loc(token) {
  if (!token) return "";
  let text = token;
  if (token.startsWith("$")) {
    const key = token.substring(1);
    text = localization[key] || token;
  }
  return stripRichText(text);
}

// Strip Unity rich text tags from names/descriptions
function stripRichText(text) {
  if (!text) return "";
  return text
    .replace(/<\/?color[^>]*>/gi, "")
    .replace(/<\/?b>/gi, "")
    .replace(/<\/?i>/gi, "")
    .replace(/<\/?size[^>]*>/gi, "")
    .trim();
}

// ── Filter out creature/NPC attacks and internal items ──

// Prefab patterns that are ALWAYS creature/NPC attacks
const CREATURE_ATTACK_PATTERNS = [
  /_attack/i, /_bite$/i, /_ram$/i, /_spit$/i, /_punch$/i, /_stomp$/i,
  /_slam$/i, /_taunt$/i, /_scream$/i, /_screech$/i, /_claws$/i, /_heal$/i,
  /_throw$/i, /_shoot$/i, /_groundslam$/i, /BiteAttack/i, /_swipe/i,
  /_combo$/i, /_melee$/i, /_aoe$/i, /_breath$/i, /_spin$/i, /_swoopattack$/i,
  /_wingspin$/i, /_rootspawn$/i,
  /^bat_/, /^bjorn_/, /^blob_/, /^boar_/, /^charred_/i,
  /^deer_/, /^draugr_/, /^drake_/, /^fenring_/i, /^ghost_/, /^goblin(?!Totem)/i,
  /^greydwarf_/, /^greyling_/, /^hatchling_/, /^leech_/, /^lox_/,
  /^neck_/, /^seeker_/, /^skeleton_/, /^stonegolem_/, /^troll_/,
  /^ulv_/, /^valkyrie_/, /^wolf_/, /^wraith_/,
  /^Dverger/i, /^asksvin_/i, /^morgen_/i, /^volture_/i,
  /^fader_/i, /^eikthyr_/i, /^bonemass_/i, /^dragon_/i,
  /^gdking_/i, /^gd_king_/i, /^seekerqueen_/i, /^goblinking/i, /^chicken_/i,
  /^serpent_/i, /^deathsquito_/i, /^imp_/i, /^stone_golem_/i,
  /^fallenvalkyrie_/i, /^fallen_valkyrie/i, /^tick_/i, /^gjall_/i, /^surtling_/i,
  /^babyseeker/i, /^unbjorn/i, /^hildingfall/i, /^geirrhafa/i,
  /^frostresist_ragdoll/i, /^tentaroot/i, /^dvergr_/i,
  /^blobtar_/i, /^abomination_/i, /^thungur/i,
  /^BonemawSerpent_/i, /^SeekerBrute_/i, /^TrainingDummy/i,
];

// Specific prefabs to blacklist (NPC weapons, duplicates, world objects)
const BLACKLISTED_PREFABS = new Set([
  "GoblinSword",         // NPC fuling weapon
  "SwordIronFire",       // Duplicate Dyrnwyn (quest version, no recipe)
  "StoneRock",           // Internal rock object
  "Charred_Melee_Dyrnwyn", // NPC creature variant
  "Charred_Melee_Fader",   // NPC creature variant
  "Charred_Melee",         // NPC creature variant
  "SledgeCheat",         // Debug cheat weapon
  "SwordCheat",          // Debug cheat weapon
  "Tankard_dvergr",      // NPC dvergr item
  "Mistile_kamikaze",    // Creature kamikaze attack
  "PlayerUnarmed",       // Internal bare-hands weapon
  "RottenMeat",          // Decay product — not obtainable from a biome, zero food stats

  // Deprecated/removed items — not obtainable in current game
  "Flametal",            // Old "Ancient Metal" — replaced by FlametalNew in Ashlands update
  "FlametalOre",         // Old "Glowing Metal Ore" — replaced by FlametalOreNew
  "BonemawSerpentScale", // Bonemaw Scale — not a player-obtainable item
  "TrophyForestTroll",   // Deprecated — replaced by TrophyFrostTroll

  // Debug/test/unused items
  "CapeTest",           // Cape test item — not available in game
  "ShieldKnight",       // Knight Shield UNUSED — not available in game

  // Boss altar upgrade pickups — not player-usable items
  "HealthUpgrade_Bonemass",
  "HealthUpgrade_GDKing",
  "StaminaUpgrade_Greydwarf",
  "StaminaUpgrade_Troll",
  "StaminaUpgrade_Wraith",

  // Duplicate structure prefabs (player uses piece_shieldgenerator / piece_turret)
  "charred_shieldgenerator", // NPC charred variant of Shield Generator
  "fuling_turret",           // NPC fuling Ballista variant
]);

function isCreatureAttack(prefab) {
  return CREATURE_ATTACK_PATTERNS.some(pat => pat.test(prefab));
}

function isInternalItem(item) {
  const n = item.name;
  if (!n || n === "") return true;
  if (isCreatureAttack(item.prefab)) return true;
  if (BLACKLISTED_PREFABS.has(item.prefab)) return true;
  if (item.itemType === "Customization") return true;  // Hairstyles and beards
  // Items named with just the prefab (no $ token, likely internal)
  if (n === item.prefab && item.maxQuality <= 1 && item.value === 0) return true;
  return false;
}

// Filter for build pieces — skip world-spawned containers, NPC pieces, and deprecated pieces
function isWorldPiece(prefab) {
  if (/^TreasureChest_/i.test(prefab)) return true;
  if (/^loot_chest_/i.test(prefab)) return true;
  if (/^Placeable_Hard/i.test(prefab)) return true;    // World rock objects
  if (/^OLD_/i.test(prefab)) return true;               // Deprecated building pieces
  if (/^Ashlands_Arch/i.test(prefab)) return true;      // Ashlands ruin geometry (wrong name)
  if (/^Ashlands_WallBlock/i.test(prefab)) return true;  // Ashlands ruin geometry (wrong name)
  if (/^blackmarble_creep_/i.test(prefab)) return true;  // Vine-covered Dvergr ruin variants
  if (WORLD_PIECE_PREFABS.has(prefab)) return true;
  return false;
}

// Specific build pieces that exist in game data but aren't player-buildable
const WORLD_PIECE_PREFABS = new Set([
  "fire_pit_haldor",       // NPC campfire at Haldor
  "fire_pit_hildir",       // NPC campfire at Hildir
  "BogWitch_Fire_Pit",     // NPC campfire at Bog Witch
  "Candle_resin_bogwitch", // Bog Witch decoration
  "sign_notext",           // World-placed sign variant
]);

// ── Vendor-only items: these have fake recipes in the dump but can only be bought ──
// Hildir's cosmetic armor — not craftable, only purchasable from Hildir
const VENDOR_ONLY_PREFABS = new Set([
  ...Array.from({length: 10}, (_, i) => `ArmorDress${i + 1}`),
  ...Array.from({length: 10}, (_, i) => `ArmorTunic${i + 1}`),
  ...Array.from({length: 10}, (_, i) => `HelmetHat${i + 1}`),
]);

// ── Build recipe lookup: prefab -> recipe ──
const recipeMap = {};  // item prefab -> recipe object
for (const r of recipes) {
  if (VENDOR_ONLY_PREFABS.has(r.item)) continue;  // Skip vendor-only fake recipes
  recipeMap[r.item] = r;
}
// ── Link mead final products to their base recipes ──
// Final meads (MeadBugRepellent) have no recipe; only MeadBase* items do.
// Map each final product → its base's recipe so it shows station + ingredients.
const MEAD_BASE_MAP = {};
// Fix casing mismatches between base and final mead prefabs
const MEAD_BASE_CASING_FIX = {
  "MeadLightFoot": "MeadLightfoot",  // MeadBaseLightFoot → MeadLightfoot (lowercase f)
};
for (const r of recipes) {
  if (r.item.startsWith("MeadBase")) {
    let finalId = r.item.replace("MeadBase", "Mead");
    if (MEAD_BASE_CASING_FIX[finalId]) finalId = MEAD_BASE_CASING_FIX[finalId];
    MEAD_BASE_MAP[finalId] = r;
  } else if (r.item === "BarleyWineBase") {
    MEAD_BASE_MAP["BarleyWine"] = r;
  }
}
for (const [finalId, baseRecipe] of Object.entries(MEAD_BASE_MAP)) {
  // Vestigial Recipe_PotionHealthMinor / Recipe_PotionStaminaMinor entries
  // exist on the final meads but have no craftingStation — they shadow the
  // Mead Base → Fermenter chain and leave those meads with station="".
  // Overwrite when the existing recipe is missing a station.
  const existing = recipeMap[finalId];
  if (!existing || !existing.craftingStation) {
    recipeMap[finalId] = baseRecipe;
  }
}
// ── Build creature drop lookup: item prefab -> [{creature, chance, min, max}] ──
const dropLookup = {};  // item prefab -> [{creaturePrefab, creature, chance, min, max, biome?}]
for (const cd of creatureDrops) {
  const creatureName = loc(findCreatureName(cd.creature));
  for (const d of cd.drops) {
    if (!dropLookup[d.prefab]) dropLookup[d.prefab] = [];
    dropLookup[d.prefab].push({
      creaturePrefab: cd.creature,
      creature: creatureName || cd.creature,
      chance: d.chance,
      min: d.min,
      max: d.max,
      health: cd.health,
    });
  }
}

// ── Build item biomes from creature + world drops ──
// If creatures/world sources from multiple biomes drop this item, it belongs to multiple biomes.
function getBiomesFromDrops(prefab) {
  const itemDrops = dropLookup[prefab];
  if (!itemDrops || itemDrops.length === 0) return [];
  const biomes = new Set();
  for (const d of itemDrops) {
    // World drops have .biome set directly; creature drops use guessCreatureBiome
    if (d.biome) {
      biomes.add(d.biome);
    } else if (d.creaturePrefab) {
      const b = guessCreatureBiome(d.creaturePrefab);
      if (b) biomes.add(b);
    }
  }
  return [...biomes];
}

function findCreatureName(prefab) {
  // Try common localization patterns
  const patterns = [
    `enemy_${prefab.toLowerCase()}`,
    `enemy_${prefab}`,
    prefab.toLowerCase(),
  ];
  for (const p of patterns) {
    if (localization[p]) return localization[p];
  }

  // Explicit overrides for prefabs that don't match localization keys
  const CREATURE_NAME_OVERRIDES = {
    "BogWitchKvastur": "Kvastur",
    "Charred_Archer_Fader": "Summoned Charred Marksman",
    "Charred_Melee_Dyrnwyn": "Lord Reto",
    "Charred_Melee_Fader": "Summoned Charred Warrior",
    "Draugr_Elite": "Draugr Elite",
    "Draugr_Ranged": "Draugr Archer",
    "Dverger": "Dvergr Rogue",
    "DvergerAshlands": "Dvergr Rogue",
    "DvergerMage": "Dvergr Mage",
    "DvergerMageFire": "Dvergr Mage",
    "DvergerMageIce": "Dvergr Mage",
    "DvergerMageSupport": "Dvergr Mage",
    "Fenring_Cultist": "Cultist",
    "Fenring_Cultist_Hildir": "Geirrhafa",
    "gd_king": "The Elder",

    "GoblinArcher": "Fuling Archer",
    "GoblinBruteBros": "Zil & Thungr",
    "GoblinShaman_Hildir": "Goblin Shaman",
    "Greydwarf_Elite": "Greydwarf Brute",
    "Greydwarf_Shaman": "Greydwarf Shaman",
    "Hatchling": "Drake",
    "Hive": "The Hive",
    "TheHive": "The Hive",
    "Leech_cave": "Cave Leech",
    "SeekerBrood": "Seeker Brood",
    "Skeleton_Hildir": "Brenna",
    "Skeleton_Poison": "Rancid Remains",
    "Skeleton_NoArcher": "Skeleton",
  };
  if (CREATURE_NAME_OVERRIDES[prefab]) return CREATURE_NAME_OVERRIDES[prefab];

  // Clean up the prefab name as fallback
  return prefab
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

// ── Map game ItemType to our ItemType ──
function mapItemType(gameType, prefab, shared) {
  // Special cases
  if (prefab === "FishingRod") return "Tool";
  if ((prefab.startsWith("Feast") && prefab !== "Feaster") || prefab === "MeatPlatter") return "Food";

  // Drinking items — not weapons, decorative/celebratory
  if (prefab === "Tankard" || prefab === "TankardAnniversary" || prefab === "TankardOdin") return "Misc";

  // Hildir cosmetic clothing + Midsummer Crown — appearance only, no armour stats
  if (/^ArmorDress\d+$/.test(prefab) || /^ArmorTunic\d+$/.test(prefab) ||
      /^HelmetHat\d+$/.test(prefab) || prefab === "HelmetMidsummerCrown") return "Clothing";
  
  switch (gameType) {
    case "Material": return "Material";
    case "Consumable":
      if (shared.food > 0) return "Food";
      if (shared.name && (shared.name.includes("mead") || shared.name.includes("Mead"))) return "Potion";
      const resolvedName = loc(shared.name).toLowerCase();
      if (resolvedName.includes("mead") || resolvedName.includes("potion") || resolvedName.includes("barley wine")) return "Potion";
      if (shared.food > 0 || shared.foodStamina > 0 || shared.foodEitr > 0) return "Food";
      return "Food"; // Most consumables are food
    case "OneHandedWeapon":
    case "TwoHandedWeapon":
    case "TwoHandedWeaponLeft":
    case "Bow": return "Weapon";
    case "Shield": return "Armor";
    case "Helmet":
    case "Chest":
    case "Legs":
    case "Shoulder":
    case "Utility":
    case "Trinket": return "Armor";
    case "Ammo":
    case "AmmoNonEquipable": return "Ammo";
    case "Torch": return "Tool";
    case "Tool": return "Tool";
    case "Trophy": return "Misc";
    case "Customization": return "Misc";
    case "Misc": return "Misc";
    case "Fish": return "Material"; // Fish are materials (can be cooked)
    default: return "Misc";
  }
}

// ── Subcategory overrides (prefab → subcategory) ──
const SUBCATEGORY_OVERRIDE = {
  Acorn:               "Seed",
  TrophyDeer:          "Boss Caller",
  AncientSeed:         "Boss Caller",
  WitheredBone:        "Boss Caller",
  DragonEgg:           "Boss Caller",
  GoblinTotem:         "Boss Caller",
  DvergrKey:           "Boss Caller",
  DvergrKeyFragment:   "Boss Caller",
  Bell:                "Boss Caller",
  BellFragment:        "Boss Caller",
};

// ── Map game ItemType to subcategory ──
function mapSubcategory(gameType, prefab, shared) {
  if (SUBCATEGORY_OVERRIDE[prefab]) return SUBCATEGORY_OVERRIDE[prefab];

  // Special cases
  if (prefab === "FishingRod") return "Fishing Rod";
  if ((prefab.startsWith("Feast") && prefab !== "Feaster") || prefab === "MeatPlatter") return "Feast";

  // Drinking items — decorative
  if (prefab === "Tankard" || prefab === "TankardAnniversary" || prefab === "TankardOdin") return "Misc";

  // Hildir cosmetic clothing + Midsummer Crown
  if (/^ArmorDress\d+$/.test(prefab) || /^ArmorTunic\d+$/.test(prefab)) return "Dress";
  if (/^HelmetHat\d+$/.test(prefab)) return "Hat";
  if (prefab === "HelmetMidsummerCrown") return "Crown";
  
  const skill = shared.skillType;
  
  switch (gameType) {
    case "OneHandedWeapon":
    case "TwoHandedWeapon":
    case "TwoHandedWeaponLeft":
      if (skill === "Swords") return "Sword";
      if (skill === "Axes") return "Axe";
      if (skill === "Clubs") return "Mace";
      if (skill === "Polearms") return "Polearm";
      if (skill === "Spears") return "Spear";
      if (skill === "Knives") return "Knife";
      if (skill === "Unarmed") return "Fist";
      if (skill === "Crossbows") return "Crossbow";
      if (skill === "ElementalMagic") return "Staff";
      if (skill === "BloodMagic") return "Staff";
      if (skill === "WoodCutting") return "Axe";
      if (skill === "Pickaxes") return "Pickaxe";
      return "Weapon";
    case "Bow": return "Bow";
    case "Shield": return "Shield";
    case "Helmet": return "Helmet";
    case "Chest": return "Chest";
    case "Legs": return "Legs";
    case "Shoulder": return "Cape";
    case "Utility": return "Utility";
    case "Trinket": return "Trinket";
    case "Ammo":
    case "AmmoNonEquipable":
      if (shared.ammoType === "$ammo_arrows" || prefab.startsWith("Arrow")) return "Arrow";
      if (shared.ammoType === "$ammo_bolts" || prefab.startsWith("Bolt")) return "Bolt";
      if (prefab.includes("Bomb") || prefab.includes("bomb")) return "Bomb";
      if (prefab.includes("Missile")) return "Missile";
      return "Ammo";
    case "Material":
      if (prefab.includes("Ore") || prefab.includes("Scrap")) return "Ore";
      if (prefab.includes("Ingot") || prefab === "Copper" || prefab === "Tin" || prefab === "Bronze" || prefab === "Iron" || prefab === "Silver" || prefab === "BlackMetal" || prefab === "FlametalNew") return "Ingot";
      if (prefab.includes("Trophy")) return "Trophy";
      if (prefab.includes("Wood") || prefab === "RoundLog" || prefab === "FineWood" || prefab === "ElderBark" || prefab === "YggdrasilWood") return "Wood";
      if (prefab.includes("Hide") || prefab.includes("Leather") || prefab.includes("Pelt") || prefab.includes("Scale")) return "Hide";
      if (prefab.includes("Seed")) return "Seed";
      if (prefab.includes("Gem") || prefab.includes("Ruby") || prefab.includes("Amber") || prefab.includes("Pearl")) return "Gem";
      return "Material";
    case "Consumable":
      if (shared.food > 0) return "Food";
      return "Consumable";
    case "Fish": return "Fish";
    case "Trophy": return "Trophy";
    case "Torch": return "Torch";
    case "Tool":
      if (skill === "Pickaxes") return "Pickaxe";
      if (skill === "WoodCutting") return "Axe";
      return "Tool";
    case "Customization": return "Customization";
    case "Misc": return "Misc";
    default: return gameType;
  }
}

// ── Compute biome from highest-tier ingredient + crafting station ──
// Each item's biome = the highest biome tier among its ingredients and station.
// For raw materials, we define their "first found" biome explicitly.
// For crafted items, we recurse into their ingredients.

const BIOME_PROGRESSION = [
  "Meadows", "Black Forest", "Ocean", "Swamp", "Mountain", "Plains", "Mistlands", "Ashlands", "Deep North",
];
const BIOME_TIER = {};
BIOME_PROGRESSION.forEach((b, i) => BIOME_TIER[b] = i);

// Crafting station → minimum biome tier to access it
const STATION_BIOME = {
  "$piece_workbench": "Meadows",
  "$piece_cauldron": "Black Forest",       // 10 Tin (BF), built at Forge
  "$piece_meadcauldron": "Black Forest",   // 4 Tin + 6 Copper (BF), built at Forge
  "$piece_preptable": "Swamp",             // 5 Iron (Swamp), built at Workbench
  "$piece_forge": "Black Forest",
  "$piece_stonecutter": "Swamp",           // 2 Iron (Swamp), built at Workbench
  "$piece_artisanstation": "Mountain",     // 2 DragonTear (Mountain), placed freely
  "$piece_blackforge": "Mistlands",
  "$piece_magetable": "Mistlands",
};

// Raw material/item → its FIRST available biome (lowest tier where you can get it)
const RAW_MATERIAL_BIOME = {
  // ─── Meadows (tier 0) ───
  "Wood": "Meadows",
  "Stone": "Meadows",
  "Resin": "Meadows",
  "Flint": "Meadows",
  "LeatherScraps": "Meadows",
  "DeerHide": "Meadows",
  "RawMeat": "Meadows",
  "BoarMeat": "Meadows",
  "NeckTail": "Meadows",
  "Feathers": "Meadows",
  "Dandelion": "Meadows",
  "Mushroom": "Meadows",
  "Raspberry": "Meadows",
  "Honey": "Meadows",
  "QueenBee": "Meadows",
  "Acorn": "Meadows",
  "BeechSeeds": "Meadows",
  "HardAntler": "Meadows",
  "Coal": "Meadows",
  "ChickenEgg": "Plains",
  "ChickenMeat": "Plains",
  // Cooked meats used as recipe ingredients (tier = source creature biome)
  "CookedMeat": "Meadows",
  "CookedDeerMeat": "Meadows",
  "FishCooked": "Meadows",

  // ─── Black Forest (tier 1) ───
  "RoundLog": "Black Forest",
  "FineWood": "Black Forest",
  "Copper": "Black Forest",
  "CopperOre": "Black Forest",
  "Tin": "Black Forest",
  "TinOre": "Black Forest",
  "Bronze": "Black Forest",
  "GreydwarfEye": "Black Forest",
  "BoneFragments": "Black Forest",
  "TrollHide": "Black Forest",
  "Blueberries": "Black Forest",
  "MushroomBlue": "Black Forest",
  "Thistle": "Black Forest",
  "CarrotSeeds": "Black Forest",
  "Carrot": "Black Forest",
  "PineCone": "Black Forest",
  "FirCone": "Black Forest",
  "SurtlingCore": "Black Forest",
  "ElderBark": "Black Forest",
  "YmirRemains": "Black Forest",
  "CryptKey": "Black Forest",
  "FishingRod": "Black Forest",           // Haldor vendor (BF)
  "FishingBait": "Black Forest",          // Haldor vendor (BF)
  "BarrelRings": "Black Forest",          // Haldor vendor (BF)
  "HelmetDverger": "Black Forest",        // Haldor vendor (BF)
  "BeltStrength": "Black Forest",         // Haldor vendor (BF)
  "HelmetSweatBand": "Meadows",           // Hildir vendor (Meadows)
  "Thunderstone": "Black Forest",         // Haldor vendor (BF) — after Elder
  "AncientSeed": "Black Forest",
  "BarberKit": "Meadows",                 // Hildir vendor (Meadows)
  "FireworksRocket_White": "Meadows",     // Hildir vendor (Meadows) — after Bronze Chest
  "CandleWick": "Swamp",                  // Bog Witch vendor (Swamp) — moved in Bog Witch update
  "Ironpit": "Meadows",                   // Hildir vendor (Meadows) — also decorative in Ashlands
  // Amber, AmberPearl, Ruby, SilverNecklace, Coins moved to BIOME_OVERRIDE (multi-biome loot)
  "BirchSeeds": "Meadows",

  // ─── Ocean (tier 2) ───
  "Chitin": "Ocean",
  "FreshSeaweed": "Ocean",
  "SpiceOceans": "Ocean",
  "SerpentMeat": "Ocean",
  "SerpentScale": "Ocean",
  "SerpentMeatCooked": "Ocean",

  // ─── Swamp (tier 3) ───
  "Iron": "Swamp",
  "IronScrap": "Swamp",
  "Guck": "Swamp",
  "Bloodbag": "Swamp",
  "TurnipSeeds": "Swamp",
  "Turnip": "Swamp",
  "Entrails": "Swamp",
  "Ooze": "Swamp",
  "MushroomBzerker": "Swamp",
  "Root": "Swamp",
  "ElderBark": "Swamp",
  "BlobVial": "Swamp",  // Bog Witch vendor — blob bomb ingredient

  // ─── Mountain (tier 4) ───
  "Silver": "Mountain",
  "SilverOre": "Mountain",
  "Obsidian": "Mountain",
  "WolfMeat": "Mountain",
  "WolfPelt": "Mountain",
  "WolfFang": "Mountain",
  "WolfClaw": "Mountain",
  "DragonTear": "Mountain",
  "Crystal": "Mountain",
  "FreezeGland": "Mountain",
  "OnionSeeds": "Mountain",
  "Onion": "Mountain",

  // ─── Plains (tier 5) ───
  "BlackMetal": "Plains",
  "BlackMetalScrap": "Plains",
  "Cloudberry": "Plains",
  "Barley": "Plains",
  "Flax": "Plains",
  "LinenThread": "Plains",
  "NeedleOld": "Plains",
  "LoxMeat": "Plains",
  "LoxPelt": "Plains",
  "LoxBone": "Plains",
  "Tar": "Plains",
  "BlobTar": "Plains",
  "GoblinTotem": "Plains",

  // ─── Mistlands (tier 6) ───
  "Carapace": "Mistlands",
  "Eitr": "Mistlands",
  "Sap": "Mistlands",
  "YggdrasilWood": "Mistlands",
  "MushroomJotunPuffs": "Mistlands",
  "MushroomMagecap": "Mistlands",
  "BugMeat": "Mistlands",
  "CookedBugMeat": "Mistlands",
  "RoyalJelly": "Mistlands",
  "GiantBloodSack": "Mistlands",
  "MushroomSmokePuff": "Mistlands",
  "Softtissue": "Mistlands",
  "Wisp": "Mistlands",
  "BlackMarble": "Mistlands",
  "JuteBlue": "Mistlands",
  "JuteGreen": "Mistlands",
  "JuteRed": "Mistlands",
  "HareMeat": "Mistlands",
  "ScaleHide": "Mistlands",
  "SpiceMistlands": "Mistlands",

  // ─── Ashlands (tier 7) ───
  "FlametalNew": "Ashlands",
  "Blackwood": "Ashlands",
  "SulfurStone": "Ashlands",
  "GemstoneBlue": "Ashlands",
  "GemstoneGreen": "Ashlands",
  "GemstoneRed": "Ashlands",
  "CharcoalResin": "Ashlands",
  "CeramicPlate": "Mistlands",  // Crafted from BlackMarble (Mistlands) at Artisan Station
  "VineberrySeeds": "Ashlands",
  "Fiddleheadfern": "Ashlands",
  "SpiceAshlands": "Ashlands",
  "AsksvinCarrionNeck": "Ashlands",
  "AsksvinCarrionPelvic": "Ashlands",
  "AsksvinCarrionRibcage": "Ashlands",
  "AsksvinCarrionSkull": "Ashlands",
  "AsksvinMeat": "Ashlands",
  "CookedAsksvinMeat": "Ashlands",
  // BjornMeat: drops from Bear (Black Forest) AND Vile (Plains)
  // Multi-source display handled by BIOME_OVERRIDE; RAW needs single string for tier calc
  "BjornMeat": "Black Forest",
  "VoltureMeat": "Ashlands",
  "MorgenSinew": "Ashlands",
  "VineBerry": "Ashlands",
  "Vineberry": "Ashlands",
  "Pot_Shard_Green": "Ashlands",
  "Pot_Shard_Red": "Ashlands",
  "BellFragment": "Ashlands",
  "VineGreenSeeds": "Swamp",  // Bog Witch vendor — moved from Haldor in Bog Witch update
  "Proustitite": "Ashlands",
  "Grausten": "Ashlands",
  "BoneMawSerpentMeat": "Ashlands",
  "BonemawSerpentTooth": "Ashlands",
  "CharredBone": "Ashlands",

  // ─── Deep North (tier 8) ───
  "FishingBaitDeepNorth": "Deep North",
};

// Items that should keep multi-biome or specific override lists (fish, vendor items, etc.)
const BIOME_OVERRIDE = {
  // Fish — biome is where they're caught, not crafted
  "Fish1": ["Meadows"],           // Perch
  "Fish2": ["Black Forest"],      // Pike
  "Fish3": ["Ocean"],             // Tuna
  "Fish4_cave": ["Mountain"],     // Tetra
  "Fish5": ["Black Forest"],      // Trollfish
  "Fish6": ["Swamp"],             // Giant Herring
  "Fish7": ["Plains"],             // Grouper
  "Fish8": ["Ocean"],             // Coral Cod
  "Fish9": ["Mistlands"],         // Anglerfish
  "Fish10": ["Deep North"],       // Northern Salmon
  "Fish11": ["Ashlands"],         // Magmafish
  "Fish12": ["Mistlands"],          // Pufferfish — caught offshore Mistlands
  "FishRaw": ["Meadows"],
  "FishAnglerRaw": ["Mistlands"],
  // Cooked meats — biome from the raw meat source, not the cooking recipe
  "CookedMeat": ["Meadows"],
  "NeckTailGrilled": ["Meadows"],
  "CookedChickenMeat": ["Plains"],
  "CookedEgg": ["Plains"],
  "FishCooked": ["Meadows"],
  "CookedDeerMeat": ["Meadows"],
  "CookedWolfMeat": ["Mountain"],
  "CookedLoxMeat": ["Plains"],
  "CookedBugMeat": ["Mistlands"],
  "CookedHareMeat": ["Mistlands"],
  "CookedBjornMeat": ["Black Forest", "Plains"],
  "BjornMeat": ["Black Forest", "Plains"],        // Rule 8: multi-source display (RAW has "BF" for tier calc)
  "CookedAsksvinMeat": ["Ashlands"],
  "CookedVoltureMeat": ["Ashlands"],
  "CookedBoneMawSerpentMeat": ["Ashlands"],
  // Meads — biome = max(vendor_gate, max(ingredient_tiers))
  // Bog Witch meads have Swamp (tier 3) as minimum since recipe is purchased from Bog Witch
  // Regular meads use max ingredient tier only
  // ── Regular Cauldron meads ──
  "MeadHealthMinor": ["Black Forest"],    // Blueberries=BF
  "MeadStaminaMinor": ["Black Forest"],   // YellowMush=BF
  "MeadTasty": ["Black Forest"],          // Blueberries=BF
  "MeadPoisonResist": ["Black Forest"],   // Thistle=BF (first found in BF)
  "MeadHealthMedium": ["Swamp"],          // Bloodbag=Swamp
  "MeadStaminaMedium": ["Plains"],        // Cloudberry=Plains
  "MeadFrostResist": ["Swamp"],           // Bloodbag=Swamp highest ingredient
  "MeadHealthMajor": ["Mistlands"],       // GiantBloodSack=Mistlands, RoyalJelly=Mistlands
  "MeadBugRepellent": ["Mistlands"],      // FragrantBundle=Mistlands
  "MeadEitrMinor": ["Mistlands"],         // Sap/Magecap=Mistlands
  "MeadHealthLingering": ["Ashlands"],    // Vineberry=Ashlands
  "MeadStaminaLingering": ["Mistlands"],  // Sap/JotunPuffs=Mistlands
  "MeadEitrLingering": ["Ashlands"],      // Vineberry=Ashlands
  "BarleyWine": ["Plains"],               // Barley/Cloudberry=Plains
  // ── Bog Witch meads (Swamp vendor gate, tier 3 minimum) ──
  "MeadBzerker": ["Swamp"],              // Toadstool=Swamp, BogWitch=Swamp
  "MeadLightfoot": ["Mistlands"],        // ScaleHide=Mistlands(6), Magecap=Mistlands(6) > Swamp(3)
  "MeadSwimmer": ["Swamp"],              // BogWitch=Swamp(3) > Seaweed=Ocean(2)
  "MeadTamer": ["Ashlands"],             // PungentPebbles=Ashlands > Swamp
  "MeadStrength": ["Mountain"],          // PowderedDragonEgg=Mountain > Swamp
  "MeadHasty": ["Mistlands"],            // CuredSquirrelHamstring=Mistlands > Swamp
  "MeadTrollPheromones": ["Swamp"],      // BogWitch=Swamp(3) > TrollHide=BF(1)
  // Regional spices
  "SpicePlains": ["Plains"],
  "SpiceMountains": ["Mountain"],
  "SpiceForests": ["Swamp"],          // Bog Witch vendor — moved from Haldor in Bog Witch update
  // Hildir quest keys
  "HildirKey_forestcrypt": ["Black Forest"],
  "HildirKey_plainsfortress": ["Plains"],
  "HildirKey_mountaincave": ["Mountain"],
  // Creatures
  "Bat": ["Mountain"],
  "Greyling": ["Meadows"],
  "SeekerBrood": ["Mistlands"],
  "BlobFrost": ["Mountain"],
  "BlobLava": ["Ashlands"],
  // Special
  "HelmetFishingHat": ["Meadows"],
  "DeerStew": ["Black Forest"],       // CookedDeerMeat=Meadows, Blueberries=BF(1), Carrot=BF(1)

  // ─── Wooden weapons (loot-only, scattered across biomes — see LOCATION_LOOT) ───
  // SwordWood is the only craftable wooden weapon (Workbench, Black Forest tier — keeps default).
  // The other 8 are world-loot only; recipes exist for repair but biomes come from POI placement per wiki.
  "AxeWood":       ["Meadows"],
  "KnifeWood":     ["Meadows"],
  "MaceWood":      ["Meadows"],
  "SpearWood":     ["Black Forest", "Swamp"],
  "SledgeWood":    ["Swamp"],
  "BattleaxeWood": ["Mountain"],
  "AtgeirWood":    ["Plains"],
  "THSwordWood":   ["Mistlands"],

  // ─── Multi-biome loot (found in chests/dungeons across many biomes) ───
  "Amber": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"],
  "AmberPearl": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"],
  "Ruby": ["Black Forest", "Swamp", "Mountain", "Plains", "Mistlands"],
  "SilverNecklace": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"],
  "Coins": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains", "Mistlands", "Ashlands"],

  // ─── Vendor-only items (biome = vendor location) ───
  // Hildir — Meadows
  ...Object.fromEntries([
    ...Array.from({length: 10}, (_, i) => [`ArmorDress${i + 1}`, ["Meadows"]]),
    ...Array.from({length: 10}, (_, i) => [`ArmorTunic${i + 1}`, ["Meadows"]]),
    ...Array.from({length: 10}, (_, i) => [`HelmetHat${i + 1}`, ["Meadows"]]),
  ]),

  // ─── Cooked/processed foods (no recipe, source=Pickup from cooking station) ───
  // Biome = max(ingredient_tiers) of the uncooked recipe
  "Sausages": ["Swamp"],             // Entrails=Swamp(3), BoarMeat=Meadows — found pre-made in Mistlands chests but craftable from Swamp
  "Bread": ["Plains"],               // BarleyFlour=Plains(5)
  "SerpentMeatCooked": ["Ocean"],     // SerpentMeat=Ocean(2)
  "HoneyGlazedChicken": ["Mistlands"],// ChickenMeat=Plains, Honey=Meadows, JotunPuffs=Mistlands(6)
  "MeatPlatter": ["Mistlands"],       // BugMeat=Mistlands(6), LoxMeat=Plains, HareMeat=Mistlands
  "FishAndBread": ["Mistlands"],      // Fish9(Anglerfish)=Mistlands(6), BreadDough=Plains
  "MisthareSupreme": ["Mistlands"],   // HareMeat=Mistlands(6), JotunPuffs=Mistlands, Carrot=BF
  "MagicallyStuffedShroom": ["Mistlands"], // Magecap=Mistlands(6), GiantBloodSack=Mistlands, Turnip=Swamp
  "PiquantPie": ["Ashlands"],         // Vineberry=Ashlands(7), AsksvinMeat=Ashlands, BarleyFlour=Plains
  "RoastedCrustPie": ["Ashlands"],    // Vineberry=Ashlands(7), VoltureEgg=Ashlands, BarleyFlour=Plains
  "VikingCupcake": ["Plains"],        // Cloudberry=Plains(5), ChickenEgg=Plains, BarleyFlour=Plains, Honey=Meadows
  "LoxPie": ["Plains"],               // Cloudberry=Plains(5), LoxMeat=Plains, BarleyFlour=Plains

  // ─── Feast table items (biome in the name) ───
  "FeastMeadows": ["Meadows"],
  "FeastBlackforest": ["Black Forest"],
  "FeastSwamps": ["Swamp"],
  "FeastMountains": ["Mountain"],
  "FeastOceans": ["Ocean"],
  "FeastPlains": ["Plains"],
  "FeastMistlands": ["Mistlands"],
  "FeastAshlands": ["Ashlands"],

  // ─── Mushrooms & foraged items (multi-biome foraging) ───
  "MushroomYellow": ["Black Forest", "Swamp"],
  "MushroomBzerker": ["Swamp"],
  "MushroomSmokePuff": ["Mistlands"],
  "Carrot": ["Black Forest"],
  "Turnip": ["Swamp"],
  "Onion": ["Mountain"],
  "BarleyFlour": ["Plains"],

  // ─── Ores & mining materials ───
  "IronOre": ["Swamp"],
  "FlametalOreNew": ["Ashlands"],
  "CopperScrap": ["Black Forest", "Mistlands"],  // BF copper deposits + Mistlands ancient armor/sword mounds
  "BronzeScrap": ["Ashlands"],
  "Bronze": ["Black Forest", "Mountain", "Ashlands"],
  "BlackCore": ["Mistlands"],
  "MoltenCore": ["Ashlands"],

  // ─── Multi-biome foraged/dropped materials ───
  "SurtlingCore": ["Black Forest", "Swamp"],
  "BoneFragments": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains", "Ashlands"],
  "Thistle": ["Black Forest", "Swamp"],
  "Acorn": ["Meadows"],
  "SerpentMeat": ["Ocean"],
  "SerpentScale": ["Ocean"],

  // ─── Multi-biome tree/rock/forage materials ───
  "Wood": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"],
  "FineWood": ["Meadows", "Plains"],
  "RoundLog": ["Meadows", "Black Forest", "Mountain", "Plains"],
  "Stone": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains", "Ashlands"],
  "DeerHide": ["Meadows", "Black Forest", "Plains"],
  "Flint": ["Meadows", "Black Forest"],
  "Resin": ["Meadows", "Black Forest"],
  "Mushroom": ["Meadows", "Black Forest"],
  "Feathers": ["Meadows", "Black Forest", "Mountain", "Plains", "Ashlands"],
  "Coal": ["Meadows", "Black Forest", "Swamp"],
  "LeatherScraps": ["Meadows", "Black Forest", "Swamp", "Mountain"],  // +Swamp (Sunken Crypts), +Mountain (Bat drops)
  "BirchSeeds": ["Meadows", "Plains"],
  "PineCone": ["Black Forest"],
  "IronScrap": ["Swamp", "Mountain", "Mistlands"],  // +Mistlands (Ancient Armor/Sword mounds)

  // ─── Swamp materials ───
  "WitheredBone": ["Swamp"],

  // ─── Mountain materials ───
  "DragonEgg": ["Mountain"],
  "WolfHairBundle": ["Mountain"],
  "PowderedDragonEgg": ["Mountain"],

  // ─── Mistlands materials ───
  "DvergrKeyFragment": ["Mistlands"],
  "DvergrNeedle": ["Mistlands"],
  "CuredSquirrelHamstring": ["Mistlands"],
  "ScytheHandle": ["Mistlands"],
  "DyrnwynBladeFragment": ["Mistlands"],
  "DyrnwynTipFragment": ["Mistlands"],
  "FragrantBundle": ["Mistlands"],

  // ─── Ashlands materials ───
  "CharredCogwheel": ["Ashlands"],
  "Charredskull": ["Ashlands"],
  "AsksvinEgg": ["Ashlands"],
  "PungentPebbles": ["Ashlands"],

  // ─── Vendor items (biome of the vendor) ───
  "CandleWick": ["Swamp"],                // Bog Witch vendor (moved from Haldor)
  "BlobVial": ["Swamp"],                  // Bog Witch vendor
  "FireworksRocket_White": ["Meadows"],   // Hildir vendor (after Bronze Chest)
  "Ironpit": ["Meadows"],                 // Hildir vendor (also decorative in Ashlands)
  "VineGreenSeeds": ["Swamp"],            // Bog Witch vendor (Ivy Seeds — moved from Haldor)
  "BarberKit": ["Meadows"],               // Hildir vendor
  "HelmetSweatBand": ["Meadows"],         // Hildir vendor (Headband)
  "TankardOdin": [],                      // DLC-only beta supporter item — no biome
  "AxeHead1": ["Meadows"],                // Found in Abandoned House ruins (variant 6) in Meadows

  // ─── Trophies (biome of the creature) ───
  "TrophyDraugr": ["Meadows", "Swamp", "Mountain"],
  "TrophyDraugrFem": ["Meadows", "Swamp", "Mountain"],
  "TrophyDraugrElite": ["Meadows", "Swamp", "Mountain"],
  "TrophySkeleton": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"],  // +Plains (post-Bonemass night spawns)
  "TrophySkeletonPoison": ["Black Forest"],
  "TrophyDeer": ["Meadows", "Black Forest"],
  "TrophySeekerQueen": ["Mistlands"],
  "TrophyHatchling": ["Mountain"],
  "TrophyTheElder": ["Black Forest"],
  "TrophyKvastur": ["Swamp"],

  // ─── Creatures missing biomes ───
  "Deer": ["Meadows", "Black Forest"],
  "Draugr": ["Meadows", "Swamp", "Mountain"],
  "Draugr_Ranged": ["Meadows", "Swamp", "Mountain"],
  "Draugr_Elite": ["Meadows", "Swamp", "Mountain"],
  "Skeleton": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"],          // +Plains (post-Bonemass night spawns)
  "Skeleton_NoArcher": ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"], // +Plains
  "Skeleton_Poison": ["Black Forest"],
  "Hatchling": ["Mountain"],
  "Hive": ["Meadows"],
  "TheHive": ["Meadows"],
  "BogWitchKvastur": ["Swamp"],

  // ─── Boss/event rewards ───
  "HealthUpgrade_Bonemass": ["Swamp"],
  "HealthUpgrade_GDKing": ["Black Forest"],
  "StaminaUpgrade_Greydwarf": ["Black Forest"],
  "StaminaUpgrade_Troll": ["Black Forest"],
  "StaminaUpgrade_Wraith": ["Swamp"],
  "VegvisirShard_Bonemass": ["Swamp"],
  // AxeHead1 moved to Vendor section above (Meadows)
  "AxeHead2": ["Swamp"],

  // ─── Miscellaneous ───
  "HelmetYule": ["Black Forest"],
  "Sparkler": ["Meadows"],

  // ─── Build pieces ───
  "blackmarble_head01": ["Mistlands"],
  "blackmarble_head02": ["Mistlands"],
  "rug_deer": ["Meadows"],
  "rug_wolf": ["Mountain"],
  "rug_fur": ["Plains"],
  "skull_pile": ["Swamp"],
  "sapling_seedcarrot": ["Black Forest"],
  "sapling_seedonion": ["Mountain"],
  "sapling_seedturnip": ["Swamp"],
};

// ── World drops: items obtained from trees, rocks, destructibles, etc. ──
// These are NOT creature drops — they come from environment objects.
// Format: { item_prefab: [{source, biome, type}] }
// Types: "Tree", "Rock", "Pickup", "Crafting", "Destructible", "Chest"
const WORLD_DROPS = {
  // ─── Trees ───
  "Wood": [
    {source: "Beech Tree", biome: "Meadows", type: "Tree"},
    {source: "Birch Tree", biome: "Meadows", type: "Tree"},
    {source: "Birch Tree", biome: "Plains", type: "Tree"},
    {source: "Oak Tree", biome: "Meadows", type: "Tree"},
    {source: "Oak Tree", biome: "Plains", type: "Tree"},
    {source: "Pine Tree", biome: "Black Forest", type: "Tree"},
    {source: "Pine Tree", biome: "Mountain", type: "Tree"},
    {source: "Fir Tree", biome: "Black Forest", type: "Tree"},
    {source: "Ancient Tree", biome: "Swamp", type: "Tree"},
  ],
  "FineWood": [
    {source: "Birch Tree", biome: "Meadows", type: "Tree"},
    {source: "Birch Tree", biome: "Plains", type: "Tree"},
    {source: "Oak Tree", biome: "Meadows", type: "Tree"},
    {source: "Oak Tree", biome: "Plains", type: "Tree"},
    {source: "Shipwreck", biome: "Ocean", type: "Destructible"},
  ],
  "RoundLog": [
    {source: "Pine Tree", biome: "Black Forest", type: "Tree"},
    {source: "Pine Tree", biome: "Mountain", type: "Tree"},
    {source: "Destroyed Structure", biome: "Meadows", type: "Destructible"},
    {source: "Destroyed Structure", biome: "Plains", type: "Destructible"},
  ],
  "ElderBark": [
    {source: "Ancient Tree", biome: "Swamp", type: "Tree"},
  ],
  "YggdrasilWood": [
    {source: "Yggdrasil Shoot", biome: "Mistlands", type: "Tree"},
  ],
  "Blackwood": [
    {source: "Blackwood Tree", biome: "Ashlands", type: "Tree"},
  ],
  "Resin": [
    {source: "Beech Tree", biome: "Meadows", type: "Tree"},
    {source: "Fir Tree", biome: "Black Forest", type: "Tree"},
  ],
  // ─── Seeds from trees ───
  "BeechSeeds": [
    {source: "Beech Tree", biome: "Meadows", type: "Tree"},
  ],
  "BirchSeeds": [
    {source: "Birch Tree", biome: "Meadows", type: "Tree"},
    {source: "Birch Tree", biome: "Plains", type: "Tree"},
  ],
  "PineCone": [
    {source: "Pine Tree", biome: "Black Forest", type: "Tree"},
  ],
  "FirCone": [
    {source: "Fir Tree", biome: "Black Forest", type: "Tree"},
  ],
  "Acorn": [
    {source: "Oak Tree", biome: "Meadows", type: "Tree"},
  ],
  // ─── Rocks & mining ───
  "Stone": [
    {source: "Rock", biome: "Meadows", type: "Rock"},
    {source: "Rock", biome: "Black Forest", type: "Rock"},
    {source: "Rock", biome: "Swamp", type: "Rock"},
    {source: "Rock", biome: "Mountain", type: "Rock"},
    {source: "Rock", biome: "Plains", type: "Rock"},
    {source: "Rock", biome: "Mistlands", type: "Rock"},
    {source: "Rock", biome: "Ashlands", type: "Rock"},
    {source: "Copper Deposit", biome: "Black Forest", type: "Rock"},
    {source: "Silver Vein", biome: "Mountain", type: "Rock"},
  ],
  "Flint": [
    {source: "Flint Node", biome: "Meadows", type: "Rock"},
    {source: "Flint Node", biome: "Black Forest", type: "Rock"},
  ],
  "CopperOre": [
    {source: "Copper Deposit", biome: "Black Forest", type: "Rock"},
  ],
  "TinOre": [
    {source: "Tin Deposit", biome: "Black Forest", type: "Rock"},
  ],
  "IronScrap": [
    {source: "Muddy Scrap Pile", biome: "Swamp", type: "Rock"},
    {source: "Frozen Body", biome: "Mountain", type: "Destructible"},
  ],
  "SilverOre": [
    {source: "Silver Vein", biome: "Mountain", type: "Rock"},
  ],
  "Obsidian": [
    {source: "Obsidian Deposit", biome: "Mountain", type: "Rock"},
  ],
  "FlametalOre": [
    {source: "Flametal Deposit", biome: "Ashlands", type: "Rock"},
  ],
  "FlametalOreNew": [
    {source: "Flametal Deposit", biome: "Ashlands", type: "Rock"},
  ],
  "Crystal": [
    {source: "Crystal Formation", biome: "Mountain", type: "Rock"},
  ],
  "Chitin": [
    {source: "Leviathan", biome: "Ocean", type: "Rock"},
  ],
  "Grausten": [
    {source: "Rock", biome: "Ashlands", type: "Rock"},
  ],
  "BlackMarble": [
    {source: "Rock", biome: "Mistlands", type: "Rock"},
  ],
  "WitheredBone": [
    {source: "Muddy Scrap Pile", biome: "Swamp", type: "Rock"},
  ],
  // ─── Forageables & ground pickups ───
  "Mushroom": [
    {source: "Ground Spawn", biome: "Meadows", type: "Pickup"},
    {source: "Ground Spawn", biome: "Black Forest", type: "Pickup"},
  ],
  "MushroomYellow": [
    {source: "Ground Spawn", biome: "Black Forest", type: "Pickup"},
    {source: "Ground Spawn", biome: "Plains", type: "Pickup"},
  ],
  "MushroomBlue": [
    {source: "Dungeon Floor", biome: "Black Forest", type: "Pickup"},
    {source: "Dungeon Floor", biome: "Swamp", type: "Pickup"},
    {source: "Dungeon Floor", biome: "Mountain", type: "Pickup"},
  ],
  "MushroomJotunPuffs": [
    {source: "Ground Spawn", biome: "Mistlands", type: "Pickup"},
  ],
  "MushroomMagecap": [
    {source: "Ground Spawn", biome: "Mistlands", type: "Pickup"},
  ],
  "MushroomSmokePuff": [
    {source: "Ground Spawn", biome: "Mistlands", type: "Pickup"},
  ],
  "Thistle": [
    {source: "Ground Spawn", biome: "Black Forest", type: "Pickup"},
    {source: "Ground Spawn", biome: "Swamp", type: "Pickup"},
  ],
  "Dandelion": [
    {source: "Ground Spawn", biome: "Meadows", type: "Pickup"},
  ],
  "Raspberry": [
    {source: "Raspberry Bush", biome: "Meadows", type: "Pickup"},
  ],
  "Blueberries": [
    {source: "Blueberry Bush", biome: "Black Forest", type: "Pickup"},
  ],
  "Cloudberry": [
    {source: "Cloudberry Bush", biome: "Plains", type: "Pickup"},
  ],
  "Barley": [
    {source: "Fuling Farm", biome: "Plains", type: "Pickup"},
  ],
  "Flax": [
    {source: "Fuling Farm", biome: "Plains", type: "Pickup"},
  ],
  "CarrotSeeds": [
    {source: "Ground Spawn", biome: "Black Forest", type: "Pickup"},
  ],
  "TurnipSeeds": [
    {source: "Ground Spawn", biome: "Swamp", type: "Pickup"},
  ],
  "Vineberry": [
    {source: "Ground Spawn", biome: "Ashlands", type: "Pickup"},
  ],
  "Fiddleheadfern": [
    {source: "Ground Spawn", biome: "Ashlands", type: "Pickup"},
  ],
  "Sap": [
    {source: "Yggdrasil Root", biome: "Mistlands", type: "Pickup"},
  ],
  "Guck": [
    {source: "Guck Sack", biome: "Swamp", type: "Pickup"},
  ],
  "Tar": [
    {source: "Tar Pit", biome: "Plains", type: "Pickup"},
  ],
  "DragonEgg": [
    {source: "Mountain Nest", biome: "Mountain", type: "Pickup"},
  ],
  "Wisp": [
    {source: "Night Spawn", biome: "Mistlands", type: "Pickup"},
  ],
  "FreshSeaweed": [
    {source: "Shoreline", biome: "Ocean", type: "Pickup"},
    {source: "Shoreline", biome: "Meadows", type: "Pickup"},
  ],
  "Turnip": [
    {source: "Farming", biome: "Swamp", type: "Pickup"},
  ],
  "Carrot": [
    {source: "Farming", biome: "Black Forest", type: "Pickup"},
  ],
  "Onion": [
    {source: "Farming", biome: "Mountain", type: "Pickup"},
  ],
  // ─── Spices ───
  // All spices are sold by Bog Witch (after defeating the corresponding boss/serpent).
  // No world pickup source — removed obsolete "Herb Node" entries.
  "VineberrySeeds": [
    {source: "Ground Spawn", biome: "Ashlands", type: "Pickup"},
  ],
  // ─── Fish (Fishing) ───
  "Fish1": [
    {source: "Fishing", biome: "Meadows", type: "Pickup"},
    {source: "Fishing", biome: "Black Forest", type: "Pickup"},
  ],
  "Fish2": [
    {source: "Fishing", biome: "Black Forest", type: "Pickup"},
  ],
  "Fish3": [
    {source: "Fishing", biome: "Ocean", type: "Pickup"},
  ],
  // Fish worldSources — biomes match top-level fish biomes (was off-by-one shifted).
  "Fish4_cave": [
    {source: "Fishing", biome: "Mountain", type: "Pickup"},   // Tetra (Mountain caves)
  ],
  "Fish5": [
    {source: "Fishing", biome: "Black Forest", type: "Pickup"},  // Trollfish
  ],
  "Fish6": [
    {source: "Fishing", biome: "Swamp", type: "Pickup"},          // Giant Herring
  ],
  "Fish7": [
    {source: "Fishing", biome: "Plains", type: "Pickup"},         // Grouper
  ],
  "Fish8": [
    {source: "Fishing", biome: "Ocean", type: "Pickup"},          // Coral Cod
  ],
  "Fish9": [
    {source: "Fishing", biome: "Mistlands", type: "Pickup"},      // Anglerfish
  ],
  "Fish10": [
    {source: "Fishing", biome: "Deep North", type: "Pickup"},     // Northern Salmon
  ],
  "Fish11": [
    {source: "Fishing", biome: "Ashlands", type: "Pickup"},       // Magmafish
  ],
  "Fish12": [
    {source: "Fishing", biome: "Mistlands", type: "Pickup"},      // Pufferfish (Mistlands offshore)
  ],
  "FishAnglerRaw": [
    {source: "Fishing", biome: "Mistlands", type: "Pickup"},
  ],
  // ─── Destructibles & special ───
  "Feathers": [
    {source: "Birds", biome: "Meadows", type: "Destructible"},
    {source: "Birds", biome: "Black Forest", type: "Destructible"},
    {source: "Birds", biome: "Mountain", type: "Destructible"},
    {source: "Birds", biome: "Plains", type: "Destructible"},
    {source: "Birds", biome: "Ashlands", type: "Destructible"},
  ],
  "Honey": [
    {source: "Beehive", biome: "Meadows", type: "Destructible"},
    {source: "Beehive", biome: "Black Forest", type: "Destructible"},
  ],
  "QueenBee": [
    {source: "Beehive", biome: "Meadows", type: "Destructible"},
    {source: "Beehive", biome: "Black Forest", type: "Destructible"},
  ],
  "Coal": [
    {source: "Charcoal Kiln", biome: "Meadows", type: "Crafting"},
    {source: "Smelter Byproduct", biome: "Meadows", type: "Crafting"},
    {source: "Dungeon Barrel", biome: "Black Forest", type: "Destructible"},
  ],
  "LeatherScraps": [
    {source: "Shipwreck", biome: "Ocean", type: "Destructible"},
    {source: "Dungeon Furniture", biome: "Black Forest", type: "Destructible"},
  ],
  "SurtlingCore": [
    {source: "Burial Chamber Pylon", biome: "Black Forest", type: "Destructible"},
    {source: "Fire Geyser", biome: "Swamp", type: "Destructible"},
  ],
  "DeerHide": [
    {source: "Destroyed Structure", biome: "Plains", type: "Destructible"},
  ],
  "BoneFragments": [
    {source: "Bone Pile", biome: "Meadows", type: "Destructible"},
    {source: "Bone Pile", biome: "Black Forest", type: "Destructible"},
    {source: "Bone Pile", biome: "Swamp", type: "Destructible"},
    {source: "Bone Pile", biome: "Mountain", type: "Destructible"},
    {source: "Bone Pile", biome: "Plains", type: "Destructible"},
    {source: "Bone Pile", biome: "Ashlands", type: "Destructible"},
  ],
  // Dvergr Lantern — pickable from Dvergr settlements/towers/outposts/tunnels in Mistlands.
  "Lantern": [
    {source: "Dvergr Structure", biome: "Mistlands", type: "Pickup"},
  ],
};

// ── Chest Loot Tables ──
// Maps chest type → { biome, items[] }. Auto-injected into WORLD_DROPS below.
// Maintained manually — game dump does not include Container loot tables.
const CHEST_LOOT = {
  "Meadows Chest": {
    biome: "Meadows",
    // Verified: Meadows treasure chests / viking graveyard / abandoned house ruins
    items: ["Coins", "Amber", "AmberPearl", "Ruby", "SilverNecklace", "Feathers", "Flint", "ArrowFlint", "ArrowFire", "Torch"],
  },
  "Burial Chamber Chest": {
    biome: "Black Forest",
    // Verified: Burial Chamber chests. LeatherScraps removed (not confirmed - confused with Troll Cave / floor loot).
    items: ["Coins", "Amber", "AmberPearl", "Ruby", "SurtlingCore", "BoneFragments",
            "Feathers", "ArrowFlint", "ArrowFire"],
  },
  "Troll Cave Chest": {
    biome: "Black Forest",
    // Verified: Troll Cave chests. TrollHide removed (mob drop only). Amber/AmberPearl reported by guides.
    items: ["Coins", "Amber", "AmberPearl", "Ruby", "BoneFragments", "DeerHide", "LeatherScraps"],
  },
  "Sunken Crypt Chest": {
    biome: "Swamp",
    // Verified: Sunken Crypt chests. Feathers removed (not confirmed). Added Entrails, Ooze, ArrowIron (Ironhead).
    items: ["Coins", "Amber", "AmberPearl", "Ruby", "IronScrap", "Chain",
            "WitheredBone", "ElderBark", "Entrails", "Ooze", "ArrowPoison", "ArrowIron"],
  },
  "Frost Cave Chest": {
    biome: "Mountain",
    // Verified: Frost Cave chests contain coins, valuables, obsidian. Fenris Hair/Claw, Frost Arrows, OnionSeeds REMOVED.
    // (Fenris Hair/Claw drop from altars/wall hangings inside caves, not chests. Onion Seeds are in surface ruined towers.)
    items: ["Coins", "Obsidian", "Ruby", "SilverNecklace"],
  },
  "Fuling Village Chest": {
    biome: "Plains",
    items: ["Coins", "BlackMetalScrap", "Barley", "Flax", "Needle", "GoblinTotem"],
  },
  "Dvergr Chest": {
    biome: "Mistlands",
    // Verified: Infested Mine treasure-room chests contain coins, sausages, minor meads, jute, soft tissue.
    // BlackCore REMOVED (found on stands/poles in mines, not chests).
    // DvergrNeedle REMOVED (only from Dvergr Component Crates in surface settlements).
    items: ["Coins", "Softtissue", "JuteRed", "Sausages", "MeadHealthMinor", "MeadStaminaMinor", "MeadTasty"],
  },
  "Charred Fortress Chest": {
    biome: "Ashlands",
    items: ["Coins", "FlametalNew", "GemstoneBlue", "GemstoneGreen", "GemstoneRed",
            "CeramicPlate", "BronzeScrap", "CharredBone", "CharredCogwheel", "MoltenCore",
            "Charredskull", "CelestialFeather"],
  },
};

// Auto-generate WORLD_DROPS entries from CHEST_LOOT
for (const [chestName, data] of Object.entries(CHEST_LOOT)) {
  for (const itemPrefab of data.items) {
    if (!WORLD_DROPS[itemPrefab]) WORLD_DROPS[itemPrefab] = [];
    WORLD_DROPS[itemPrefab].push({source: chestName, biome: data.biome, type: "Chest"});
  }
}

// ── Location Loot ──
// Items found inside chests at specific Points-of-Interest (POIs).
// Differs from CHEST_LOOT: the source is the POI/location name, not a generic chest type.
// Used for one-off placed items (e.g. wooden weapons in Combat Ruins, Viking Graveyards).
// Sourced from valheim.fandom.com per-location pages.
const LOCATION_LOOT = {
  "Viking Graveyard":      { biome: "Meadows",      items: ["AxeWood", "KnifeWood"],   wikiUrl: "https://valheim.fandom.com/wiki/Viking_Graveyard" },
  "Combat Ruin":           { biome: "Meadows",      items: ["MaceWood"],               wikiUrl: "https://valheim.fandom.com/wiki/Combat_Ruin" },
  "Draugr Village":        { biome: "Meadows",      items: ["MaceWood"],               wikiUrl: "https://valheim.fandom.com/wiki/Draugr_Village" },
  "Abandoned Outpost":     { biome: "Black Forest", items: ["SpearWood"],              wikiUrl: "https://valheim.fandom.com/wiki/Abandoned_Outpost" },
  "Abandoned Hut":         { biome: "Swamp",        items: ["SpearWood"],              wikiUrl: "https://valheim.fandom.com/wiki/Abandoned_Hut" },
  "Swamp Runestone Tower": { biome: "Swamp",        items: ["SledgeWood"],             wikiUrl: "https://valheim.fandom.com/wiki/Swamp_Runestone_Tower" },
  "Swamp Grave":           { biome: "Swamp",        items: ["SledgeWood"],             wikiUrl: "https://valheim.fandom.com/wiki/Swamp_Grave" },
  "Mountain Chest":              { biome: "Mountain",  items: ["BattleaxeWood"], wikiUrl: "https://valheim.fandom.com/wiki/Loot_chest#Mountain_Chest" },
  "Plains Chest":                { biome: "Plains",    items: ["AtgeirWood"],    wikiUrl: "https://valheim.fandom.com/wiki/Loot_chest#Plains_Chest" },
  "Infested Mine Treasure Chest":{ biome: "Mistlands", items: ["THSwordWood"],   wikiUrl: "https://valheim.fandom.com/wiki/Loot_chest#Infested_Mine_Treasure_Chest" },
};

// Auto-generate WORLD_DROPS entries from LOCATION_LOOT
for (const [locationName, data] of Object.entries(LOCATION_LOOT)) {
  for (const itemPrefab of data.items) {
    if (!WORLD_DROPS[itemPrefab]) WORLD_DROPS[itemPrefab] = [];
    WORLD_DROPS[itemPrefab].push({source: locationName, biome: data.biome, type: "Chest"});
  }
}

// ── Spawner Drops ──
// Items dropped when creature spawners are destroyed. Manually maintained.
// See: https://valheim.fandom.com/wiki/Category:Creature_spawner
const SPAWNER_DROPS = {
  "Greydwarf Nest": {
    biome: "Black Forest",
    items: ["AncientSeed"],
  },
  "Evil Bone Pile": {
    biome: "Black Forest",
    items: ["BoneFragments"],
  },
};

// ── Creature Spawner Definitions ──
// What creatures each spawner produces + metadata for WorldObject entries.
const SPAWNER_DEFS = {
  "Greydwarf Nest": {
    prefabId: "Spawner_GreydwarfNest",
    biomes: ["Black Forest"],
    health: 100,
    wikiUrl: "https://valheim.fandom.com/wiki/Greydwarf_nest",
    creatures: [
      { id: "Greydwarf", chance: 0.72 },
      { id: "Greydwarf_Shaman", chance: 0.14 },
      { id: "Greydwarf_Elite", chance: 0.14 },
    ],
  },
  "Evil Bone Pile": {
    prefabId: "BonePileSpawner",
    biomes: ["Black Forest", "Swamp", "Mountain"],
    health: 50,
    wikiUrl: "https://valheim.fandom.com/wiki/Evil_bone_pile",
    creatures: [
      { id: "Skeleton", chance: 0.80 },
      { id: "Skeleton_NoArcher", chance: 0.20 },
    ],
  },
  "Body Pile": {
    prefabId: "Spawner_DraugrPile",
    biomes: ["Meadows", "Swamp", "Mountain"],
    health: 100,
    wikiUrl: "https://valheim.fandom.com/wiki/Body_pile",
    creatures: [
      { id: "Draugr", chance: 0.43 },
      { id: "Draugr_Ranged", chance: 0.43 },
      { id: "Draugr_Elite", chance: 0.14 },
    ],
  },
  "Monument of Torment": {
    prefabId: "CharredTwitcherSpawner",
    biomes: ["Ashlands"],
    health: 200,
    wikiUrl: "https://valheim.fandom.com/wiki/Monument_of_Torment",
    creatures: [
      { id: "Charred_Twitcher", chance: 1.0 },
    ],
  },
  "Effigy of Malice": {
    prefabId: "CharredSpawnerCross",
    biomes: ["Ashlands"],
    health: 200,
    wikiUrl: "https://valheim.fandom.com/wiki/Effigy_of_Malice",
    creatures: [
      { id: "Charred_Melee", chance: 0.50 },
      { id: "Charred_Archer", chance: 0.50 },
    ],
  },
};

// ── Loot Chest Wiki URLs ──
const CHEST_WIKI = "https://valheim.fandom.com/wiki/Loot_chest";

// Auto-generate WORLD_DROPS entries from SPAWNER_DROPS
for (const [spawnerName, data] of Object.entries(SPAWNER_DROPS)) {
  for (const itemPrefab of data.items) {
    if (!WORLD_DROPS[itemPrefab]) WORLD_DROPS[itemPrefab] = [];
    WORLD_DROPS[itemPrefab].push({source: spawnerName, biome: data.biome, type: "Spawner"});
  }
}

// ── Inject WORLD_DROPS (trees, rocks, destructibles, chests, spawners) into dropLookup ──
for (const [itemPrefab, sources] of Object.entries(WORLD_DROPS)) {
  if (!dropLookup[itemPrefab]) dropLookup[itemPrefab] = [];
  for (const wd of sources) {
    dropLookup[itemPrefab].push({
      creaturePrefab: null,       // Not a creature
      creature: wd.source,        // Display name (e.g. "Birch Tree")
      chance: 1,
      min: 1,
      max: 1,
      health: 0,
      biome: wd.biome,            // Direct biome (no guessCreatureBiome needed)
      worldDropType: wd.type,     // "Tree", "Rock", "Destructible", "Pickup"
    });
  }
}

// Cache for computed biome tiers
const _biomeTierCache = {};
const _RESOLVING = Symbol("resolving"); // cycle detection

// Get the biome tier of a single material/item by looking up RAW_MATERIAL_BIOME,
// creature drops, or recursing into its recipe ingredients.
function getItemBiomeTier(prefab) {
  if (_biomeTierCache[prefab] !== undefined) {
    return _biomeTierCache[prefab] === _RESOLVING ? -1 : _biomeTierCache[prefab];
  }

  // Mark as resolving (cycle detection)
  _biomeTierCache[prefab] = _RESOLVING;

  // 1. Check raw material map
  if (RAW_MATERIAL_BIOME[prefab]) {
    const tier = BIOME_TIER[RAW_MATERIAL_BIOME[prefab]] ?? -1;
    _biomeTierCache[prefab] = tier;
    return tier;
  }

  // 2. Check creature drops (lowest biome the creature is found in)
  const drops = getBiomesFromDrops(prefab);
  if (drops.length > 0) {
    let minTier = 999;
    for (const b of drops) {
      const t = BIOME_TIER[b] ?? 999;
      if (t < minTier) minTier = t;
    }
    if (minTier < 999) {
      _biomeTierCache[prefab] = minTier;
      return minTier;
    }
  }

  // 3. If it has a recipe, recurse: max(station_tier, max(ingredient_tiers))
  const recipe = recipeMap[prefab];
  if (recipe) {
    let maxTier = -1;

    // Station tier
    if (recipe.craftingStation && STATION_BIOME[recipe.craftingStation]) {
      const stationTier = BIOME_TIER[STATION_BIOME[recipe.craftingStation]] ?? -1;
      if (stationTier > maxTier) maxTier = stationTier;
    }

    // Ingredient tiers (only base recipe ingredients, not upgrade-only ones)
    for (const r of recipe.resources) {
      if (!r.item || r.amount === 0) continue;
      const ingTier = getItemBiomeTier(r.item);
      if (ingTier > maxTier) maxTier = ingTier;
    }

    _biomeTierCache[prefab] = maxTier;
    return maxTier;
  }

  // 4. Unknown — no biome info
  _biomeTierCache[prefab] = -1;
  return -1;
}

// Compute the biome(s) for an item for display.
// Returns a single-element array with the computed biome, or the override list.
function guessBiomes(prefab, recipePrefab) {
  // Hard overrides (fish, meads, cooked meats, etc.)
  if (BIOME_OVERRIDE[prefab]) {
    return [...BIOME_OVERRIDE[prefab]];
  }

  // Compute from recipe ingredients + station
  const tier = getItemBiomeTier(prefab);
  if (tier >= 0 && tier < BIOME_PROGRESSION.length) {
    return [BIOME_PROGRESSION[tier]];
  }

  // Fallback: creature drops
  const dropBiomes = getBiomesFromDrops(prefab);
  if (dropBiomes.length > 0) return dropBiomes;

  return [];
}

// ── Items cooked on fire/cooking station (no recipe in dump, source should be "Cooking") ──
// Basic Cooking Station handles smaller/faster-cooking meats.
// CookedEgg is NOT here — it's crafted at the Cauldron, not grilled on a rack.
const COOKING_STATION_ITEMS = new Set([
  "CookedMeat", "NeckTailGrilled", "CookedDeerMeat", "FishCooked",
  "CookedChickenMeat", "CookedWolfMeat", "CookedBjornMeat",
]);
// Iron Cooking Station adds the tougher high-tier meats the basic rack can't handle.
const IRON_COOKING_STATION_ITEMS = new Set([
  "CookedLoxMeat", "SerpentMeatCooked", "CookedBugMeat", "CookedHareMeat",
  "CookedBoneMawSerpentMeat", "CookedAsksvinMeat", "CookedVoltureMeat",
]);
// Stone Oven bakes dough/uncooked items into bread, pies and high-tier dishes.
const STONE_OVEN_ITEMS = new Set([
  "Bread", "LoxPie", "FishAndBread", "MeatPlatter", "HoneyGlazedChicken",
  "MisthareSupreme", "MagicallyStuffedShroom", "PiquantPie",
  "RoastedCrustPie", "VikingCupcake",
]);
const FIRE_COOKED_ITEMS = new Set([...COOKING_STATION_ITEMS, ...IRON_COOKING_STATION_ITEMS]);

// Raw/uncooked → cooked mappings (1:1). The game stores these as Smelter
// conversions, not standard Recipes, so the dump extractor misses them —
// we inject a synthetic single-ingredient recipe downstream so Craft
// Materials mode on the Cooking Stations + Stone Oven surfaces the inputs
// the player actually needs to gather.
const COOKING_CONVERSIONS = {
  // Cooking Station
  CookedMeat:                 "RawMeat",
  NeckTailGrilled:            "NeckTail",
  CookedDeerMeat:             "DeerMeat",
  FishCooked:                 "FishRaw",
  CookedChickenMeat:          "ChickenMeat",
  CookedWolfMeat:             "WolfMeat",
  CookedBjornMeat:            "BjornMeat",
  // Iron Cooking Station
  CookedLoxMeat:              "LoxMeat",
  SerpentMeatCooked:          "SerpentMeat",
  CookedBugMeat:              "BugMeat",
  CookedHareMeat:             "HareMeat",
  CookedBoneMawSerpentMeat:   "BoneMawSerpentMeat",
  CookedAsksvinMeat:          "AsksvinMeat",
  CookedVoltureMeat:          "VoltureMeat",
  // Stone Oven
  Bread:                      "BreadDough",
  LoxPie:                     "LoxPieUncooked",
  FishAndBread:               "FishAndBreadUncooked",
  MeatPlatter:                "MeatPlatterUncooked",
  HoneyGlazedChicken:         "HoneyGlazedChickenUncooked",
  MisthareSupreme:            "MisthareSupremeUncooked",
  MagicallyStuffedShroom:     "MagicallyStuffedShroomUncooked",
  PiquantPie:                 "PiquantPieUncooked",
  RoastedCrustPie:            "RoastedCrustPieUncooked",
  VikingCupcake:              "VikingCupcakeUncooked",
};

// ── Determine source (how to obtain) ──
function getSource(prefab, recipe, itemDrops) {
  const sources = [];
  // DLC-gated items — recipes exist but require Steam DLC ownership
  if (prefab === "CapeOdin" || prefab === "HelmetOdin" || prefab === "TankardOdin") {
    return ["DLC (Unobtainable)"];
  }
  if (VENDOR_ONLY_PREFABS.has(prefab)) {
    sources.push("Vendor");
    return sources;
  }
  // Items sold by vendors (may also be craftable)
  if (prefab === "FishingRod" || prefab === "Sparkler" || prefab === "BarberKit") {
    sources.push("Vendor");
  }
  if (FIRE_COOKED_ITEMS.has(prefab)) {
    sources.push("Cooking");
    return sources;
  }
  if (recipe) sources.push("Crafting");

  // Separate creature drops from world drops
  const creatureDrops = (itemDrops || []).filter(d => d.creaturePrefab !== null && !d.worldDropType);
  const worldDrops = (itemDrops || []).filter(d => d.worldDropType);

  if (creatureDrops.length > 0) sources.push("Creature Drop");

  // Add world-drop source types
  const worldTypes = new Set(worldDrops.map(d => d.worldDropType));
  if (worldTypes.has("Tree")) sources.push("Tree");
  if (worldTypes.has("Rock")) sources.push("Mining");
  if (worldTypes.has("Destructible")) sources.push("Destructible");
  if (worldTypes.has("Pickup")) sources.push("Pickup");
  if (worldTypes.has("Chest")) sources.push("Chest Loot");

  const p = prefab.toLowerCase();
  if ((p.includes("ore") || (p.includes("scrap") && !p.includes("leather"))) && !sources.includes("Mining")) sources.push("Mining");
  if (p.includes("trophy") && !sources.includes("Creature Drop")) sources.push("Creature Drop");
  if (p.includes("seed") && !sources.includes("Pickup")) sources.push("Pickup");
  if ((p.includes("mushroom") || p.includes("thistle") || p.includes("carrot") ||
      p.includes("turnip") || p.includes("onion") || p.includes("barley") ||
      p.includes("flax")) && !sources.includes("Foraging")) sources.push("Foraging");

  if (sources.length === 0) sources.push("Pickup");
  return [...new Set(sources)];
}

// ── Map crafting station tokens to display names ──
function mapStation(stationToken) {
  if (!stationToken) return "";
  const resolved = loc(stationToken);
  // Common mapping
  const map = {
    "$piece_workbench": "Workbench",
    "$piece_forge": "Forge",
    "$piece_cauldron": "Cauldron",
    "$piece_stonecutter": "Stonecutter",
    "$piece_artisanstation": "Artisan Table",
    "$piece_blackforge": "Black Forge",
    "$piece_magetable": "Galdr Table",
    "$piece_runeforge": "Rune Forge",
    "$piece_meadcauldron": "Mead Ketill",
    "$piece_preptable": "Food Preparation Table",
  };
  return map[stationToken] || resolved || stationToken;
}

// ── Build stats array for an item ──
function buildStats(item) {
  const stats = [];
  const d = item.damages;
  const dpl = item.damagesPerLevel;
  const isWeapon = ["OneHandedWeapon", "TwoHandedWeapon", "TwoHandedWeaponLeft", "Bow", "Torch"].includes(item.itemType);
  const isArmor = ["Chest", "Legs", "Helmet", "Shoulder", "Shield", "Trinket", "Utility"].includes(item.itemType);
  const isShield = item.itemType === "Shield";
  const hasSkill = item.skillType && item.skillType !== "None";
  const hasDamage = d.slash > 0 || d.pierce > 0 || d.blunt > 0 || d.fire > 0 || d.frost > 0 ||
    d.lightning > 0 || d.poison > 0 || d.spirit > 0 || d.damage > 0;
  
  // Damage stats — only for weapons/tools with actual damage
  if (isWeapon || hasDamage) {
    if (d.slash > 0) stats.push({ label: "Slash", value: `${d.slash}` + (dpl.slash > 0 ? ` (+${dpl.slash}/lvl)` : "") });
    if (d.pierce > 0) stats.push({ label: "Pierce", value: `${d.pierce}` + (dpl.pierce > 0 ? ` (+${dpl.pierce}/lvl)` : "") });
    if (d.blunt > 0) stats.push({ label: "Blunt", value: `${d.blunt}` + (dpl.blunt > 0 ? ` (+${dpl.blunt}/lvl)` : "") });
    if (d.fire > 0) stats.push({ label: "Fire", value: `${d.fire}` + (dpl.fire > 0 ? ` (+${dpl.fire}/lvl)` : "") });
    if (d.frost > 0) stats.push({ label: "Frost", value: `${d.frost}` + (dpl.frost > 0 ? ` (+${dpl.frost}/lvl)` : "") });
    if (d.lightning > 0) stats.push({ label: "Lightning", value: `${d.lightning}` + (dpl.lightning > 0 ? ` (+${dpl.lightning}/lvl)` : "") });
    if (d.poison > 0) stats.push({ label: "Poison", value: `${d.poison}` + (dpl.poison > 0 ? ` (+${dpl.poison}/lvl)` : "") });
    if (d.spirit > 0) stats.push({ label: "Spirit", value: `${d.spirit}` + (dpl.spirit > 0 ? ` (+${dpl.spirit}/lvl)` : "") });
    if (d.damage > 0) stats.push({ label: "Damage", value: `${d.damage}` + (dpl.damage > 0 ? ` (+${dpl.damage}/lvl)` : "") });
  }

  // Chop/pickaxe (for tools)
  if (d.chop > 0) stats.push({ label: "Chop", value: `${d.chop}` });
  if (d.pickaxe > 0) stats.push({ label: "Pickaxe", value: `${d.pickaxe}` });

  // Armor — only for armor/shield/utility items
  if (isArmor && item.armor > 0) stats.push({ label: "Armor", value: `${item.armor}` + (item.armorPerLevel > 0 ? ` (+${item.armorPerLevel}/lvl)` : "") });

  // Block — only for weapons/shields with a real skill type (excludes bombs/throwables)
  if ((isWeapon || isShield) && hasSkill && item.blockPower > 0 && hasDamage) {
    stats.push({ label: "Block", value: `${item.blockPower}` + (item.blockPowerPerLevel > 0 ? ` (+${item.blockPowerPerLevel}/lvl)` : "") });
  }
  if ((isWeapon || isShield) && hasSkill && item.timedBlockBonus > 1 && hasDamage) {
    stats.push({ label: "Parry Bonus", value: `${item.timedBlockBonus}x` });
  }

  // Backstab — only for weapons with a real skill type and actual damage
  if (isWeapon && hasSkill && item.backstabBonus > 1 && hasDamage) {
    stats.push({ label: "Backstab", value: `${item.backstabBonus}x` });
  }

  // Knockback — only for weapons with a real skill type and actual damage
  if (isWeapon && hasSkill && item.attackForce > 0 && hasDamage) {
    stats.push({ label: "Knockback", value: `${item.attackForce}` });
  }

  // Movement penalty
  if (item.movementModifier < 0) stats.push({ label: "Movement", value: `${(item.movementModifier * 100).toFixed(0)}%` });

  // Food stats
  if (item.food > 0) stats.push({ label: "Health", value: `${item.food}` });
  if (item.foodStamina > 0) stats.push({ label: "Stamina", value: `${item.foodStamina}` });
  if (item.foodEitr > 0) stats.push({ label: "Eitr", value: `${item.foodEitr}` });
  if (item.foodBurnTime > 0) stats.push({ label: "Duration", value: `${Math.round(item.foodBurnTime / 60)}m` });
  if (item.foodRegen > 0) stats.push({ label: "Regen", value: `${item.foodRegen}/tick` });

  // Quality
  if (item.maxQuality > 1) stats.push({ label: "Max Quality", value: `${item.maxQuality}` });

  // Set bonus
  if (item.setName) stats.push({ label: "Set", value: `${item.setName} (${item.setSize}pc)` });

  return stats;
}

// ══════════════════════════════════════════════════════════════
//  MAIN CONVERSION
// ══════════════════════════════════════════════════════════════

console.log("Processing dump...");
console.log(`  Items: ${items.length}`);
console.log(`  Recipes: ${recipes.length}`);
console.log(`  Creatures: ${creatureDrops.length}`);
console.log(`  Pieces: ${pieces.length}`);
console.log(`  Localization: ${Object.keys(localization).length}`);

const converted = [];
const seenIds = new Set();

// Pre-pass: collect feast material recipe data for merging into base feast entries
// Feast*_Material items are craft intermediates with the same display name as the base feast.
// We skip them as standalone entries and merge their recipe/station/description into the base.
const feastMaterialMap = {};
for (const item of items) {
  if (item.prefab.endsWith("_Material") && item.prefab.startsWith("Feast")) {
    const basePrefab = item.prefab.replace("_Material", "");
    feastMaterialMap[basePrefab] = {
      recipe: recipeMap[item.prefab],
      description: item.description,
      stack: item.maxStackSize,
    };
  }
}
// Note: Oven food intermediates (BreadDough, LoxPieUncooked, etc.) are NO LONGER merged
// into cooked products. They exist as standalone Food Prep Table items, and the cooked
// products come from the Stone Oven (a processing station).

// Process items
for (const item of items) {
  if (isInternalItem(item)) continue;
  if (seenIds.has(item.prefab)) continue;
  
  // Skip DvergerArbalest_shoot variants (these are attack actions, not the actual crossbow)
  if (item.prefab.includes("_shoot")) continue;

  // Skip feast material variants (merged into base entries above)
  if (item.prefab.endsWith("_Material") && item.prefab.startsWith("Feast")) continue;
  
  const name = loc(item.name);
  if (!name || name.startsWith("$")) continue; // Skip if localization failed

  // For feast items, use the material variant's recipe/station/description
  const feastMat = feastMaterialMap[item.prefab];
  const recipe = feastMat ? feastMat.recipe : recipeMap[item.prefab];
  const itemDrops = dropLookup[item.prefab];
  const biomes = guessBiomes(item.prefab, recipe);
  
  const recipeIngredients = recipe ? recipe.resources
    .filter(r => r.item)
    .map(r => ({
      id: r.item,
      name: loc(findItemName(r.item)),
      amount: r.amount,
    })) : [];

  // Cooking Station outputs use Smelter conversions, not standard Recipes —
  // inject a synthetic 1:1 ingredient so Craft Materials mode surfaces the
  // raw meats.
  if (recipeIngredients.length === 0 && COOKING_CONVERSIONS[item.prefab]) {
    const rawId = COOKING_CONVERSIONS[item.prefab];
    recipeIngredients.push({
      id: rawId,
      name: loc(findItemName(rawId)),
      amount: 1,
    });
  }

  // Build upgrade costs (level 2+)
  const upgradeCosts = [];
  if (item.maxQuality > 1 && recipe) {
    for (let lvl = 2; lvl <= item.maxQuality; lvl++) {
      const resources = recipe.resources
        .filter(r => r.item && r.amountPerLevel > 0)
        .map(r => ({
          id: r.item,
          name: loc(findItemName(r.item)),
          amount: r.amountPerLevel,
        }));
      if (resources.length > 0) {
        upgradeCosts.push({
          level: lvl,
          stationLevel: lvl,
          resources,
        });
      }
    }
  }
  
  const drops = [];  // Items don't have drops — creatures do

  // Build worldSources from WORLD_DROPS (grouped by source name)
  const worldSources = [];
  const wdEntries = WORLD_DROPS[item.prefab];
  if (wdEntries) {
    const grouped = {};
    for (const wd of wdEntries) {
      if (!grouped[wd.source]) grouped[wd.source] = { source: wd.source, type: wd.type, biomes: [] };
      if (!grouped[wd.source].biomes.includes(wd.biome)) grouped[wd.source].biomes.push(wd.biome);
    }
    worldSources.push(...Object.values(grouped));
  }

  const resolvedType = mapItemType(item.itemType, item.prefab, item);
  const isClothing = resolvedType === "Clothing";
  
  // For clothing items, strip per-level stats and Max Quality (they don't upgrade)
  let stats = buildStats(item);
  if (isClothing) {
    stats = stats
      .filter(s => s.label !== "Max Quality")
      .map(s => s.value.includes("/lvl") ? { label: s.label, value: `${parseInt(s.value)}` } : s);
  }

  const entry = {
    id: item.prefab,
    token: item.name || "",
    name: name,
    type: resolvedType,
    subcategory: mapSubcategory(item.itemType, item.prefab, item),
    description: loc(item.description) || (feastMat ? loc(feastMat.description) : ""),
    biomes: biomes,
    source: getSource(item.prefab, recipe, itemDrops),
    station: COOKING_STATION_ITEMS.has(item.prefab) ? "Cooking Station"
           : IRON_COOKING_STATION_ITEMS.has(item.prefab) ? "Iron Cooking Station"
           : STONE_OVEN_ITEMS.has(item.prefab) ? "Stone Oven"
           : (recipe
               ? (resolvedType === "Potion" && mapStation(recipe.craftingStation) === "Mead Ketill"
                   ? "Fermenter"
                   : mapStation(recipe.craftingStation))
               : ""),
    stationLevel: recipe ? recipe.minStationLevel : 0,
    maxQuality: isClothing ? 1 : item.maxQuality,
    stack: feastMat ? feastMat.stack : item.maxStackSize,
    weight: item.weight,
    value: item.value,
    recipe: recipeIngredients,
    upgradeCosts: upgradeCosts,
    drops: drops,
    worldSources: worldSources,
    stats: stats,
    wikiUrl: WIKI_MAP[item.prefab] ? WIKI_MAP[item.prefab][0] : "",
    wikiGroup: WIKI_MAP[item.prefab] && WIKI_MAP[item.prefab][1] ? WIKI_MAP[item.prefab][1] : "",
    // Set effect mechanics — only present on the chest piece of each set,
    // populated by MegaDataExtractor v1.5.0+. `null` for non-chest pieces and
    // for non-armor items. Frontend looks it up by walking the set on demand.
    setEffect: item.setEffect || null,
  };
  
  converted.push(entry);
  seenIds.add(item.prefab);
}

// Process creatures (as their own entries with drops)
// Blacklist creature prefabs that are internal/variant/not real enemies
const CREATURE_BLACKLIST = new Set([
  "Charred_Melee_Dyrnwyn", "Charred_Melee_Fader",
  "TrainingDummy", "DvergerTest", "Lox_Calf", "Boar_piggy",
  "Wolf_cub", "Chicken", "Hen", "gd_king",
  "Goblin_Gem",  // Destructible gemstone node, not a creature
]);
const CREATURE_SKIP_PATTERNS = [
  /_nochest$/i, /_Summoned$/i, /Test$/i, /_NonSleeping$/i,
  /Hildir_nochest$/i, /BruteBros/i,
];

// Subcategory overrides for special creatures (minibosses etc)
const CREATURE_SUBCATEGORY_OVERRIDE = {
  "GoblinShaman_Hildir": "Miniboss",
  "GoblinBrute_Hildir": "Miniboss",
  "Skeleton_Hildir": "Miniboss",
  "Cultist_Hildir": "Miniboss",
};

// Creatures that can be tamed (fed their preferred food until friendly)
const TAMEABLE_CREATURES = new Set([
  "Boar",
  "Wolf",
  "Lox",
  "Asksvin",
]);

// Foods each tameable creature accepts (prefab IDs, in display order).
// Sourced from valheim.fandom.com/wiki/Taming + per-creature wiki pages.
const TAMEABLE_CREATURE_FOODS = {
  Boar:    ["Raspberry", "Blueberries", "Carrot", "Turnip", "Mushroom", "Onion"],
  Wolf:    ["RawMeat", "DeerMeat", "NeckTail", "LoxMeat", "FishRaw", "SerpentMeat", "Sausages"],
  Lox:     ["Barley", "Cloudberry", "Flax"],
  Asksvin: ["MushroomSmokePuff", "Vineberry", "Fiddleheadfern"],
};

for (const cd of creatureDrops) {
  if (seenIds.has(cd.creature)) continue;
  if (CREATURE_BLACKLIST.has(cd.creature)) continue;
  if (CREATURE_SKIP_PATTERNS.some(p => p.test(cd.creature))) continue;
  
  const name = findCreatureName(cd.creature);
  if (!name) continue;
  
  // Strip any remaining Unity rich text from creature names
  const cleanName = stripRichText(name);
  
  const drops = cd.drops
    .filter(d => d.prefab)
    .map(d => ({
      id: d.prefab,
      name: loc(findItemName(d.prefab)),
      chance: d.chance,
      min: d.min,
      max: d.max,
    }));
  
  const creatureBiomes = BIOME_OVERRIDE[cd.creature] || [];
  const biome = creatureBiomes.length > 0 ? creatureBiomes[0] : guessCreatureBiome(cd.creature);
  const biomeList = creatureBiomes.length > 0 ? creatureBiomes : (biome ? [biome] : []);
  
  const isBoss = cd.boss === true || cd.health >= 5000;
  const hp = cd.health;

  // ── Stats array ──
  const stats = [];

  // Health — bosses get flat value, regular creatures get /lvl for star tabs
  if (isBoss) {
    stats.push({ label: "Health", value: `${hp}` });
  } else {
    // Stars: 1★=2x HP, 2★=3x HP → perLevel = base
    stats.push({ label: "Health", value: `${hp}/${hp}lvl` });
  }

  // ── Attack damage (from new extractor fields) ──
  if (cd.attacks && cd.attacks.length > 0) {
    // Deduplicate: group by resolved name, keep highest total damage per name
    const atkMap = new Map(); // name → {atk, totalDmg}
    for (const atk of cd.attacks) {
      const totalDmg = (atk.damage || 0) + (atk.blunt || 0) + (atk.slash || 0) + (atk.pierce || 0) +
        (atk.fire || 0) + (atk.frost || 0) + (atk.lightning || 0) + (atk.poison || 0) + (atk.spirit || 0);
      if (totalDmg <= 0) continue;
      const atkName = loc(atk.name) || "Attack";
      if (!atkMap.has(atkName) || totalDmg > atkMap.get(atkName).totalDmg) {
        atkMap.set(atkName, { atk, totalDmg });
      }
    }

    for (const [atkName, { atk, totalDmg }] of atkMap) {
      // Star damage scaling: 1★=1.5x, 2★=2x → perLevel = base * 0.5
      if (isBoss) {
        stats.push({ label: atkName, value: `${totalDmg}` });
      } else {
        const perLvl = Math.round(totalDmg * 0.5);
        stats.push({ label: atkName, value: `${totalDmg}/${perLvl}lvl` });
      }

      // Per-type breakdown
      const dmgTypes = [];
      if (atk.blunt > 0) dmgTypes.push(`Blunt ${atk.blunt}`);
      if (atk.slash > 0) dmgTypes.push(`Slash ${atk.slash}`);
      if (atk.pierce > 0) dmgTypes.push(`Pierce ${atk.pierce}`);
      if (atk.fire > 0) dmgTypes.push(`Fire ${atk.fire}`);
      if (atk.frost > 0) dmgTypes.push(`Frost ${atk.frost}`);
      if (atk.lightning > 0) dmgTypes.push(`Lightning ${atk.lightning}`);
      if (atk.poison > 0) dmgTypes.push(`Poison ${atk.poison}`);
      if (atk.spirit > 0) dmgTypes.push(`Spirit ${atk.spirit}`);
      if (atk.damage > 0) dmgTypes.push(`Physical ${atk.damage}`);
      if (dmgTypes.length > 0 && dmgTypes.length < 5) {
        // Only show type breakdown if it's interesting (not too many types)
        stats.push({ label: `${atkName} Types`, value: dmgTypes.join(", ") });
      }
    }
  }

  // ── Attack damage types the creature deals ──
  const dealsDamage = new Set();
  if (cd.attacks) {
    for (const atk of cd.attacks) {
      if (atk.blunt > 0) dealsDamage.add("Blunt");
      if (atk.slash > 0) dealsDamage.add("Slash");
      if (atk.pierce > 0) dealsDamage.add("Pierce");
      if (atk.fire > 0) dealsDamage.add("Fire");
      if (atk.frost > 0) dealsDamage.add("Frost");
      if (atk.lightning > 0) dealsDamage.add("Lightning");
      if (atk.poison > 0) dealsDamage.add("Poison");
      if (atk.spirit > 0) dealsDamage.add("Spirit");
    }
  }

  // ── Damage resistances / weaknesses (structured on creatureInfo, not stats) ──
  const resist = [];
  const weak = [];
  const immune = [];
  const neutral = [];
  if (cd.damageModifiers) {
    const dm = cd.damageModifiers;
    // All damage types including tool damage (chop / pickaxe)
    const combatTypes = ["blunt", "slash", "pierce", "chop", "pickaxe", "fire", "frost", "lightning", "poison", "spirit"];

    for (const t of combatTypes) {
      const mod = dm[t];
      const label = t.charAt(0).toUpperCase() + t.slice(1);
      if (!mod || mod === "Normal") { neutral.push(label); continue; }
      // "Ignore" = creature takes no damage from this type = effectively Immune
      if (mod === "Immune" || mod === "Ignore") immune.push(label);
      else if (mod === "Resistant" || mod === "VeryResistant") resist.push(label);
      else if (mod === "Weak" || mod === "VeryWeak") weak.push(label);
    }
  }

  // ── Faction (pretty-print: strip trailing "Monsters") ──
  const factionPretty = cd.faction
    ? cd.faction.replace(/Monsters$/, "")
    : "";

  const entry = {
    id: cd.creature,
    token: "",
    name: cleanName,
    type: "Creature",
    subcategory: isBoss ? "Boss" : (CREATURE_SUBCATEGORY_OVERRIDE[cd.creature] || "Creature"),
    description: "",
    biomes: biomeList,
    source: biomeList.length > 0 ? [...biomeList] : ["World"],
    station: "",
    stationLevel: 0,
    maxQuality: isBoss ? 1 : 3,
    stack: 1,
    weight: 0,
    value: 0,
    recipe: [],
    upgradeCosts: [],
    drops: drops,
    worldSources: [],
    stats: stats,
    ...(TAMEABLE_CREATURES.has(cd.creature) ? { tameable: true } : {}),
    ...(TAMEABLE_CREATURE_FOODS[cd.creature] ? { tameFoods: TAMEABLE_CREATURE_FOODS[cd.creature] } : {}),
    ...(factionPretty ? { faction: factionPretty } : {}),
    ...(typeof cd.staggerDamageFactor === "number"
      ? { staggerLimit: `${Math.round(cd.staggerDamageFactor * 100)}%` }
      : {}),
    ...(dealsDamage.size > 0 ? { dealsDamage: Array.from(dealsDamage) } : {}),
    ...(immune.length > 0 ? { immuneTo: immune } : {}),
    ...(resist.length > 0 ? { resistantTo: resist } : {}),
    ...(weak.length > 0 ? { weakTo: weak } : {}),
    ...(neutral.length > 0 ? { neutralTo: neutral } : {}),
    wikiUrl: WIKI_MAP[cd.creature] ? WIKI_MAP[cd.creature][0] : "",
    wikiGroup: WIKI_MAP[cd.creature] && WIKI_MAP[cd.creature][1] ? WIKI_MAP[cd.creature][1] : "",
  };
  
  converted.push(entry);
  seenIds.add(cd.creature);
}

// Process build pieces
for (const p of pieces) {
  if (seenIds.has(p.prefab)) continue;
  if (isWorldPiece(p.prefab)) continue;
  
  const name = loc(p.name);
  if (!name || name.startsWith("$")) continue;
  if (name === "yourare dead") continue; // Internal
  
  const recipeIngredients = (p.resources || [])
    .filter(r => r.item)
    .map(r => ({
      id: r.item,
      name: loc(findItemName(r.item)),
      amount: r.amount,
    }));
  
  // Skip pieces with no recipe (internal/debug)
  if (recipeIngredients.length === 0) continue;
  
  const isPlantablePiece = PLANTABLE_PIECES.has(p.prefab);
  const entry = {
    id: p.prefab,
    token: p.name || "",
    name: name,
    type: isPlantablePiece ? "Plantable" : "BuildPiece",
    subcategory: isPlantablePiece ? "Sapling" : mapPieceCategory(p.category),
    description: loc(p.description),
    biomes: guessBiomes(p.prefab, { resources: p.resources || [] }),
    source: isPlantablePiece ? ["Planting"] : ["Building"],
    station: p.craftingStation ? mapStation(p.craftingStation) : "",
    stationLevel: 0,
    maxQuality: 1,
    stack: 1,
    weight: 0,
    value: 0,
    recipe: recipeIngredients,
    upgradeCosts: [],
    drops: [],
    worldSources: [],
    stats: p.comfort > 0 ? [{ label: "Comfort", value: `${p.comfort}` }] : [],
    wikiUrl: WIKI_MAP[p.prefab] ? WIKI_MAP[p.prefab][0] : "",
    wikiGroup: WIKI_MAP[p.prefab] && WIKI_MAP[p.prefab][1] ? WIKI_MAP[p.prefab][1] : "",
    ...(isPlantablePiece ? { plantable: true } : {}),
  };

  converted.push(entry);
  seenIds.add(p.prefab);
}

// ── Generate WorldObject entries for Loot Chests ──
for (const [chestName, data] of Object.entries(CHEST_LOOT)) {
  const chestId = "LootChest_" + chestName.replace(/\s+/g, "");
  if (seenIds.has(chestId)) continue;
  const drops = data.items.map(id => ({
    id,
    name: loc(findItemName(id)) || id,
    chance: 1,
    min: 1,
    max: 1,
  }));
  converted.push({
    id: chestId,
    token: "",
    name: chestName,
    type: "WorldObject",
    subcategory: "Loot Chest",
    description: `A loot chest found in the ${data.biome} biome.`,
    biomes: [data.biome],
    source: ["World"],
    station: "",
    stationLevel: 0,
    maxQuality: 1,
    stack: 1,
    weight: 0,
    value: 0,
    recipe: [],
    upgradeCosts: [],
    drops: drops,
    worldSources: [],
    stats: [],
    wikiUrl: CHEST_WIKI,
    wikiGroup: "Loot chests",
  });
  seenIds.add(chestId);
}

// ── Generate WorldObject entries for Creature Spawners ──
for (const [spawnerName, def] of Object.entries(SPAWNER_DEFS)) {
  if (seenIds.has(def.prefabId)) continue;
  const drops = def.creatures.map(c => {
    const cName = findCreatureName(c.id);
    return {
      id: c.id,
      name: loc(cName) || cName || c.id,
      chance: c.chance,
      min: 1,
      max: 1,
    };
  });
  converted.push({
    id: def.prefabId,
    token: "",
    name: spawnerName,
    type: "WorldObject",
    subcategory: "Creature Spawner",
    description: "",
    biomes: def.biomes,
    source: ["World"],
    station: "",
    stationLevel: 0,
    maxQuality: 1,
    stack: 1,
    weight: 0,
    value: 0,
    recipe: [],
    upgradeCosts: [],
    drops: drops,
    worldSources: [],
    stats: [{ label: "Health", value: `${def.health}` }],
    wikiUrl: def.wikiUrl,
    wikiGroup: "",
  });
  seenIds.add(def.prefabId);
}

function findItemName(prefab) {
  const item = items.find(i => i.prefab === prefab);
  if (item) return item.name;
  // Try pieces
  const piece = pieces.find(p => p.prefab === prefab);
  if (piece) return piece.name;
  // Fallback: clean up prefab name
  return prefab.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function guessCreatureBiome(prefab) {
  // Check BIOME_OVERRIDE first (authoritative for edge cases)
  if (BIOME_OVERRIDE[prefab]) return BIOME_OVERRIDE[prefab][0];
  
  const p = prefab.toLowerCase();
  // ── Specific overrides BEFORE generic patterns (order matters!) ──
  if (p.includes("unbjorn")) return "Plains";        // Vile — Plains, not Ashlands
  if (p === "bjorn") return "Black Forest";            // Bear — Black Forest, not Ashlands
  if (p === "blobfrost") return "Mountain";            // Frost Blob — Mountain, not Swamp
  if (p === "bloblava") return "Ashlands";             // Lava Blob — Ashlands, not Swamp
  if (p === "blobtar") return "Plains";                // Growth — Plains, not Swamp
  if (p === "skeleton_poison") return "Swamp";         // Rancid Remains — Swamp crypts
  if (p === "dvergerashlands") return "Ashlands";      // Ashlands-specific Dvergr
  // Base Dvergr (rogues + mages) are Mistlands
  if (p.startsWith("dverger") || p.startsWith("dvergr")) return "Mistlands";
  
  // ── Generic biome patterns ──
  if (p.includes("charred") || p.includes("morgen") || p.includes("asksvin") || p.includes("volture") ||
      p.includes("fader") || p.includes("bjorn") || p.includes("fallen") ||
      p.includes("lavaman") || p.includes("bonemaw")) return "Ashlands";
  if (p.includes("seeker") || p.includes("gjall") || p.includes("tick") || p === "seekerqueen" || 
      p.includes("hare")) return "Mistlands";
  if (p.includes("goblin") || p.includes("deathsquito") || p.includes("lox") || p.includes("growth")) return "Plains";
  if (p.includes("fenring") || p.includes("wolf") || p.includes("drake") || p.includes("dragon") ||
      p.includes("hatchling") || p.includes("ulv") || p.includes("bat") || p.includes("stonegolem")) return "Mountain";
  if (p.includes("draugr") || p.includes("blob") || p.includes("wraith") || p.includes("leech") ||
      p.includes("surtling") || p.includes("bonemass") || p.includes("abomination") ||
      p.includes("bogwitch") || p.includes("kvastur")) return "Swamp";
  if (p.includes("troll") || p.includes("greydwarf") || p.includes("skeleton") || p.includes("gdking") ||
      p.includes("ghost")) return "Black Forest";
  if (p.includes("boar") || p.includes("deer") || p.includes("neck") || p.includes("greyling") ||
      p.includes("eikthyr") || p.includes("chicken") || p.includes("hive")) return "Meadows";
  if (p.includes("serpent") || p.includes("leviathan")) return "Ocean";
  return "";
}

function mapPieceCategory(cat) {
  // Match the in-game hammer-menu category labels so the Workbench detail page
  // groups read like the player's build wheel. Ticket 20260425-081018-0c66abac.
  switch (cat) {
    case "BuildingWorkbench": return "Building";
    case "BuildingStonecutter": return "Heavy Build";
    case "Furniture": return "Furniture";
    case "Crafting": return "Crafting";
    case "Food": return "Food Station";
    case "Meads": return "Fermenter";
    case "Misc": return "Miscellaneous";
    case "Feasts": return "Feast";
    case "All": return "Miscellaneous";
    default: return cat;
  }
}

// ── Plantable flag on seeds / crops / mushrooms ──────────────
// These keep their primary type (Material/Food) so they remain in those
// category filters, but get plantable=true so the Plantable filter picks
// them up alongside the sapling pieces.
for (const entry of converted) {
  if (PLANTABLE_FLAG.has(entry.id)) {
    entry.plantable = true;
  }
}

// ── Build piece biome resolution ─────────────────────────────
// Build pieces aren't in recipeMap, so getItemBiomeTier can't resolve them.
// Use max-tier of ingredients (same logic as crafted items). Plantable
// saplings follow the same rule — their tier is the seed/produce tier.
for (const entry of converted) {
  if (entry.type !== "BuildPiece" && entry.type !== "Plantable") continue;
  if (entry.biomes.length > 0 && entry.biomes.length === 1) continue; // Already set by override
  if (entry.recipe.length === 0) continue;
  
  let maxTier = -1;
  // Check piece crafting station
  const piece = pieces.find(p => p.prefab === entry.id);
  if (piece && piece.craftingStation && STATION_BIOME[piece.craftingStation]) {
    const stationTier = BIOME_TIER[STATION_BIOME[piece.craftingStation]] ?? -1;
    if (stationTier > maxTier) maxTier = stationTier;
  }
  // Check ingredient tiers
  for (const ing of entry.recipe) {
    const ingTier = getItemBiomeTier(ing.id);
    if (ingTier > maxTier) maxTier = ingTier;
  }
  if (maxTier >= 0 && maxTier < BIOME_PROGRESSION.length) {
    entry.biomes = [BIOME_PROGRESSION[maxTier]];
  }
}

// ── Biome inheritance pass ──────────────────────────────────
// For items with no biome that have a recipe, inherit the max-tier biome from ingredients
const convertedMap = {};
for (const e of converted) convertedMap[e.id] = e;

let inherited = 0;
for (const entry of converted) {
  if (entry.biomes.length > 0) continue;
  if (entry.recipe.length === 0) continue;
  // Use max-tier logic (consistent with crafted items) instead of union
  let maxTier = -1;
  for (const ing of entry.recipe) {
    const ingTier = getItemBiomeTier(ing.id);
    if (ingTier > maxTier) maxTier = ingTier;
  }
  if (maxTier >= 0 && maxTier < BIOME_PROGRESSION.length) {
    entry.biomes = [BIOME_PROGRESSION[maxTier]];
    inherited++;
  }
}
console.log(`Inherited biomes for ${inherited} items from their ingredients`);

// ── Post-processing fixups (corrections verified against wiki / in-game) ──
// These fix extraction pipeline bugs and item data errors that can't be solved
// by BIOME_OVERRIDE alone (source changes, stat cleanup, missing items, etc.)
const ITEM_FIXUPS = {
  // Ashlands source corrections (extraction misclassifies Destructible as Pickup)
  "SurtlingCore":     { biomes: ["Black Forest", "Swamp"] },
  "CharcoalResin":    { source: ["Destructible"] },
  "BellFragment":     { source: ["Destructible"] },
  "Charredskull":     { source: ["Destructible", "Chest Loot"] },
  "Pot_Shard_Green":  { source: ["Destructible"] },
  "AsksvinCarrionNeck":    { source: ["Destructible"] },
  "AsksvinCarrionPelvic":  { source: ["Destructible"] },
  "AsksvinCarrionRibcage": { source: ["Destructible"] },
  "AsksvinCarrionSkull":   { source: ["Destructible"] },
  "SulfurStone":      { source: ["Mining", "Creature Drop"] },
  "CelestialFeather": { source: ["Creature Drop", "Chest Loot"] },
  "ProustitePowder":  { source: ["Creature Drop", "Destructible"] },
  "MoltenCore":       { source: ["Pickup", "Chest Loot"] },
  "VoltureEgg":       { source: ["Creature Drop", "Pickup"] },
  "Fish11":           { source: ["Fishing"] },  // Magmafish
  "Ironpit":          { biomes: ["Meadows"], source: ["Vendor"] },  // Hildir vendor (decorative in Ashlands but not pickable there)
  "PungentPebbles":   { biomes: ["Swamp"], source: ["Vendor"] },
  // Mistlands materials wrongly tagged as chest loot
  "BlackCore":        { source: ["Pickup", "Creature Drop"] },  // Stand pickup in Infested Mines + Seeker Soldier drops
  "DvergrNeedle":     { source: ["Destructible"] },              // Dvergr Component Crates (surface settlements)
  "JuteRed":          { source: ["Chest Loot", "Destructible"] }, // Dvergr Chests + Dvergr curtains/banners
  // Vendor-source overrides (items moved to vendors / fix from extraction)
  "CandleWick":              { biomes: ["Swamp"],   source: ["Vendor"] },     // Bog Witch
  "VineGreenSeeds":          { biomes: ["Swamp"],   source: ["Vendor"] },     // Bog Witch (Ivy Seeds)
  "SpiceForests":            { biomes: ["Swamp"],   source: ["Vendor"] },     // Bog Witch (Woodland Herb Blend)
  "FireworksRocket_White":   { biomes: ["Meadows"], source: ["Vendor"] },     // Hildir
  "BarberKit":               { biomes: ["Meadows"], source: ["Vendor"] },     // Hildir
  "HelmetSweatBand":         { biomes: ["Meadows"], source: ["Vendor"] },     // Hildir
  "Sparkler":                { biomes: ["Meadows"], source: ["Vendor"] },     // Hildir
  "AxeHead1":                { biomes: ["Meadows"], source: ["Pickup"] },     // Abandoned House ruins (variant 6)
  "TankardOdin":             { biomes: [],          source: ["DLC (Unobtainable)"] },  // Beta supporter DLC only
  "Tankard":                 { source: ["Crafting"] },                         // Workbench-crafted only
  "BogWitchKvastur":         { biomes: ["Swamp"] },
  "CeramicPlate":     { biomes: ["Mistlands"], source: ["Crafting"] },
  "BoneFragments":    { biomes: ["Meadows", "Black Forest", "Swamp", "Mountain", "Plains"] },
  // Audit: missing biomes
  "Chain":            { biomes: ["Swamp", "Plains", "Mistlands"] },  // +Plains (Sealed Tower chests), +Mistlands (Dvergr structures)
  "Pukeberries":      { biomes: ["Black Forest", "Plains"] },        // Greydwarf Shaman (BF) AND Fuling Shaman (Plains) drops
  // Section 1 fish bait corrections (prefab IDs do NOT match natural names — verify before changing)
  "FishingBaitMistlands":  { biomes: ["Mistlands"] },                       // Misty Fishing Bait — for Mistlands (Anglerfish)
  "FishingBaitForest":     { biomes: ["Black Forest"], source: ["Crafting"] }, // Mossy Fishing Bait — for Black Forest (Trollfish)
  "FishingBaitOcean":      { biomes: ["Ocean"] },                           // Heavy Fishing Bait — for Ocean (Coral Cod)
  "FishingBaitSwamp":      { biomes: ["Swamp"] },                           // Sticky Fishing Bait — for Swamp (Giant Herring)
  "FishingBaitPlains":     { biomes: ["Plains"] },                          // Stingy Fishing Bait — for Plains (Grouper)
  "FishingBaitCave":       { biomes: ["Mountain"] },                        // Cold Fishing Bait — for Mountain (Tetra cave)
  // Source-only fixes
  "BarleyWineBase":   { source: ["Crafting"] },                       // Pure crafting, no foraging
  // Flametal is smelted at Blast Furnace, not chest loot
  "FlametalNew":      { source: ["Crafting"], station: "Blast Furnace" },
  // Dyrnwyn fragments are Ashlands, not Mistlands
  "DyrnwynBladeFragment": { biomes: ["Ashlands"] },
  "DyrnwynTipFragment":   { biomes: ["Ashlands"] },
  // Creature renames / subcategory fixes
  "GoblinShaman_Hildir": { name: "Zil", subcategory: "Miniboss" },
  "GoblinBrute_Hildir":  { name: "Thungr", subcategory: "Miniboss" },
  // ── Siege engines + payloads ──
  // Surfaced via the synthetic "Siege" bucket on the Workbench detail page so the
  // hammer-menu "Others" engines + their ammo sit together. See ticket
  // 20260423-190000-siege.
  "Catapult": {
    subcategory: "Siege",
    description: "A wheeled siege engine that lobs Grausten or Explosive Payloads in a high arc. Built at the Workbench and wheeled into position.",
    wikiGroup: "Catapult",
  },
  "BatteringRam": {
    subcategory: "Siege",
    description: "A wheeled siege engine that smashes through walls and gates with a swinging head. Built at the Workbench and shoved up to the target.",
    wikiGroup: "Catapult",
  },
  "Catapult_ammo": {
    subcategory: "Siege Ammo",
    wikiGroup: "Catapult",
  },
  "BombSiege": {
    subcategory: "Siege Ammo",
    wikiGroup: "Catapult",
  },
  // ── Vehicles (Cart + boats) ──
  // Surfaced via the synthetic "Vehicle" bucket on the Workbench detail page,
  // mirroring the Siege treatment so vehicle BuildPieces don't get lost in Misc.
  // Ticket 20260425-081018-0c66abac.
  "Cart": {
    subcategory: "Vehicle",
    description: "A wheeled handcart for hauling stacks of resources back to base. Built at the Workbench, hitched to the player and shoved or dragged.",
    wikiGroup: "Cart",
  },
  "Raft": {
    subcategory: "Vehicle",
    description: "A simple wooden raft. Slow and fragile, but enough to cross a river or hop a coastal stretch before you can build a Karve.",
    wikiGroup: "Raft",
  },
  "Karve": {
    subcategory: "Vehicle",
    description: "A small single-mast sailing ship — faster than the Raft and lighter than the Longship, with a modest cargo hold.",
    wikiGroup: "Karve",
  },
  "VikingShip": {
    subcategory: "Vehicle",
    description: "A long, lean sail-and-oar warship for crossing the open ocean with cargo and crew.",
    wikiGroup: "Longship",
  },
  "Trailership": {
    subcategory: "Vehicle",
    description: "A long, lean sail-and-oar warship for crossing the open ocean with cargo and crew.",
    wikiGroup: "Longship",
  },
  "VikingShip_Ashlands": {
    subcategory: "Vehicle",
    description: "The Drakkar — the largest sail-and-oar warship, hardened to punch through the Ashlands surf where weaker hulls scuttle.",
    wikiGroup: "Drakkar",
  },
  // Stone Oven outputs — these have no recipe in the game data, they're baked from uncooked items
  "Bread":                    { source: ["Cooking"] },
  "FishAndBread":             { source: ["Cooking"] },
  "HoneyGlazedChicken":      { source: ["Cooking"] },
  "LoxPie":                   { source: ["Cooking"] },
  "MagicallyStuffedShroom":   { source: ["Cooking"] },
  "MeatPlatter":              { source: ["Cooking"] },
  "MisthareSupreme":          { source: ["Cooking"] },
  "PiquantPie":               { source: ["Cooking"] },
  "RoastedCrustPie":          { source: ["Cooking"] },
  "VikingCupcake":            { source: ["Cooking"] },
};

// Items to remove entirely (internal duplicates / bogus entries)
const ITEM_REMOVE = new Set([
  "Leech_cave",         // Duplicate of Leech (internal cave spawner variant)
  "Skeleton_NoArcher",  // Duplicate of Skeleton (melee-only variant)
  "TheHive",            // Bogus entry (Drake nest data on a Mistlands "boss")
  "Hive",               // Redundant with SeekerQueen (The Queen)
  // Ashlands ruin pots that aren't currently in-game — Iron Gate ships the
  // prefabs in the data dump but only the Green variants are placeable from
  // the Cultivator/Hammer. Strip the Red and Cracked-clay variants so they
  // don't pollute Furniture or the build-mats rollup.
  "piece_pot1_red", "piece_pot2_red", "piece_pot3_red",
  "piece_pot1_cracked", "piece_pot2_cracked", "piece_pot3_cracked",
]);

// Items to add (missing from extraction)
const ITEM_ADDITIONS = [
  // Bee Nest — world destructible that hangs off abandoned houses and Black Forest
  // contested towers. Drops a Queen Bee + Honey when broken; stings the player for
  // 10 poison in a 4m radius every 4 seconds while they're close.
  {id:"BeeNest",token:"",name:"Bee Nest",type:"WorldObject",subcategory:"Destructible",description:"A wild hive clinging to rafters and ruins. Break it for Queen Bee and Honey — mind the sting.",biomes:["Meadows","Black Forest"],source:["World"],station:"",stationLevel:0,maxQuality:1,stack:1,weight:0,value:0,recipe:[],upgradeCosts:[],drops:[{id:"QueenBee",name:"Queen Bee",chance:1,min:1,max:1},{id:"Honey",name:"Honey",chance:1,min:1,max:3}],worldSources:[],stats:[{label:"Health",value:"30"},{label:"Poison attack",value:"10"},{label:"Attack radius",value:"4m"},{label:"Attack rate",value:"every 4s"}],wikiUrl:"https://valheim.fandom.com/wiki/Bee_Nest",wikiGroup:""},
  // Rotten Meat — pickable from mounds of flesh inside Ashlands Putrid
  // Holes, and dropped by Vile. The extractor dump misses the ObjectDB
  // entry, so we seed it here. Eating it gives the "Feeling sick" status
  // the same as Bukeperries — best left as sacrificial fodder.
  {id:"RottenMeat",token:"$item_rottenmeat",name:"Rotten Meat",type:"Material",subcategory:"Material",description:"Foul, festering flesh harvested from mounds of meat in Ashlands Putrid Holes. Eating it will make you feel sick.",biomes:["Plains","Ashlands"],source:["Creature Drop","Destructible"],station:"",stationLevel:0,maxQuality:1,stack:50,weight:1,value:0,recipe:[],upgradeCosts:[],drops:[],worldSources:[{source:"Mound of Flesh",type:"Destructible",biomes:["Ashlands"]}],stats:[],wikiUrl:"https://valheim.fandom.com/wiki/Rotten_meat",wikiGroup:""},
];

// Remove blacklisted items
// Filter in-place (converted is const but array contents are mutable)
for (let i = converted.length - 1; i >= 0; i--) {
  if (ITEM_REMOVE.has(converted[i].id)) converted.splice(i, 1);
}

// Apply fixups
for (const e of converted) {
  const fix = ITEM_FIXUPS[e.id];
  if (!fix) continue;
  for (const [k, v] of Object.entries(fix)) {
    e[k] = v;
  }
}

// Add missing items
for (const add of ITEM_ADDITIONS) {
  if (!converted.some(e => e.id === add.id)) {
    converted.push(add);
  }
}

// Fix recipe references that use raw tokens instead of display names
for (const e of converted) {
  for (const r of e.recipe || []) {
    if (r.name && r.name.startsWith("$")) {
      r.name = loc(r.name) || r.name;
    }
  }
}

// Remove MoltenCore's bogus food stats (vestigial game data, food=0)
const mc = converted.find(e => e.id === "MoltenCore");
if (mc) mc.stats = mc.stats.filter(s => s.label !== "Duration" && s.label !== "Regen");

// ── Reclassify Food subcategories: Raw Food / Cooked Food / Prepared Food ──
for (const e of converted) {
  if (e.type !== "Food") continue;
  if (e.subcategory === "Feast") continue; // Already classified
  if (e.station === "Cooking Station" || e.source.includes("Cooking")) {
    e.subcategory = "Cooked Food";
  } else if (e.station === "Cauldron" || e.station === "Food Preparation Table") {
    e.subcategory = "Prepared Food";
  } else {
    e.subcategory = "Raw Food";
  }
}

let fixupCount = Object.keys(ITEM_FIXUPS).length + ITEM_REMOVE.size + ITEM_ADDITIONS.length;
console.log(`Applied ${fixupCount} post-processing fixups`);

// ── Sort: Materials, Weapons, Armor, Food, Potions, Tools, Ammo, Creatures, BuildPieces, Misc
const TYPE_ORDER = ["Material", "Weapon", "Armor", "Food", "Potion", "Tool", "Ammo", "Creature", "WorldObject", "BuildPiece", "Plantable", "Misc"];
converted.sort((a, b) => {
  const ta = TYPE_ORDER.indexOf(a.type);
  const tb = TYPE_ORDER.indexOf(b.type);
  if (ta !== tb) return ta - tb;
  return a.name.localeCompare(b.name);
});

// ── Generate TypeScript ──
console.log(`\nConverted ${converted.length} entries`);
const typeCounts = {};
for (const e of converted) {
  typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
}
console.log("Type breakdown:", typeCounts);

let ts = `// @ts-nocheck — generated data, array literal too large for TS union inference
// ── Valheim Item Database ──────────────────────────────────
// Auto-generated from game data dump (assembly_valheim.dll via MegaDataExtractor)
// ${converted.length} items extracted from Valheim ${new Date().toISOString().split("T")[0]}
// DO NOT EDIT MANUALLY — re-run convert-dump.cjs to regenerate

export interface RecipeIngredient {
  id: string;
  name: string;
  amount: number;
}

export interface ItemDrop {
  id: string;
  name: string;
  chance: number; // 0-1
  min: number;
  max: number;
}

export interface ItemStat {
  label: string;
  value: string;
}

export interface UpgradeCost {
  level: number;
  stationLevel: number;
  resources: RecipeIngredient[];
}

export interface WorldSource {
  source: string;    // "Beech Tree", "Copper Deposit", etc.
  type: string;      // "Tree", "Rock", "Destructible", "Pickup", "Crafting"
  biomes: string[];  // Biomes where this source is found
}

// Set status effect carried on the chest piece's m_setStatusEffect.
// Modifiers are the non-zero/non-default SE_Stats fields dumped by
// MegaDataExtractor v1.5.0+; resistance pairs (fire-resist / physical-weakness)
// come through via the \`mods\` sub-object when present.
export interface SetEffect {
  name: string;        // Internal name (e.g. "SetEffect_FenringArmor")
  displayName: string; // Localisation token (e.g. "$se_fenringseteffect_name")
  tooltip: string;     // Localisation token for the in-game tooltip
  modifiers: Record<string, string | number | boolean | Record<string, string>>;
}

export type ItemType =
  | "Material"
  | "Weapon"
  | "Armor"
  | "Clothing"
  | "Food"
  | "Potion"
  | "Tool"
  | "Ammo"
  | "BuildPiece"
  | "Plantable"
  | "Creature"
  | "WorldObject"
  | "Misc";

export interface ValheimItem {
  id: string;           // Internal prefab name (for console commands)
  token: string;        // Localization token from game data (e.g. "$item_axe_stone")
  name: string;         // Display name
  type: ItemType;
  subcategory: string;  // e.g. "Ore", "Ingot", "Trophy", "Sword", "Chest"
  description: string;
  biomes: string[];     // Biomes where found (can be multiple)
  source: string[];     // How to obtain: "Mining", "Looting", "Crafting", etc.
  station: string;      // Crafting station: "Forge", "Workbench", "Cauldron", ""
  stationLevel: number; // Min station level required (0 = none)
  maxQuality: number;   // Max upgrade level (1 = no upgrades)
  stack: number;        // Max stack size
  weight: number;       // Weight per unit
  value: number;        // Trader value (0 = not tradeable)
  recipe: RecipeIngredient[];
  upgradeCosts: UpgradeCost[]; // Resources needed per upgrade level (level 2+)
  drops: ItemDrop[];    // What this creature/source drops (for Creature type)
  worldSources: WorldSource[];  // Trees, rocks, destructibles that drop this item
  stats: ItemStat[];    // Flexible stats (damage, armor, duration, etc.)
  plantable?: boolean;  // True for items planted via the Cultivator — saplings,
                        // crop seeds, plantable produce/mushrooms. Surfaces these
                        // under the Plantable filter even when their primary
                        // type is Material/Food.
  tameable?: boolean;   // Creatures only — true for Boar, Wolf, Lox, Asksvin
  tameFoods?: string[]; // Creatures only — prefab IDs of foods this creature will eat to tame
  faction?: string;     // Creatures only — pretty-printed (e.g. "Forest")
  staggerLimit?: string; // Creatures only — e.g. "50%"
  dealsDamage?: string[]; // Creatures only — damage types this creature's attacks deal
  immuneTo?: string[];   // Creatures only — damage types ignored/immune
  resistantTo?: string[]; // Creatures only — resistant damage types
  weakTo?: string[];     // Creatures only — weak-to damage types
  neutralTo?: string[];  // Creatures only — normal-damage types
  wikiUrl: string;      // Verified wiki URL (empty if no page exists)
  wikiGroup: string;    // Wiki group page name (empty if item has its own page)
  setEffect?: SetEffect | null; // Armor only — set bonus mechanics on the chest piece
}

export const VALHEIM_ITEMS: ValheimItem[] = [\n`;

for (let i = 0; i < converted.length; i++) {
  const e = converted[i];
  ts += `  ${JSON.stringify(e)}${i < converted.length - 1 ? "," : ""}\n`;
}

ts += `];\n\n`;

// Add lookup maps
ts += `// ── Lookup Maps ─────────────────────────────────────────────
/** Prefab ID → ValheimItem */
export const itemMap = new Map<string, ValheimItem>();
/** Lowercase localization token → ValheimItem (e.g. "$item_axe_stone" → AxeStone item) */
export const tokenMap = new Map<string, ValheimItem>();
for (const item of VALHEIM_ITEMS) {
  itemMap.set(item.id, item);
  if (item.token) tokenMap.set(item.token.toLowerCase(), item);
}
`;

fs.writeFileSync(OUTPUT_PATH, ts, "utf-8");
console.log(`\nWritten to: ${OUTPUT_PATH}`);
console.log(`File size: ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB`);

// Character portraits are read at runtime by the get_character_portrait_png
// Tauri command from %APPDATA%\MegaLoad\character-portraits\, so no build-time
// copy is needed anymore. (MegaDataExtractor 1.4.3+ writes straight there.)
