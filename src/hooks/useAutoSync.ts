import { useEffect, useRef, useCallback } from "react";
import { useSyncStore } from "../stores/syncStore";
import { useProfileStore } from "../stores/profileStore";
import { useIdentityStore } from "../stores/identityStore";
import { useToastStore } from "../stores/toastStore";
import { useMegaListStore } from "../stores/megaListStore";

const POLL_INTERVAL_MS = 30_000; // Check for remote changes every 30s
const DEBOUNCE_MS = 3_000; // Push 3s after FIRST change (non-resetting)
const INITIAL_PULL_DELAY_MS = 2_000; // Let IdentityGate clear first

/**
 * Auto-sync hook — handles:
 * 1. Initial pull on app startup (if sync enabled)
 * 2. Periodic polling for remote changes (30s)
 * 3. Non-resetting debounced push after local changes (3s from first trigger)
 *
 * Mount once in AppShell.
 */
export function useAutoSync() {
  const enabled = useSyncStore((s) => s.enabled);
  const autoSync = useSyncStore((s) => s.autoSync);
  const syncing = useSyncStore((s) => s.syncing);
  const fetchSyncStatus = useSyncStore((s) => s.fetchSyncStatus);
  const checkForRemoteChanges = useSyncStore((s) => s.checkForRemoteChanges);
  const pullAllProfiles = useSyncStore((s) => s.pullAllProfiles);
  const pushAllProfiles = useSyncStore((s) => s.pushAllProfiles);
  const addToast = useToastStore((s) => s.addToast);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const identity = useIdentityStore((s) => s.identity);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPullTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPullDone = useRef(false);

  // Load sync status on mount
  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  // Deferred initial pull — wait for identity + 2s so IdentityGate renders first
  useEffect(() => {
    if (!enabled || !autoSync || !identity || initialPullDone.current) return;

    initialPullTimerRef.current = setTimeout(() => {
      initialPullTimerRef.current = null;
      initialPullDone.current = true;

      (async () => {
        try {
          const hasChanges = await checkForRemoteChanges();
          if (hasChanges) {
            await pullAllProfiles();
            addToast({
              type: "info",
              title: "Cloud Sync",
              message: "Profiles synced from cloud",
              duration: 3000,
            });
          }
        } catch {
          // Silent fail on initial pull
        }
        try {
          await useMegaListStore.getState().reconcile();
        } catch {
          // Silent fail — toast would noise up startup
        }
      })();
    }, INITIAL_PULL_DELAY_MS);

    return () => {
      if (initialPullTimerRef.current) {
        clearTimeout(initialPullTimerRef.current);
        initialPullTimerRef.current = null;
      }
    };
  }, [enabled, autoSync, identity, checkForRemoteChanges, pullAllProfiles, addToast]);

  // Periodic polling for remote changes
  useEffect(() => {
    if (!enabled || !autoSync) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(async () => {
      if (syncing) return;
      try {
        const hasChanges = await checkForRemoteChanges();
        if (hasChanges) {
          await pullAllProfiles();
          addToast({
            type: "info",
            title: "Cloud Sync",
            message: "Profile changes pulled from another device",
            duration: 4000,
          });
        }
      } catch {
        // Silent fail on poll
      }
      try {
        await useMegaListStore.getState().reconcile();
      } catch {
        // Silent fail on poll
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, autoSync, syncing, checkForRemoteChanges, pullAllProfiles, addToast]);

  // Non-resetting debounced push — fires 3s after the FIRST trigger,
  // not the last. This ensures changes get pushed promptly even if the
  // user is making rapid edits.
  const schedulePush = useCallback(() => {
    if (!enabled || !autoSync) return;

    // Only start a new timer if one isn't already running
    if (debounceTimerRef.current) return;

    debounceTimerRef.current = setTimeout(async () => {
      debounceTimerRef.current = null;
      try {
        await pushAllProfiles();
      } catch {
        // Error already set in store
      }
    }, DEBOUNCE_MS);
  }, [enabled, autoSync, pushAllProfiles]);

  // Push when active profile changes
  useEffect(() => {
    if (!enabled || !autoSync || !activeProfileId) return;
    schedulePush();
  }, [activeProfileId, enabled, autoSync, schedulePush]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  return { schedulePush };
}
