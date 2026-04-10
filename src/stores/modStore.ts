import { create } from "zustand";
import {
  getMods,
  toggleMod as apiToggle,
  deleteMod as apiDelete,
  type ModInfo,
} from "../lib/tauri-api";
import { useSyncStore } from "./syncStore";

interface ModState {
  mods: ModInfo[];
  loading: boolean;
  error: string | null;
  fetchMods: (bepinexPath: string) => Promise<void>;
  toggleMod: (
    bepinexPath: string,
    folder: string,
    fileName: string,
    enable: boolean
  ) => Promise<void>;
  deleteMod: (
    bepinexPath: string,
    folder: string,
    fileName: string,
    enabled: boolean
  ) => Promise<void>;
}

export const useModStore = create<ModState>((set) => ({
  mods: [],
  loading: false,
  error: null,

  fetchMods: async (bepinexPath: string) => {
    set({ loading: true, error: null });
    try {
      const mods = await getMods(bepinexPath);
      set({ mods, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  toggleMod: async (
    bepinexPath: string,
    folder: string,
    fileName: string,
    enable: boolean
  ) => {
    await apiToggle(bepinexPath, folder, fileName, enable);
    // Refresh mod list
    const mods = await getMods(bepinexPath);
    set({ mods });
    // Trigger cloud sync
    useSyncStore.getState().triggerAutoSync();
  },

  deleteMod: async (
    bepinexPath: string,
    folder: string,
    fileName: string,
    enabled: boolean
  ) => {
    await apiDelete(bepinexPath, folder, fileName, enabled);
    const mods = await getMods(bepinexPath);
    set({ mods });
    // Trigger cloud sync
    useSyncStore.getState().triggerAutoSync();
  },
}));
