import { create } from "zustand";
import {
  searchThunderstore,
  getThunderstoreCategories,
  getInstalledThunderstoreMods,
  installThunderstoreMod,
  updateThunderstoreMod,
  uninstallThunderstoreMod,
  type ThunderstoreListItem,
  type InstalledTsMod,
} from "../lib/tauri-api";
import { useSyncStore } from "./syncStore";

interface ThunderstoreState {
  items: ThunderstoreListItem[];
  total: number;
  page: number;
  perPage: number;
  query: string;
  category: string;
  categories: string[];
  loading: boolean;
  error: string | null;
  installedMods: InstalledTsMod[];
  installing: Set<string>; // full_names currently being installed

  search: (query?: string, category?: string, page?: number) => Promise<void>;
  loadCategories: () => Promise<void>;
  loadInstalledMods: (bepinexPath: string) => Promise<void>;
  install: (
    bepinexPath: string,
    item: ThunderstoreListItem
  ) => Promise<string>;
  update: (
    bepinexPath: string,
    fullName: string,
    downloadUrl: string,
    version: string,
    folderName: string
  ) => Promise<string>;
  uninstall: (bepinexPath: string, fullName: string) => Promise<void>;
  setQuery: (query: string) => void;
  setCategory: (category: string) => void;
  nextPage: () => void;
  prevPage: () => void;
}

export const useThunderstoreStore = create<ThunderstoreState>((set, get) => ({
  items: [],
  total: 0,
  page: 0,
  perPage: 20,
  query: "",
  category: "",
  categories: [],
  loading: false,
  error: null,
  installedMods: [],
  installing: new Set(),

  search: async (query?: string, category?: string, page?: number) => {
    const q = query ?? get().query;
    const c = category ?? get().category;
    const p = page ?? 0;
    set({ loading: true, error: null, query: q, category: c, page: p });
    try {
      const result = await searchThunderstore(
        q || undefined,
        c || undefined,
        p,
        get().perPage
      );
      set({ items: result.items, total: result.total, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadCategories: async () => {
    try {
      const cats = await getThunderstoreCategories();
      set({ categories: cats });
    } catch {
      // non-critical
    }
  },

  loadInstalledMods: async (bepinexPath: string) => {
    try {
      const mods = await getInstalledThunderstoreMods(bepinexPath);
      set({ installedMods: mods });
    } catch {
      // non-critical
    }
  },

  install: async (bepinexPath: string, item: ThunderstoreListItem) => {
    set((s) => {
      const next = new Set(s.installing);
      next.add(item.full_name);
      return { installing: next };
    });
    try {
      // Need to get the download URL from the detail
      const { getThunderstoreDetail } = await import("../lib/tauri-api");
      const detail = await getThunderstoreDetail(item.full_name);
      const latest = detail.versions[0];
      const result = await installThunderstoreMod(
        bepinexPath,
        item.full_name,
        latest.download_url,
        latest.version_number
      );
      // Refresh installed list
      await get().loadInstalledMods(bepinexPath);
      useSyncStore.getState().triggerAutoSync();
      return result;
    } finally {
      set((s) => {
        const next = new Set(s.installing);
        next.delete(item.full_name);
        return { installing: next };
      });
    }
  },

  update: async (
    bepinexPath: string,
    fullName: string,
    downloadUrl: string,
    version: string,
    folderName: string
  ) => {
    set((s) => {
      const next = new Set(s.installing);
      next.add(fullName);
      return { installing: next };
    });
    try {
      const result = await updateThunderstoreMod(
        bepinexPath,
        fullName,
        downloadUrl,
        version,
        folderName
      );
      await get().loadInstalledMods(bepinexPath);
      useSyncStore.getState().triggerAutoSync();
      return result;
    } finally {
      set((s) => {
        const next = new Set(s.installing);
        next.delete(fullName);
        return { installing: next };
      });
    }
  },

  uninstall: async (bepinexPath: string, fullName: string) => {
    await uninstallThunderstoreMod(bepinexPath, fullName);
    await get().loadInstalledMods(bepinexPath);
    useSyncStore.getState().triggerAutoSync();
  },

  setQuery: (query: string) => set({ query }),
  setCategory: (category: string) => set({ category }),

  nextPage: () => {
    const { page, perPage, total } = get();
    if ((page + 1) * perPage < total) {
      get().search(undefined, undefined, page + 1);
    }
  },

  prevPage: () => {
    const { page } = get();
    if (page > 0) {
      get().search(undefined, undefined, page - 1);
    }
  },
}));
