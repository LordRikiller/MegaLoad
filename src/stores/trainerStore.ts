import { create } from "zustand";
import {
  getTrainerCheats,
  toggleTrainerCheat,
  saveTrainerProfile,
  loadTrainerProfile,
  deleteTrainerProfile,
  getTrainerProfiles,
  resetTrainer,
  type CheatDef,
  type SavedTrainerProfile,
} from "../lib/tauri-api";

interface TrainerState {
  cheats: CheatDef[];
  savedProfiles: SavedTrainerProfile[];
  loading: boolean;
  error: string | null;

  fetchCheats: (bepinexPath: string) => Promise<void>;
  toggle: (bepinexPath: string, cheatId: string, enabled: boolean) => Promise<void>;
  saveProfile: (bepinexPath: string, name: string) => Promise<void>;
  loadProfile: (bepinexPath: string, name: string) => Promise<void>;
  deleteProfile: (bepinexPath: string, name: string) => Promise<void>;
  fetchProfiles: (bepinexPath: string) => Promise<void>;
  reset: (bepinexPath: string) => Promise<void>;
}

export const useTrainerStore = create<TrainerState>((set, _get) => ({
  cheats: [],
  savedProfiles: [],
  loading: false,
  error: null,

  fetchCheats: async (bepinexPath: string) => {
    set({ loading: true, error: null });
    try {
      const [cheats, profiles] = await Promise.all([
        getTrainerCheats(bepinexPath),
        getTrainerProfiles(bepinexPath),
      ]);
      set({ cheats, savedProfiles: profiles, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  toggle: async (bepinexPath: string, cheatId: string, enabled: boolean) => {
    // Optimistic update
    set((s) => ({
      cheats: s.cheats.map((c) =>
        c.id === cheatId ? { ...c, enabled } : c
      ),
    }));
    try {
      await toggleTrainerCheat(bepinexPath, cheatId, enabled);
    } catch (e) {
      // Revert on failure
      set((s) => ({
        cheats: s.cheats.map((c) =>
          c.id === cheatId ? { ...c, enabled: !enabled } : c
        ),
        error: String(e),
      }));
    }
  },

  saveProfile: async (bepinexPath: string, name: string) => {
    await saveTrainerProfile(bepinexPath, name);
    const profiles = await getTrainerProfiles(bepinexPath);
    set({ savedProfiles: profiles });
  },

  loadProfile: async (bepinexPath: string, name: string) => {
    const cheats = await loadTrainerProfile(bepinexPath, name);
    set({ cheats });
  },

  deleteProfile: async (bepinexPath: string, name: string) => {
    await deleteTrainerProfile(bepinexPath, name);
    const profiles = await getTrainerProfiles(bepinexPath);
    set({ savedProfiles: profiles });
  },

  fetchProfiles: async (bepinexPath: string) => {
    const profiles = await getTrainerProfiles(bepinexPath);
    set({ savedProfiles: profiles });
  },

  reset: async (bepinexPath: string) => {
    await resetTrainer(bepinexPath);
    const cheats = await getTrainerCheats(bepinexPath);
    set({ cheats });
  },
}));
