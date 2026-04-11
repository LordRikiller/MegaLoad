# MegaLoad Valheim Items -- Biome Data Audit Report

> **AI Instructions:** Apply all changes in Sections 1-5 to `src/data/valheim-items.ts`. Each item is identified by its `id` field. For biome fixes, update the `biomes` array. For source fixes, update the `source` array. For worldSources fixes, update the nested `worldSources[].biomes` arrays. Section 6 items require human review before changing. Work through sections in order of priority. After applying changes, verify each edit by searching for the item ID and confirming the updated values. Do NOT modify the `convert-dump.cjs` pipeline -- these are manual data corrections only.

**Date:** 2026-04-11
**File:** `src/data/valheim-items.ts` (1142 items)
**Source:** Cross-referenced against Valheim Wiki (valheim.fandom.com) -- current release (Feb 18 2026)

---

## SECTION 1: CRITICAL BIOME FIXES (Wrong biome assigned) -- Priority: HIGH

These items have an incorrect biome and need replacement:

| # | Item | ID | Field | Current | Correct | Reason |
|---|------|----|-------|---------|---------|--------|
| 1 | Majestic Carapace | `MajesticCarapace` | biomes | `["Meadows"]` | `["Mistlands"]` | Dropped by The Queen (Mistlands boss). Meadows is flat wrong |
| 2 | The Hive (x2 entries) | `TheHive`, `Hive` | biomes | `["Meadows"]` | `["Mistlands"]` | Mistlands-related entity. Meadows is incorrect. Also: 2 duplicate entries to review |
| 3 | Misty Fishing Bait | `FishingBaitMist` | biomes | `["Plains"]` | `["Mistlands"]` | Bait is for Mistlands fishing (catches Anglerfish) |
| 4 | Mossy Fishing Bait | `FishingBaitForest` | biomes | `["Swamp"]` | `["Black Forest"]` | Bait is for Black Forest fishing (catches Trollfish). ID even says "Forest" |
| 5 | Heavy Fishing Bait | `FishingBaitSwamp` | biomes | `["Swamp"]` | `["Ocean"]` | Bait is for Ocean fishing (catches Coral Cod). Uses Serpent Trophy |
| 6 | Basic Fireworks | `FireworksRocket_White` | biomes | `["Black Forest"]` | `["Meadows"]` | Sold by Hildir vendor in Meadows |
| 7 | Candle Wick | `CandleWick` | biomes | `["Black Forest"]` | `["Swamp"]` | Sold by The Bog Witch vendor in Swamp |

---

## SECTION 2: MISSING BIOMES (Incomplete data -- biomes need adding) -- Priority: HIGH

These items are missing one or more biomes. Add the listed biome(s) to the existing `biomes` array:

| # | Item | ID | Current Biomes | Add | Reason |
|---|------|----|----------------|-----|--------|
| 8 | Chain | `Chain` | `["Swamp"]` | **Plains, Mistlands** | Found in Sealed Tower chests (Plains) and Dvergr structures (Mistlands) |
| 9 | Leather Scraps | `LeatherScraps` | `["Meadows","Black Forest"]` | **Swamp, Mountain** | Muddy scrap piles in Sunken Crypts (Swamp), Bat drops in Frost Caves (Mountain) |
| 10 | Scrap Iron | `ScrapIron` | `["Swamp","Mountain"]` | **Mistlands** | Ancient Armor/Sword mounds drop scrap iron when mined in Mistlands |
| 11 | Bukeperries | `Bukeperries` | `["Black Forest"]` | **Plains** | Dropped by both Greydwarf Shaman (BF) AND Fuling Shaman (Plains) |
| 12 | Skeleton (creature) | `Skeleton` | `["Meadows","Black Forest","Swamp","Mountain"]` | **Plains** | Post-Bonemass night spawns include Plains. Apply to BOTH Skeleton entries |

> Note: Surtling Core, Surtling creature, and Coal were initially flagged for Ashlands but confirmed incorrect -- Surtlings do NOT spawn in the current Ashlands biome (Feb 2026 release). Ashlands has its own creature roster (Charred, Morgen, Fallen Valkyries, etc.)

---

## SECTION 3: INTERNAL INCONSISTENCIES (Top-level biomes vs worldSources mismatch) -- Priority: MEDIUM

These items have `worldSources[].biomes` data that contradicts their top-level `biomes` array:

| # | Item | ID | Top-level biomes | worldSources biomes | Fix |
|---|------|----|-----------------|---------------------|-----|
| 13 | Stone | `Stone` | Missing Mistlands, Deep North | worldSources has Mistlands rock nodes; also found in Deep North | Add `"Mistlands"` and `"Deep North"` to top-level biomes array |
| 14 | Feathers | `Feathers` | Missing Swamp | worldSources has Sunken Crypt Chest (Swamp) | Add `"Swamp"` to top-level biomes array |
| 15 | Yellow Mushroom | `MushroomYellow` | `["Black Forest","Swamp"]` | worldSources has `["Black Forest","Plains"]` | Fix worldSources biomes: change `"Plains"` to `"Swamp"` |

---

## SECTION 4: FISH worldSources BIOME OFFSET BUG -- Priority: MEDIUM

There is a **systematic bug** in fish `worldSources[].biomes` -- for many fish, the worldSources biome is wrong (appears to be offset by one tier in the extraction pipeline). The top-level `biomes` are correct. Fix each fish's `worldSources[0].biomes` array:

