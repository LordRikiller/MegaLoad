import { useEffect, useRef, useCallback } from "react";
import { useSyncStore } from "../stores/syncStore";
import { useProfileStore } from "../stores/profileStore";
import { useToastStore } from "../stores/toastStore";

const POLL_INTERVAL_MS = 60_000; // Check for remote changes every 60s
const DEBOUNCE_MS = 5_000; // Debounce push after changes

/**
 * Auto-sync hook — handles:
 * 1. Initial pull on app startup (if sync enabled)
 * 2. Periodic polling for remote changes
 * 3. Debounced push after local changes
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
  const pushCurrentProfile = useSyncStore((s) => s.pushCurrentProfile);
  const addToast = useToastStore((s) => s.addToast);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPullDone = useRef(false);

  // Load sync status on mount
  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  // Initial pull when sync is enabled and app starts
  useEffect(() => {
    if (!enabled || !autoSync || initialPullDone.current) return;

    const doPull = async () => {
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
      initialPullDone.current = true;
    };

    doPull();
  }, [enabled, autoSync, checkForRemoteChanges, pullAllProfiles, addToast]);

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
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, autoSync, syncing, checkForRemoteChanges, pullAllProfiles, addToast]);

  // Debounced push trigger — call this after local changes
  const schedulePush = useCallback(() => {
    if (!enabled || !autoSync) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      pushCurrentProfile();
    }, DEBOUNCE_MS);
  }, [enabled, autoSync, pushCurrentProfile]);

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
