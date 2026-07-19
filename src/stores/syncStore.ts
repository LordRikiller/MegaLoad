import { create } from "zustand";
import {
  syncSetEnabled,
  syncSetAutoSync,
  syncPushAll,
  syncPullManifest,
  syncPullBundle,
  syncCheckRemoteChanged,
  syncMarkRemoteSeen,
  syncMarkProfileCanonical,
  syncGetSettings,
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
  makeThisDeviceCanonical: () => Promise<void>;
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

        // Pull bundled profile — the backend now owns the full mod reconcile
        // for this profile: it installs ONLY this profile's missing mods (never
        // the whole catalogue), mirror-uninstalls tombstoned mods, and applies
        // enabled/disabled — all per-mod. We just tally the result.
        set({ syncProgress: `Pulling "${remote.name}"...` });
        try {
          const result = await syncPullBundle(remote.id, local.bepinex_path);
          totalConfigs += result.configs_updated;
          totalMods +=
            (result.installed_mods?.length ?? 0) +
            (result.uninstalled_mods?.length ?? 0) +
            (result.toggled_mods?.length ?? 0);

          // Thunderstore mods still install via their own path (folder-based).
          // The bundle already carried them back in the result, so no re-fetch.
          if (result.thunderstore_mods && result.thunderstore_mods.length > 0) {
            set({ syncProgress: `Installing Thunderstore mods for "${remote.name}"...` });
            try {
              const tsInstalled = await syncInstallThunderstoreMods(
                local.bepinex_path,
                JSON.stringify(result.thunderstore_mods)
              );
              totalMods += tsInstalled;
            } catch {
              // Non-critical
            }
          }
        } catch (e) {
          addToast({ type: "warning", title: "Sync", message: `Pull failed for "${remote.name}": ${e}`, duration: 5000 });
        }

        profilesProcessed++;
      }

      await useProfileStore.getState().fetchProfiles();

      // Record the manifest beacon we just reconciled against so the next
      // change-detection poll compares by equality and stops re-pulling until
      // a peer bumps it again. Clock-skew-proof (no cross-device `>` compare).
      if (manifest.last_sync) {
        try {
          await syncMarkRemoteSeen(manifest.last_sync);
        } catch {
          // Non-critical — worst case is one redundant pull next poll.
        }
      }

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

  // One-time migration helper. Stamps every config/mod watermark on THIS device
  // to "now" for all profiles, then pushes — making this machine's whole config
  // set the source of truth so peers pull it on their next sync. Resolves the
  // first-run divergence without per-mod poking.
  makeThisDeviceCanonical: async () => {
    const { enabled, syncing } = get();
    if (!enabled || syncing) return;

    const addToast = useToastStore.getState().addToast;
    const profiles = useProfileStore.getState().profiles;
    if (profiles.length === 0) return;

    set({ syncing: true, syncProgress: "Marking this device as canonical...", error: null });
    try {
      for (const p of profiles) {
        set({ syncProgress: `Marking "${p.name}" canonical...` });
        await syncMarkProfileCanonical(p.id, p.bepinex_path);
      }
      // Release the sync lock before pushAllProfiles (it manages its own).
      set({ syncing: false, syncProgress: null });
      await get().pushAllProfiles();
      addToast({
        type: "success",
        title: "This device is now canonical",
        message: `${profiles.length} profile${profiles.length !== 1 ? "s" : ""} set as the source of truth. Other devices will pull these configs on their next sync.`,
        duration: 6000,
      });
    } catch (e) {
      set({ syncing: false, syncProgress: null, error: String(e) });
      addToast({ type: "warning", title: "Canonical sync failed", message: String(e), duration: 6000 });
    }
  },
}));
