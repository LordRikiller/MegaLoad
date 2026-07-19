// Theme resolution + application. Converts a selected palette into the CSS
// custom properties that back the tailwind `brand`/`zinc` ramps, and owns the
// localStorage-persisted user preferences. Kept framework-agnostic so it can
// run before React paints (see main.tsx) to avoid a theme flash.

import { THEMES, findThemeIndex, type Palette, type Theme, type Anim } from "./themes";

export type Intensity = "subtle" | "medium" | "lively";

export interface ThemePrefs {
  theme: string;
  palette: number;
  anim: number;
  motion: boolean;
  intensity: Intensity;
  /** Opt-in: sync the theme choice across devices via cloud sync. Off by default. */
  sync: boolean;
}

export const DEFAULT_PREFS: ThemePrefs = {
  theme: "default",
  palette: 0,
  anim: 0,
  motion: true,
  intensity: "medium",
  sync: false,
};

const STORAGE_KEY = "megaload_theme";

// --- colour maths ---------------------------------------------------------

type RGB = [number, number, number];
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

function toRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
const triplet = (c: RGB) => `${c[0]} ${c[1]} ${c[2]}`;

// --- resolution -----------------------------------------------------------

function clamp(n: number, max: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > max ? max : Math.floor(n);
}

export function resolveTheme(prefs: ThemePrefs): Theme {
  return THEMES[findThemeIndex(prefs.theme)];
}
export function resolvePalette(prefs: ThemePrefs): Palette {
  const t = resolveTheme(prefs);
  return t.palettes[clamp(prefs.palette, t.palettes.length - 1)];
}
export function resolveAnim(prefs: ThemePrefs): Anim {
  const t = resolveTheme(prefs);
  return t.anims[clamp(prefs.anim, t.anims.length - 1)];
}

// --- application ----------------------------------------------------------

/** Write the palette's colours into the CSS custom properties the tailwind
 *  ramps read. The `brand` ramp is generated from the accent; `zinc`
 *  base/panel/border surfaces come straight from the palette. Text-tier zinc
 *  stops are left at their neutral defaults so contrast never regresses. */
export function applyThemeVars(pal: Palette): void {
  const s = document.documentElement.style;
  const acc = toRgb(pal.accent);
  const acc2 = toRgb(pal.accent2);

  // Accent ramp — shade toward black for the deep stops, tint toward white
  // for the light stops, anchored on 500 (accent) and 400 (accent2).
  s.setProperty("--ml-brand-500", triplet(acc));
  s.setProperty("--ml-brand-400", triplet(acc2));
  s.setProperty("--ml-brand-600", triplet(mix(acc, BLACK, 0.16)));
  s.setProperty("--ml-brand-700", triplet(mix(acc, BLACK, 0.30)));
  s.setProperty("--ml-brand-800", triplet(mix(acc, BLACK, 0.44)));
  s.setProperty("--ml-brand-900", triplet(mix(acc, BLACK, 0.55)));
  s.setProperty("--ml-brand-950", triplet(mix(acc, BLACK, 0.72)));
  s.setProperty("--ml-brand-300", triplet(mix(acc2, WHITE, 0.18)));
  s.setProperty("--ml-brand-200", triplet(mix(acc2, WHITE, 0.42)));
  s.setProperty("--ml-brand-100", triplet(mix(acc2, WHITE, 0.66)));
  s.setProperty("--ml-brand-50", triplet(mix(acc2, WHITE, 0.85)));

  // Surface ramp — only the deep three stops are themed.
  s.setProperty("--ml-zinc-950", triplet(toRgb(pal.bg)));
  s.setProperty("--ml-zinc-900", triplet(toRgb(pal.panel)));
  s.setProperty("--ml-zinc-800", triplet(toRgb(pal.border)));

  // Accent glow used by .glow-brand (full rgba string).
  s.setProperty("--ml-glow", pal.glow);
}

export function applyPrefs(prefs: ThemePrefs): void {
  applyThemeVars(resolvePalette(prefs));
  document.documentElement.setAttribute("data-biome", resolveTheme(prefs).id);
}

// --- persistence ----------------------------------------------------------

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function loadPrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFS, motion: !prefersReducedMotion() };
    }
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
    const intensity: Intensity =
      parsed.intensity === "subtle" || parsed.intensity === "lively" ? parsed.intensity : "medium";
    return {
      theme: typeof parsed.theme === "string" ? parsed.theme : DEFAULT_PREFS.theme,
      palette: typeof parsed.palette === "number" ? parsed.palette : 0,
      anim: typeof parsed.anim === "number" ? parsed.anim : 0,
      motion: typeof parsed.motion === "boolean" ? parsed.motion : true,
      intensity,
      sync: parsed.sync === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ThemePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — non-fatal, theme stays for the session */
  }
}

/** Apply the persisted theme before React mounts. Safe to call at module load. */
export function bootTheme(): void {
  applyPrefs(loadPrefs());
}
