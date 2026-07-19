// Biome theme catalogue for MegaLoad. Each theme carries three palette
// variants (accent + surface tints) and a set of ambient background
// animations. The animation layer specs are consumed by the canvas engine
// (`engine.ts`); the palette drives the CSS custom properties applied to the
// app root (`apply.ts`). Values are the approved set from the design showroom.

export interface AnimLayer {
  mode: string;
  color: string;
  color2?: string;
  opts?: Record<string, number | boolean>;
}

export interface Anim {
  id: string;
  name: string;
  desc: string;
  layers: AnimLayer[];
}

export interface Palette {
  id: string;
  name: string;
  desc: string;
  /** Base app background (deep). */
  bg: string;
  /** Gradient top stop for the animated backdrop. */
  bg2: string;
  /** Glass panel base colour. */
  panel: string;
  /** Border colour. */
  border: string;
  /** Primary accent (maps to brand-500). */
  accent: string;
  /** Lighter accent (maps to brand-400). */
  accent2: string;
  /** Accent glow, as a full rgba() string. */
  glow: string;
}

export interface Theme {
  id: string;
  name: string;
  tag: string;
  palettes: Palette[];
  anims: Anim[];
}

type Surface = Pick<Palette, "bg" | "bg2" | "panel" | "border">;
type PaletteVariant = Omit<Palette, "bg" | "bg2" | "panel" | "border">;

function theme(
  id: string,
  name: string,
  tag: string,
  base: Surface,
  pals: PaletteVariant[],
  anims: Anim[]
): Theme {
  return { id, name, tag, palettes: pals.map((p) => ({ ...base, ...p })), anims };
}

export const INTENSITIES: Record<string, { c: number; s: number }> = {
  subtle: { c: 0.6, s: 0.85 },
  medium: { c: 1, s: 1 },
  lively: { c: 1.55, s: 1.28 },
};