| # | Fish | ID | Top-level (correct) | worldSources (wrong) | Fix worldSources to |
|---|------|----|---------------------|----------------------|---------------------|
| 16 | Northern Salmon | `FishNorthernSalmon` | Deep North | `["Mountain"]` | `["Deep North"]` |
| 17 | Coral Cod | `FishCoralCod` | Ocean | `["Plains"]` | `["Ocean"]` |
| 18 | Trollfish | `FishTrollfish` | Black Forest | `["Mountain"]` | `["Black Forest"]` |
| 19 | Giant Herring | `FishGiantHerring` | Swamp | `["Ocean"]` | `["Swamp"]` |
| 20 | Grouper | `FishGrouper` | Plains | `["Swamp"]` | `["Plains"]` |
| 21 | Pufferfish | `FishPufferfish` | Mistlands | `["Ocean"]` | `["Mistlands"]` |
| 22 | Tetra | `FishTetra` | Mountain | `["Black Forest"]` | `["Mountain"]` |

Fish with correct worldSources (no change needed): Anglerfish, Magmafish, Perch, Pike, Tuna.

> **Root cause note:** This is likely a bug in `convert-dump.cjs` -- the worldSources biome data for fish appears shifted/scrambled during extraction. Worth investigating the pipeline to prevent reoccurrence on next data regeneration.

---

## SECTION 5: SOURCE FIELD CORRECTIONS (Not biome, but found during audit) -- Priority: MEDIUM

These items have incorrect `source` arrays:

| # | Item | ID | Current source | Correct source | Reason |
|---|------|----|---------------|----------------|--------|
| 23 | Basic Fireworks | `FireworksRocket_White` | `["Pickup"]` | `["Vendor"]` | Purchased from Hildir |
| 24 | Candle Wick | `CandleWick` | `["Pickup"]` | `["Vendor"]` | Purchased from Bog Witch |
| 25 | Toadstool | `Toadstool` | `["Foraging"]` | `["Vendor"]` | Purchased from Bog Witch (85 coins) |
| 26 | Love Potion | `LovePotion` | `["Pickup"]` | `["Vendor"]` | Purchased from Bog Witch (110 coins) |
| 27 | Barley Wine Base: Fire Resistance | `BarleyWineBase` | `["Crafting","Foraging"]` | `["Crafting"]` | Pure crafting recipe, no foraging component |
| 28 | Mossy Fishing Bait | `FishingBaitForest` | `["Crafting","Mining"]` | `["Crafting"]` | Pure crafting recipe, no mining component |

---

## SECTION 6: NAMING / DUPLICATE CONCERNS -- Priority: LOW (Requires human review)

> **AI Instructions:** Do NOT auto-apply these changes. Present them to the user for review and await confirmation before making any modifications.

| # | Item | Issue | Suggestion |
|---|------|-------|------------|
| 29 | Dvergr Mage (x4) | Four entries all named "Dvergr Mage" (DvergerMage, DvergerMageIce, DvergerMageFire, DvergerMageSupport) | Consider distinct display names: "Dvergr Fire Mage", "Dvergr Ice Mage", "Dvergr Support Mage" |
| 30 | Dvergr Rogue (Ashlands) | Same name as Mistlands variant but different prefab (DvergerAshlands vs Dverger) | Consider "Ashlands Dvergr Rogue" to disambiguate |
| 31 | Goblin Shaman (Hildir) | GoblinShaman_Hildir uses internal name instead of player-facing name. Separate from regular Fuling Shaman | Consider renaming to distinguish as Hildir miniboss |
| 32 | Thungr | Wiki name is "Zil & Thungr" (duo miniboss) | Consider updating name |
| 33 | Raw Fish (x2) | Two entries: FishAnglerRaw [Mistlands] and FishRaw [Meadows] | Verify both are intentional (different items) |
| 34 | Blue Mushroom | Wiki says unobtainable (console-only). worldSources lists [BF, Swamp, Mountain] | Verify if item should be in dataset at all, or flag as unobtainable |

---

## SECTION 7: ITEMS VERIFIED CORRECT (No changes needed)

The following items were audited and confirmed accurate per the current Valheim release:
- Resin [Meadows, BF], Deer Hide [Meadows, BF, Plains], Flint [Meadows, BF]
- Guck [Swamp], Thistle [BF, Swamp], Wood [Meadows, BF, Swamp, Mountain, Plains]
- Corewood [Meadows, BF, Mountain, Plains], Silver Necklace [Mead, BF, Swamp, Mtn, Plains]
- Coins [all biomes except Ocean], Bear [BF only], Bat [Mountain only]
- Deer [Meadows, BF], Ghost [BF], Rancid Remains [BF]
- Cooked Bear Meat [BF, Plains] (Viles in Plains also drop Bear Meat)
- Bear Meat [BF, Plains], Frosty Fishing Bait [Deep North], Sticky Fishing Bait [Swamp]
- Surtling [Swamp only], Surtling Core [BF, Swamp], Coal [Meadows, BF, Swamp]
- All clothing/vendor items [Meadows], All boss creatures, All Ashlands creatures

---

## SUMMARY

| Category | Count |
|----------|-------|
| Critical biome fixes (wrong biome) | 7 |
| Missing biomes (need adding) | 5 |
| Internal inconsistencies (top vs worldSources) | 3 |
| Fish worldSources offset bug | 7 |
| Source field corrections | 6 |
| Naming/duplicate concerns (human review) | 6 |
| **Total changes** | **34** |

### Recommended execution order:
1. **Sections 1-2** -- user-facing biome errors (12 items)
2. **Section 4** -- fish worldSources bug (7 items)
3. **Section 3** -- internal consistency (3 items)
4. **Section 5** -- source field corrections (6 items)
5. **Section 6** -- naming/duplicates, present to user for review (6 items)
