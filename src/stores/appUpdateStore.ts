import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type AppUpdateStatus =
  | "idle"
  | "checking"
  | "update-available"
  | "downloading"
  | "ready"
  | "error";

interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  newVersion: string | null;
  downloadProgress: number; // 0-100
  error: string | null;
  pendingUpdate: Update | null;

  checkForAppUpdate: () => Promise<void>;
  installAndRelaunch: () => Promise<void>;
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  status: "idle",
  currentVersion: "0.2.0",
  newVersion: null,
  downloadProgress: 0,
  error: null,
  pendingUpdate: null,

  checkForAppUpdate: async () => {
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({
          status: "update-available",
          newVersion: update.version,
          pendingUpdate: update,
        });
      } else {
        set({ status: "idle" });
      }
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  installAndRelaunch: async () => {
    const { pendingUpdate } = get();
    if (!pendingUpdate) return;

    set({ status: "downloading", downloadProgress: 0 });
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            if (totalBytes > 0) {
              set({
                downloadProgress: Math.round(
                  (downloadedBytes / totalBytes) * 100
                ),
              });
            }
            break;
          case "Finished":
            set({ status: "ready", downloadProgress: 100 });
            break;
        }
      });

      // Relaunch the app
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));
