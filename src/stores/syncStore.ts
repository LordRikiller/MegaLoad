import { create } from "zustand";
import {
  syncSetEnabled,
  syncSetAutoSync,
  syncPushAll,
  syncPullManifest,
  syncPullBundle,
  syncPullProfileState,
  syncCheckRemoteChanged,
  syncGetSettings,
  syncInstallAllMods,
  syncInstallThunderstoreMods,
  type SyncProfileEntry,
} from "../lib/tauri-api";
import { useProfileStore } from "./profileStore";
import { useToastStore } from "./toastStore";

interface SyncState {
  // State
  enabled: boolean;
  autoSync: boolean;
  syncing: boolean;
  syncProgress: string | null;
  lastPush: string | null;
  lastPull: string | null;
  error: string | null;
  remoteProfiles: SyncProfileEntry[];
  loaded: boolean;

  // Actions
  fetchSyncStatus: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setAutoSync: (autoSync: boolean) => Promise<void>;
  pushAllProfiles: () => Promise<void>;
  pullAllProfiles: () => Promise<void>;
  checkForRemoteChanges: () => Promise<boolean>;
  triggerAutoSync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  enabled: false,
  autoSync: true,
  syncing: false,
  syncProgress: null,
  lastPush: null,
  lastPull: null,
  error: null,
  remoteProfiles: [],
  loaded: false,

  fetchSyncStatus: async () => {
    try {
      const settings = await syncGetSettings();
      set({
        enabled: settings.enabled,
        autoSync: settings.auto_sync,
        lastPush: settings.last_push,
        lastPull: settings.last_pull,
        loaded: true,
        error: null,
      });

      if (settings.enabled) {
        try {
          const manifest = await syncPullManifest();
          set({ remoteProfiles: manifest.profiles });
        } catch {
          // Remote manifest might not exist yet
        }
      }
    } catch (e) {
      set({ error: String(e), loaded: true });
    }
  },

  setEnabled: async (enabled: boolean) => {
    try {
      await syncSetEnabled(enabled);
      set({ enabled, error: null });

      if (enabled) {
        setTimeout(() => get().pushAllProfiles(), 500);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setAutoSync: async (autoSync: boolean) => {
    try {
      await syncSetAutoSync(autoSync);
      set({ autoSync, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  pushAllProfiles: async () => {
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const profileStore = useProfileStore.getState();
    const profiles = profileStore.profiles;
    if (profiles.length === 0) return;

    set({ syncing: true, syncProgress: `Pushing ${profiles.length} profile${profiles.length !== 1 ? "s" : ""}...`, error: null });
    try {
      const pushData = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        bepinex_path: p.bepinex_path,
        is_active: p.id === profileStore.activeProfileId,
        is_linked: false,
      }));
      await syncPushAll(JSON.stringify(pushData));
      set({ syncing: false, syncProgress: null, lastPush: new Date().toISOString() });
    } catch (e) {
      set({ syncing: false, syncProgress: null, error: String(e) });
    }
  },

  pullAllProfiles: async () => {
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const addToast = useToastStore.getState().addToast;
    set({ syncing: true, syncProgress: "Fetching manifest...", error: null });
    try {
      const manifest = await syncPullManifest();
      set({ remoteProfiles: manifest.profiles });

      const profileStore = useProfileStore.getState();
      let totalConfigs = 0;
      let totalMods = 0;
      let profilesProcessed = 0;
      const total = manifest.profiles.length;

      for (const remote of manifest.profiles) {
        set({ syncProgress: `Syncing "${remote.name}" (${profilesProcessed + 1}/${total})...` });

        // Find or create local profile
        let local = profileStore.profiles.find((p) => p.id === remote.id)
          ?? profileStore.profiles.find((p) => p.name === remote.name);

        if (!local) {
          set({ syncProgress: `Creating "${remote.name}"...` });
          try {
            const { createProfile } = await import("../lib/tauri-api");
            await createProfile(remote.name);
            await profileStore.fetchProfiles();
            const updated = useProfileStore.getState();
            local = updated.profiles.find((p) => p.name === remote.name);
          } catch (e) {
            addToast({ type: "warning", title: "Sync", message: `Failed to create profile "${remote.name}": ${e}`, duration: 5000 });
            continue;
          }
        }

        if (!local) continue;

        // Pull bundled profile (configs + mod state) — 1 API call
        set({ syncProgress: `Pulling "${remote.name}"...` });
        try {
          const result = await syncPullBundle(remote.id, local.bepinex_path);
          totalConfigs += result.configs_updated;
        } catch (e) {
          addToast({ type: "warning", title: "Sync", message: `Pull failed for "${remote.name}": ${e}`, duration: 5000 });
        }

        // Install mods from manifest that aren't on disk
        set({ syncProgress: `Installing mods for "${remote.name}"...` });
        try {
          const modsInstalled = await syncInstallAllMods(local.bepinex_path);
          totalMods += modsInstalled;
        } catch {
          // Non-critical
        }

        // Install Thunderstore mods from remote bundle
        try {
          const remoteState = await syncPullProfileState(remote.id);
          if (remoteState.thunderstore_mods && remoteState.thunderstore_mods.length > 0) {
            set({ syncProgress: `Installing Thunderstore mods for "${remote.name}"...` });
            const tsInstalled = await syncInstallThunderstoreMods(
              local.bepinex_path,
              JSON.stringify(remoteState.thunderstore_mods)
            );
            totalMods += tsInstalled;
          }
        } catch {
          // Non-critical
        }

        profilesProcessed++;
      }

      await useProfileStore.getState().fetchProfiles();

      if (profilesProcessed > 0) {
        addToast({
          type: "success",
          title: "Cloud Sync Complete",
          message: `${profilesProcessed} profile${profilesProcessed !== 1 ? "s" : ""}, ${totalConfigs} configs pulled${totalMods > 0 ? `, ${totalMods} mods updated` : ""}`,
          duration: 5000,
        });
      }

      set({ syncing: false, syncProgress: null, lastPull: new Date().toISOString() });
    } catch (e) {
      set({ syncing: false, syncProgress: null, error: String(e) });
    }
  },

  checkForRemoteChanges: async () => {
    const { enabled } = get();
    if (!enabled) return false;

    try {
      return await syncCheckRemoteChanged();
    } catch {
      return false;
    }
  },

  triggerAutoSync: async () => {
    const { enabled, autoSync } = get();
    if (!enabled || !autoSync) return;

    // Debounce — coalesce bursts of config edits into a single push.
    // Fires on a background timer so the UI stays responsive.
    if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(() => {
      _autoSyncTimer = null;
      // Fire-and-forget — do NOT await, so the caller returns immediately.
      void get().pushAllProfiles();
    }, AUTO_SYNC_DEBOUNCE_MS);
  },
}));

const AUTO_SYNC_DEBOUNCE_MS = 2000;
let _autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
