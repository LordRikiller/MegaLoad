import { create } from "zustand";
import {
  syncSetEnabled,
  syncSetAutoSync,
  syncPushAll,
  syncPullManifest,
  syncPullProfile,
  syncPullConfigs,
  syncPullProfileState,
  syncCheckRemoteChanged,
  syncGetSettings,
  syncInstallAllMods,
  syncInstallThunderstoreMods,
  type SyncPullResult,
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
  pushCurrentProfile: () => Promise<void>;
  pushAllProfiles: () => Promise<void>;
  pullProfile: (profileId: string, bepinexPath: string) => Promise<SyncPullResult>;
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

      // If enabled, also fetch remote profile list
      if (settings.enabled) {
        try {
          const manifest = await syncPullManifest();
          set({ remoteProfiles: manifest.profiles });
        } catch {
          // Remote manifest might not exist yet — that's fine
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

      // If just enabled, do an initial push
      if (enabled) {
        // Small delay to let the UI update
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

  pushCurrentProfile: async () => {
    // Delegate to pushAllProfiles so the manifest (machine_id + timestamp)
    // is always updated — this is what the other machine polls to detect changes.
    await get().pushAllProfiles();
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

  pullProfile: async (profileId: string, bepinexPath: string) => {
    const { enabled } = get();
    if (!enabled) throw new Error("Cloud sync is not enabled");

    set({ syncing: true, syncProgress: "Pulling profile...", error: null });
    try {
      const result = await syncPullProfile(profileId, bepinexPath);
      set({ syncing: false, syncProgress: null, lastPull: new Date().toISOString() });
      return result;
    } catch (e) {
      set({ syncing: false, syncProgress: null, error: String(e) });
      throw e;
    }
  },

  pullAllProfiles: async () => {
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const addToast = useToastStore.getState().addToast;
    set({ syncing: true, syncProgress: "Fetching manifest...", error: null });
    try {
      // Fetch remote manifest to see what profiles exist in the cloud
      const manifest = await syncPullManifest();
      set({ remoteProfiles: manifest.profiles });

      const profileStore = useProfileStore.getState();
      let totalConfigs = 0;
      let totalMods = 0;
      let profilesProcessed = 0;
      const total = manifest.profiles.length;

      for (const remote of manifest.profiles) {
        set({ syncProgress: `Syncing "${remote.name}" (${profilesProcessed + 1}/${total})...` });

        // Check if this profile exists locally (by ID first, then by name)
        let local = profileStore.profiles.find((p) => p.id === remote.id)
          ?? profileStore.profiles.find((p) => p.name === remote.name);

        if (!local) {
          // Profile doesn't exist locally — create it, then re-fetch
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

        // Pull configs from cloud using the REMOTE profile ID (that's where the data is stored)
        set({ syncProgress: `Pulling configs for "${remote.name}"...` });
        try {
          const configCount = await syncPullConfigs(remote.id, local.bepinex_path);
          totalConfigs += configCount;
        } catch (e) {
          addToast({ type: "warning", title: "Sync", message: `Config pull failed for "${remote.name}": ${e}`, duration: 5000 });
        }

        // Install ALL mods from manifest that aren't on disk yet
        set({ syncProgress: `Installing mods for "${remote.name}"...` });
        try {
          const modsInstalled = await syncInstallAllMods(local.bepinex_path);
          totalMods += modsInstalled;
        } catch {
          // Non-critical — mods can be installed manually
        }

        // Install Thunderstore mods from remote state
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
          // Non-critical — TS mods can be installed manually
        }

        profilesProcessed++;
      }

      // Refresh profile list to pick up any changes
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
    const { enabled, autoSync, syncing } = get();
    if (!enabled || !autoSync || syncing) return;

    // Push current profile state
    await get().pushCurrentProfile();
  },
}));
