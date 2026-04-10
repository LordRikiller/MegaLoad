import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { logFromFrontend, recordAppUpdate } from "../lib/tauri-api";

/** Poll every 5 minutes for app updates */
const APP_POLL_INTERVAL_MS = 5 * 60 * 1000;

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
  startLiveCheck: () => void;
  stopLiveCheck: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  status: "idle",
  currentVersion: "1.3.1",
  newVersion: null,
  downloadProgress: 0,
  error: null,
  pendingUpdate: null,

  checkForAppUpdate: async () => {
    const { status } = get();
    // Don't interrupt an active download or re-check if already checking
    if (status === "downloading" || status === "ready" || status === "checking")
      return;

    set({ status: "checking", error: null });
    try {
      logFromFrontend("App update check started").catch(() => {});
      const update = await check();
      if (update) {
        logFromFrontend(`App update found: v${update.version}`).catch(() => {});
        set({
          status: "update-available",
          newVersion: update.version,
          pendingUpdate: update,
        });
      } else {
        logFromFrontend("App update check: up to date").catch(() => {});
        set({ status: "idle" });
      }
    } catch (e) {
      logFromFrontend(`App update check failed: ${e}`).catch(() => {});
      set({ status: "error", error: String(e) });
    }
  },

  installAndRelaunch: async () => {
    const { pendingUpdate } = get();
    if (!pendingUpdate) return;

    set({ status: "downloading", downloadProgress: 0 });
    try {
      logFromFrontend(`Downloading app update v${pendingUpdate.version}`).catch(() => {});
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
            recordAppUpdate(get().currentVersion, pendingUpdate.version).catch(() => {});
            break;
        }
      });

      // Relaunch the app
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  startLiveCheck: () => {
    if (pollTimer) return;
    // Immediate check on start
    get().checkForAppUpdate();
    // Then poll every 5 minutes
    pollTimer = setInterval(() => {
      get().checkForAppUpdate();
    }, APP_POLL_INTERVAL_MS);
  },

  stopLiveCheck: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
