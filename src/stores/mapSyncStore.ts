import { create } from "zustand";
import { mapSync } from "../lib/tauri-api";
import type { MapSyncReport } from "../lib/tauri-api";
import { debugLog } from "../lib/debug";

/** World Map cloud sync status, shared by the startup sync (AppShell) and the
 *  World Map page so both show the same thing and never run two at once. */
interface MapSyncState {
  status: "idle" | "syncing" | "ok" | "off" | "error";
  detail: string;
  lastAt: number | null;
  /** Bumped whenever a sync changed the installed worlds or marks, so the page
   *  knows to reload. */
  revision: number;
  run: () => Promise<MapSyncReport | null>;
}

export const useMapSyncStore = create<MapSyncState>((set, get) => ({
  status: "idle",
  detail: "",
  lastAt: null,
  revision: 0,

  run: async () => {
    if (get().status === "syncing") return null;
    set({ status: "syncing", detail: "Syncing maps…" });
    try {
      const r = await mapSync();
      if (r.skipped) {
        set({ status: r.skipped.startsWith("Cloud sync is off") ? "off" : "idle", detail: r.skipped });
        return r;
      }
      const changed = r.pulled.length + r.removed.length > 0 || r.marksChanged;
      const parts = [
        r.pulled.length && `${r.pulled.length} downloaded`,
        r.pushed.length && `${r.pushed.length} uploaded`,
        r.removed.length && `${r.removed.length} removed`,
      ].filter(Boolean);
      set((s) => ({
        status: "ok",
        detail: parts.length ? `Maps synced: ${parts.join(", ")}` : "Maps up to date",
        lastAt: Date.now(),
        revision: changed ? s.revision + 1 : s.revision,
      }));
      debugLog("[map-sync]", r);
      return r;
    } catch (e) {
      console.warn("map sync failed", e);
      set({ status: "error", detail: String(e) });
      return null;
    }
  },
}));