export const THEMES: Theme[] = [
  theme(
    "default",
    "Default",
    "Norse",
    { bg: "#0a0f1a", bg2: "#0d1424", panel: "#131a2c", border: "#1e2740" },
    [
      { id: "gold", name: "Norse Gold", desc: "The classic MegaLoad look", accent: "#c08a26", accent2: "#d4a03a", glow: "rgba(192,138,38,.35)" },
      { id: "bronze", name: "Bronze Ember", desc: "Warmer, rustier accent", accent: "#b87333", accent2: "#d08a4a", glow: "rgba(184,115,51,.35)" },
      { id: "steel", name: "Steel Frost", desc: "Cool silver-blue accent", accent: "#6f9cc4", accent2: "#9cc2e0", glow: "rgba(111,156,196,.35)" },
    ],
    [
      { id: "none", name: "None", desc: "Still background", layers: [] },
      { id: "embers", name: "Soft Embers", desc: "Faint drifting sparks", layers: [{ mode: "embers", color: "#d4a03a", color2: "#f0c46a", opts: { gentle: true } }] },
      { id: "snow", name: "Soft Snow", desc: "Gentle flurry", layers: [{ mode: "snow", color: "#cdd6e6", opts: { wind: 8, fall: 32 } }] },
    ]
  ),
  theme(
    "meadows",
    "Meadows",
    "Biome",
    { bg: "#0c1610", bg2: "#112318", panel: "#16281c", border: "#264432" },
    [
      { id: "sunlit", name: "Sunlit Meadow", desc: "Fresh honey-green", accent: "#8fc23f", accent2: "#b7e061", glow: "rgba(143,194,63,.35)" },
      { id: "verdant", name: "Verdant", desc: "Deep emerald", accent: "#42a94f", accent2: "#69c96f", glow: "rgba(66,169,79,.35)" },
      { id: "golden", name: "Golden Hour", desc: "Warm afternoon gold", accent: "#cdae44", accent2: "#e6cf6a", glow: "rgba(205,174,68,.35)" },
    ],
    [
      { id: "tree", name: "Swaying Tree", desc: "A birch sways in the breeze", layers: [{ mode: "tree", color: "#bfe07a", color2: "#8fc23f" }] },
      { id: "leaves", name: "Drifting Leaves", desc: "Leaves tumble past", layers: [{ mode: "leaves", color: "#8fc23f", color2: "#cdae44" }] },
      { id: "pollen", name: "Floating Pollen", desc: "Golden motes adrift", layers: [{ mode: "spores", color: "#e6d98a" }] },
    ]
  ),
  theme(
    "blackforest",
    "Black Forest",
    "Biome",
    { bg: "#0a140f", bg2: "#0c1712", panel: "#101d16", border: "#1c3326" },
    [
      { id: "pine", name: "Pine Shadow", desc: "Burnished copper", accent: "#b5893f", accent2: "#d3a862", glow: "rgba(181,137,63,.3)" },
      { id: "mushroom", name: "Mushroom Cap", desc: "Muted troll-red", accent: "#a4553f", accent2: "#c47a5f", glow: "rgba(164,85,63,.3)" },
      { id: "moonlit", name: "Moonlit Pine", desc: "Cool teal-green", accent: "#5a9d7a", accent2: "#7fc3a0", glow: "rgba(90,157,122,.3)" },
    ],
    [
      { id: "fireflies", name: "Fireflies", desc: "Warm glimmers weave", layers: [{ mode: "fireflies", color: "#f0c46a", color2: "#ffe6a0" }] },
      { id: "thistle", name: "Thistle Drift", desc: "Blue thistle seeds adrift", layers: [{ mode: "spores", color: "#84b4e6" }] },
      { id: "mist", name: "Creeping Mist", desc: "Layered fog seeps through", layers: [{ mode: "mist", color: "#9ab4a4" }] },
    ]
  ),
  theme(
    "swamp",
    "Swamp",
    "Biome",
    { bg: "#0c130f", bg2: "#0e1712", panel: "#131f18", border: "#233a2a" },
    [
      { id: "bog", name: "Bog Green", desc: "Sickly marsh green", accent: "#8faa3c", accent2: "#acca5b", glow: "rgba(143,170,60,.3)" },
      { id: "rot", name: "Rotten Amber", desc: "Murky bog-gold", accent: "#b0932f", accent2: "#ccb04a", glow: "rgba(176,147,47,.3)" },
      { id: "draugr", name: "Draugr Teal", desc: "Poison-mist teal", accent: "#46a58a", accent2: "#6cc4a8", glow: "rgba(70,165,138,.3)" },
    ],
    [
      { id: "rain", name: "Rainfall", desc: "Steady drizzle", layers: [{ mode: "rain", color: "#9fb8c4", opts: {} }] },
      { id: "heavy", name: "Heavy Downpour", desc: "It buckets down", layers: [{ mode: "rain", color: "#a6bfcc", opts: { heavy: true } }] },
      { id: "ripples", name: "Rain & Ripples", desc: "Drops break the surface", layers: [{ mode: "rain", color: "#9fb8c4", opts: { ripples: true } }] },
    ]
  ),
  theme(
    "mountain",
    "Mountain",
    "Biome",
    { bg: "#0b1420", bg2: "#0e1a2a", panel: "#132234", border: "#25405c" },
    [
      { id: "frost", name: "Frostbite", desc: "Icy cyan", accent: "#5fb6d4", accent2: "#8fd4ec", glow: "rgba(95,182,212,.4)" },
      { id: "silver", name: "Silver Peak", desc: "Pale silver-white", accent: "#a9c0d4", accent2: "#d6e4ef", glow: "rgba(169,192,212,.4)" },
      { id: "wolf", name: "Wolf Dusk", desc: "Cold violet-blue", accent: "#7a8fd0", accent2: "#9fb2e6", glow: "rgba(122,143,208,.4)" },
    ],
    [
      { id: "blizzard", name: "Blizzard", desc: "Snow driven sideways", layers: [{ mode: "snow", color: "#dbe8f5", opts: { wind: 150, gust: 70, streak: true, fall: 190, dense: true } }] },
      { id: "gentle", name: "Gentle Snow", desc: "Soft, slow flakes", layers: [{ mode: "snow", color: "#e6f0fa", opts: { wind: 10, fall: 34 } }] },
      { id: "gusts", name: "Wind Gusts", desc: "Squalls come and go", layers: [{ mode: "snow", color: "#dbe8f5", opts: { wind: 55, gust: 120, streak: true, fall: 120 } }] },
    ]
  ),
  theme(
    "plains",
    "Plains",
    "Biome",
    { bg: "#17130a", bg2: "#1c160b", panel: "#211a0e", border: "#3d3016" },
    [
      { id: "wheat", name: "Wheatfield", desc: "Sun-bleached gold", accent: "#d8b04a", accent2: "#ecc86a", glow: "rgba(216,176,74,.4)" },
      { id: "fuling", name: "Fuling Bronze", desc: "Warm burnt bronze", accent: "#c08a3e", accent2: "#dba55c", glow: "rgba(192,138,62,.4)" },
      { id: "savanna", name: "Savanna Dusk", desc: "Burnt-orange evening", accent: "#cf7d3a", accent2: "#e59a56", glow: "rgba(207,125,58,.4)" },
    ],
    [
      { id: "grass", name: "Swaying Grass", desc: "Tall grass ripples", layers: [{ mode: "grass", color: "#d8b04a", color2: "#8a7328", opts: { sway: 1 } }] },
      { id: "wind", name: "Wind Waves", desc: "Wind rolls across", layers: [{ mode: "grass", color: "#d8b04a", color2: "#8a7328", opts: { sway: 2.1, speed: 1.7 } }] },
      { id: "seeds", name: "Drifting Seeds", desc: "Seed-fluff floats by", layers: [{ mode: "spores", color: "#ecc86a" }] },
    ]
  ),
  theme(
    "mistlands",
    "Mistlands",
    "Biome",
    { bg: "#0d0a18", bg2: "#120d22", panel: "#181028", border: "#31244c" },
    [
      { id: "wisp", name: "Wisp Violet", desc: "Ethereal purple glow", accent: "#9b7fd4", accent2: "#bda3ec", glow: "rgba(155,127,212,.42)" },
      { id: "dvergr", name: "Dvergr Lantern", desc: "Cool lantern blue", accent: "#5a86d0", accent2: "#7fa8ec", glow: "rgba(90,134,208,.4)" },
      { id: "seeker", name: "Seeker Amber", desc: "Eerie amber in gloom", accent: "#b89a4a", accent2: "#d4b96a", glow: "rgba(184,154,74,.4)" },
    ],
    [
      { id: "rolling", name: "Rolling Mist", desc: "Thick violet fog drifts", layers: [{ mode: "mist", color: "#a79bc6" }] },
      { id: "wisps", name: "Floating Wisps", desc: "Blue wisps drift, as in-game", layers: [{ mode: "wisps", color: "#4aa6f0", color2: "#c4e8ff" }] },
      { id: "both", name: "Mist & Wisps", desc: "Violet fog, blue wisps", layers: [{ mode: "mist", color: "#a79bc6" }, { mode: "wisps", color: "#4aa6f0", color2: "#c4e8ff" }] },
    ]
  ),
  theme(
    "ashlands",
    "Ashlands",
    "Biome",
    { bg: "#16090a", bg2: "#1c0b0a", panel: "#200e0c", border: "#3d1a12" },
    [
      { id: "ember", name: "Ember", desc: "Glowing coal-orange", accent: "#e2622a", accent2: "#f5904a", glow: "rgba(226,98,42,.5)" },
      { id: "molten", name: "Molten Core", desc: "White-hot orange", accent: "#f0902a", accent2: "#ffb84a", glow: "rgba(240,144,42,.5)" },
      { id: "crimson", name: "Charred Crimson", desc: "Deep smouldering red", accent: "#cf3a30", accent2: "#e5675c", glow: "rgba(207,58,48,.5)" },
    ],
    [
      { id: "embers", name: "Rising Embers", desc: "Sparks float upward", layers: [{ mode: "embers", color: "#f5904a", color2: "#ffd27a" }] },
      { id: "ash", name: "Ashfall", desc: "Grey ash drifts down", layers: [{ mode: "snow", color: "#b9a99a", opts: { wind: 12, fall: 26 } }] },
      { id: "glow", name: "Ember Glow", desc: "Sparks over a fire-glow", layers: [{ mode: "embers", color: "#f5904a", color2: "#ffd27a", opts: { glowBottom: true } }] },
    ]
  ),
  theme(
    "deepnorth",
    "Deep North",
    "Biome",
    { bg: "#0a1622", bg2: "#0c1b2c", panel: "#10243a", border: "#24455f" },
    [
      { id: "glacier", name: "Glacier", desc: "Pale ice-blue", accent: "#8fcfe6", accent2: "#c4ecf5", glow: "rgba(143,207,230,.4)" },
      { id: "aurora", name: "Aurora", desc: "Northern-lights green", accent: "#5fd8a2", accent2: "#98f0c6", glow: "rgba(95,216,162,.4)" },
      { id: "polar", name: "Polar Night", desc: "Cold aurora violet", accent: "#9d9fe0", accent2: "#bcbef0", glow: "rgba(157,159,224,.4)" },
    ],
    [
      { id: "snow", name: "Snowfall", desc: "Endless soft snow", layers: [{ mode: "snow", color: "#eaf4ff", opts: { wind: 14, fall: 36 } }] },
      { id: "aurora", name: "Aurora Shimmer", desc: "Curtains of light ripple", layers: [{ mode: "aurora", color: "#5fe6a0", color2: "#b07fe0" }, { mode: "snow", color: "#eaf4ff", opts: { wind: 8, fall: 26 } }] },
      { id: "both", name: "Snow & Aurora", desc: "Full frozen sky", layers: [{ mode: "aurora", color: "#6fe6b0", color2: "#c08fe8", opts: { strong: true } }, { mode: "snow", color: "#eaf4ff", opts: { wind: 16, fall: 40 } }] },
    ]
  ),
  theme(
    "ocean",
    "Ocean",
    "Water",
    { bg: "#071620", bg2: "#08202e", panel: "#0c2636", border: "#1c4a5f" },
    [
      { id: "seafoam", name: "Seafoam", desc: "Bright turquoise", accent: "#3fb8c4", accent2: "#6fdce6", glow: "rgba(63,184,196,.4)" },
      { id: "abyss", name: "Abyss", desc: "Deep ocean blue", accent: "#2f7fb0", accent2: "#55a6d6", glow: "rgba(47,127,176,.4)" },
      { id: "serpent", name: "Serpent Green", desc: "Kelp-forest green", accent: "#3fb88a", accent2: "#6fd8ab", glow: "rgba(63,184,138,.4)" },
    ],
    [
      { id: "ripples", name: "Caustic Ripples", desc: "Light ripples & rising bubbles", layers: [{ mode: "ripples", color: "#4fd0e0", color2: "#cff8ff" }, { mode: "bubbles", color: "#dff4f6" }] },
      { id: "kelp", name: "Kelp Drift", desc: "Kelp sways in the current", layers: [{ mode: "kelp", color: "#2f9f8a", color2: "#7fe0c0" }, { mode: "bubbles", color: "#dff4f6" }, { mode: "motes", color: "#bfe4ec" }] },
      { id: "bubbles", name: "Rising Bubbles", desc: "Bubbles ascend through the drift", layers: [{ mode: "bubbles", color: "#e4f6f8", opts: { dense: true } }, { mode: "motes", color: "#cfeef2" }] },
    ]
  ),
];

export function findThemeIndex(id: string): number {
  const i = THEMES.findIndex((t) => t.id === id);
  return i < 0 ? 0 : i;
}
