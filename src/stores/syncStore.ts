import { create } from "zustand";
import {
  syncSetEnabled,
  syncSetAutoSync,
  syncPushProfile,
  syncPushAll,
  syncPullManifest,
  syncPullProfile,
  syncCheckRemoteChanged,
  syncGetSettings,
  type SyncPullResult,
  type SyncProfileEntry,
} from "../lib/tauri-api";
import { useProfileStore } from "./profileStore";

interface SyncState {
  // State
  enabled: boolean;
  autoSync: boolean;
  syncing: boolean;
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
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const profileStore = useProfileStore.getState();
    const active = profileStore.activeProfile();
    if (!active) return;

    set({ syncing: true, error: null });
    try {
      await syncPushProfile(active.id, active.name, active.bepinex_path);
      set({ syncing: false, lastPush: new Date().toISOString() });
    } catch (e) {
      set({ syncing: false, error: String(e) });
    }
  },

  pushAllProfiles: async () => {
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const profileStore = useProfileStore.getState();
    const profiles = profileStore.profiles;
    if (profiles.length === 0) return;

    set({ syncing: true, error: null });
    try {
      const pushData = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        bepinex_path: p.bepinex_path,
        is_active: p.id === profileStore.activeProfileId,
        is_linked: !p.bepinex_path.includes("MegaLoad"),
      }));
      await syncPushAll(JSON.stringify(pushData));
      set({ syncing: false, lastPush: new Date().toISOString() });
    } catch (e) {
      set({ syncing: false, error: String(e) });
    }
  },

  pullProfile: async (profileId: string, bepinexPath: string) => {
    const { enabled } = get();
    if (!enabled) throw new Error("Cloud sync is not enabled");

    set({ syncing: true, error: null });
    try {
      const result = await syncPullProfile(profileId, bepinexPath);
      set({ syncing: false, lastPull: new Date().toISOString() });
      return result;
    } catch (e) {
      set({ syncing: false, error: String(e) });
      throw e;
    }
  },

  pullAllProfiles: async () => {
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const profileStore = useProfileStore.getState();
    const profiles = profileStore.profiles;

    set({ syncing: true, error: null });
    try {
      for (const p of profiles) {
        try {
          await syncPullProfile(p.id, p.bepinex_path);
        } catch {
          // Profile might not exist in cloud yet — skip
        }
      }
      set({ syncing: false, lastPull: new Date().toISOString() });
    } catch (e) {
      set({ syncing: false, error: String(e) });
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
