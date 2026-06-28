// ── Mead / Potion effect descriptions ──────────────────────────────────────
// The game data dump (valheim_data_dump.json) carries item fields but NOT
// status-effect mechanics, so meads ship with empty `stats`. This map fills the
// gap with a plain-language explanation of what each drinkable mead actually
// does — resistance levels, restore amounts, modifiers, durations — keyed by the
// internal prefab id. Values sourced from the Valheim wiki / community data.
//
// Resistance reminder: "Resistant" ≈ −50% of that damage type, "Very Resistant"
// ≈ −75%. Neither is full immunity — the effect still applies, just reduced.
//
// Only drinkable meads are listed; the "MeadBase*" fermenter inputs have no
// effect of their own (they ferment into the matching mead).
export const MEAD_EFFECTS: Record<string, string> = {
  // Healing (restore over ~10s, 2-minute cooldown)
  MeadHealthMinor: "Restores 50 health over 10s. 2-minute cooldown.",
  MeadHealthMedium: "Restores 75 health over 10s. 2-minute cooldown.",
  MeadHealthMajor: "Restores 125 health over 10s. 2-minute cooldown.",
  MeadHealthLingering: "Regenerates health gradually over a long duration (lingering, no burst heal).",

  // Stamina
  MeadStaminaMinor: "Quickly restores a small amount of stamina.",
  MeadStaminaMedium: "Restores 160 stamina and speeds stamina regen for ~2 min.",
  MeadStaminaLingering: "Boosts stamina regeneration over a long duration (lingering).",

  // Eitr
  MeadEitrMinor: "Quickly restores eitr (magic).",
  MeadEitrLingering: "+25% eitr regeneration for ~5 min (lingering).",

  // Regen
  MeadTasty: "Boosts health & stamina regeneration. No cooldown — re-drinkable immediately. (Bog Witch)",

  // Resistances — Resistant ≈ −50% damage, Very Resistant ≈ −75% (NOT immunity)
  BarleyWine: "Resistant to Fire (≈ −50% fire damage) for 10 min.",
  MeadFrostResist: "Resistant to Frost (≈ −50% frost damage); also blocks the Cold & Freezing debuff. 10 min.",
  MeadPoisonResist: "Very Resistant to Poison (≈ −75% poison damage, shorter poison ticks) for 10 min.",

  // Utility
  MeadBugRepellent: "Deathsquitos approach but flee instead of attacking. 10 min. (Anti-Sting Concoction)",
  MeadBzerker: "−80% attack, block & dodge stamina cost, but ×1.5 weakness to Slash/Blunt/Pierce. Lasts 20s, no cooldown.",
  MeadHasty: "+15% movement speed (+7.5% swimming) and +10 Run skill. 10 min. (Tonic of Ratatosk)",
  MeadLightfoot: "−30% jump stamina cost and +20% jump height. 10 min.",
  MeadSwimmer: "−50% swimming stamina drain. ~5 min. (Draught of Vananidir)",
  MeadStrength: "+250 carry weight. ~5 min. (Mead of Troll Endurance)",
  MeadTamer: "Doubles taming speed for nearby creatures. (Brew of Animal Whispers)",
  MeadTrollPheromones:
    "Troll pheromones — boosts Troll spawn rate (≈5%→25%), star chance and max count (1→2). Used to farm Trolls, NOT to repel them. (Love Potion)",
};
