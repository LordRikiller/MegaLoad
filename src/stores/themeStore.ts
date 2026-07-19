import { create } from "zustand";
import {
  loadPrefs,
  savePrefs,
  applyPrefs,
  type ThemePrefs,
  type Intensity,
} from "../theme/apply";
import { findThemeIndex, THEMES } from "../theme/themes";
import { syncPullTheme, syncPushTheme } from "../lib/tauri-api";

interface ThemeState extends ThemePrefs {
  setTheme: (id: string) => void;
  setPalette: (i: number) => void;
  setAnim: (i: number) => void;
  setMotion: (m: boolean) => void;
  setIntensity: (v: Intensity) => void;
  setSync: (on: boolean) => Promise<void>;
  /** Pull the cloud theme and adopt it (no-op if theme sync is off or none exists). */
  pullThemeFromCloud: () => Promise<void>;
}

/** Push the theme to the cloud when theme sync is enabled. Fire-and-forget:
 *  errors (including "cloud sync not enabled") are swallowed — theme sync is a
 *  best-effort convenience layered on top of the profile sync. */
function pushToCloud(prefs: ThemePrefs) {
  if (!prefs.sync) return;
  const blob = JSON.stringify({
    theme: prefs.theme,
    palette: prefs.palette,
    anim: prefs.anim,
    motion: prefs.motion,
    intensity: prefs.intensity,
    updated_at: new Date().toISOString(),
  });
  syncPushTheme(blob).catch((e) => console.warn("[MegaLoad] theme push:", e));
}

function pick(s: ThemePrefs): ThemePrefs {
  return {
    theme: s.theme,
    palette: s.palette,
    anim: s.anim,
    motion: s.motion,
    intensity: s.intensity,
    sync: s.sync,
  };
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = loadPrefs();

  const commit = (patch: Partial<ThemePrefs>, push = true) => {
    const prefs = pick({ ...get(), ...patch } as ThemePrefs);
    applyPrefs(prefs);
    savePrefs(prefs);
    set(patch);
    if (push) pushToCloud(prefs);
  };

  return {
    ...initial,

    setTheme: (id) => {
      const idx = findThemeIndex(id);
      // Selecting a biome resets its palette + animation to the first (signature) option.
      commit({ theme: THEMES[idx].id, palette: 0, anim: 0 });
    },
    setPalette: (i) => commit({ palette: i }),
    setAnim: (i) => commit({ anim: i }),
    setMotion: (m) => commit({ motion: m }),
    setIntensity: (v) => commit({ intensity: v }),

    setSync: async (on) => {
      commit({ sync: on }, false);
      if (on) {
        // Adopt an existing cloud theme; if none exists yet, seed it with ours.
        await get().pullThemeFromCloud();
        pushToCloud(pick(get()));
      }
    },

    pullThemeFromCloud: async () => {
      if (!get().sync) return;
      try {
        const raw = await syncPullTheme();
        const remote = JSON.parse(raw);
        if (remote && typeof remote === "object" && typeof remote.theme === "string") {
          const intensity: Intensity =
            remote.intensity === "subtle" || remote.intensity === "lively" || remote.intensity === "medium"
              ? remote.intensity
              : get().intensity;
          commit(
            {
              theme: remote.theme,
              palette: typeof remote.palette === "number" ? remote.palette : 0,
              anim: typeof remote.anim === "number" ? remote.anim : 0,
              motion: typeof remote.motion === "boolean" ? remote.motion : get().motion,
              intensity,
            },
            false
          );
        }
      } catch (e) {
        console.warn("[MegaLoad] theme pull:", e);
      }
    },
  };
});
