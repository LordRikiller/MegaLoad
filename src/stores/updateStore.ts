import { create } from "zustand";
import {
  checkModUpdates,
  autoUpdateMods,
  type UpdateCheckResult,
} from "../lib/tauri-api";
import { useModStore } from "./modStore";

/** Poll every 5 minutes for mod updates (auto-install if game not running) */
const MOD_POLL_INTERVAL_MS = 5 * 60 * 1000;

interface UpdateState {
  checking: boolean;
  updating: boolean;
  updateResult: UpdateCheckResult | null;
  error: string | null;
  /** True once the first startup check (+ auto-install) has finished */
  startupCheckDone: boolean;
  /** Mod names updated in the most recent update cycle (cleared each check) */
  sessionUpdatedMods: string[];

  /** Check all mods for available updates */
  checkUpdates: (bepinexPath: string, force?: boolean) => Promise<UpdateCheckResult | null>;

  /** Check + auto-install all available updates. Pass force=true to bypass cache. */
  autoUpdate: (bepinexPath: string, force?: boolean) => Promise<UpdateCheckResult | null>;

  /** Start periodic mod update checking (check only, no auto-install) */
  startLiveCheck: (bepinexPath: string) => void;

  /** Stop periodic checking */
  stopLiveCheck: () => void;
}

let modPollTimer: ReturnType<typeof setInterval> | null = null;

export const useUpdateStore = create<UpdateState>((set, get) => ({
  checking: false,
  updating: false,
  updateResult: null,
  error: null,
  startupCheckDone: false,
  sessionUpdatedMods: [],

  checkUpdates: async (bepinexPath: string, force = false) => {
    const { checking, updating } = get();
    if (checking || updating) return null;

    set({ checking: true, error: null });
    try {
      const result = await checkModUpdates(bepinexPath, force);
      set({ updateResult: result, checking: false, sessionUpdatedMods: [] });
      return result;
    } catch (e) {
      set({ error: String(e), checking: false });
      return null;
    }
  },

  autoUpdate: async (bepinexPath: string, force = false) => {
    set({ checking: true, updating: true, error: null });
    try {
      const result = await autoUpdateMods(bepinexPath, force);
      const newlyUpdated = result.mods
        .filter((m) => m.status === "updated")
        .map((m) => m.latest_version ? `${m.name} v${m.latest_version}` : m.name);
      set({
        updateResult: result,
        checking: false,
        updating: false,
        startupCheckDone: true,
        sessionUpdatedMods: newlyUpdated,
      });
      // Refresh mod list so Mods page shows updated versions
      if (newlyUpdated.length > 0) {
        useModStore.getState().fetchMods(bepinexPath);
      }
      return result;
    } catch (e) {
      set({
        error: String(e),
        checking: false,
        updating: false,
        startupCheckDone: true,
      });
      return null;
    }
  },

  startLiveCheck: (bepinexPath: string) => {
    if (modPollTimer) return;
    // Don't do an immediate check — the startup autoUpdate handles that.
    // Periodic poll auto-updates (check + install) so updates land without user action.
    modPollTimer = setInterval(() => {
      get().autoUpdate(bepinexPath);
    }, MOD_POLL_INTERVAL_MS);
  },

  stopLiveCheck: () => {
    if (modPollTimer) {
      clearInterval(modPollTimer);
      modPollTimer = null;
    }
  },
}));
