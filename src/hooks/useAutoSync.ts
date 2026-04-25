import { useEffect, useRef, useCallback } from "react";
import { useSyncStore } from "../stores/syncStore";
import { useProfileStore } from "../stores/profileStore";
import { useIdentityStore } from "../stores/identityStore";
import { useToastStore } from "../stores/toastStore";
import { useMegaListStore } from "../stores/megaListStore";
import { useGameStatusStore } from "../stores/gameStatusStore";

const POLL_INTERVAL_MS = 30_000; // Check for remote changes every 30s
const DEBOUNCE_MS = 3_000; // Push 3s after FIRST change (non-resetting)
const INITIAL_PULL_DELAY_MS = 2_000; // Let IdentityGate clear first

/**
 * Auto-sync hook — handles:
 * 1. Initial pull on app startup (if sync enabled)
 * 2. Periodic polling for remote changes (30s) — paused while Valheim is running
 * 3. Non-resetting debounced push after local changes (3s from first trigger) —
 *    skipped while Valheim is running (DLLs are locked anyway)
 * 4. Single push + reconcile on game-exit transition (running → not running)
 *
 * Game-pause rationale: while Valheim is in-session, mod/config changes are
 * locked behind the game holding file handles, and pulling another device's
 * changes mid-game would just churn the cloud copy. Sync resumes on exit.
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
  const valheimRunning = useGameStatusStore((s) => !!s.status?.valheim_running);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPullTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPullDone = useRef(false);
  const wasGameRunning = useRef(false);

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
        // Ensure MegaList store has hydrated from localStorage BEFORE any reconcile
        // can fire — otherwise an EPOCH-default state can lose to remote and then
        // be pushed back as an empty blob, wiping good data.
        useMegaListStore.getState().init();

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

  // Periodic polling for remote changes — paused while game is running.
  useEffect(() => {
    if (!enabled || !autoSync || valheimRunning) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(async () => {
      if (syncing) return;
      // Defensive: poll only fires post-mount but cheap to assert init happened.
      useMegaListStore.getState().init();
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
  }, [enabled, autoSync, syncing, valheimRunning, checkForRemoteChanges, pullAllProfiles, addToast]);

  // Game-exit hook — fire one push + reconcile when Valheim closes. Catches
  // the case where the user toggled mods or edited configs while the game was
  // running (pre-launch staging) and the debounce was suppressed.
  useEffect(() => {
    if (!enabled || !autoSync) {
      wasGameRunning.current = valheimRunning;
      return;
    }
    if (wasGameRunning.current && !valheimRunning) {
      (async () => {
        try {
          await pushAllProfiles();
        } catch {
          // Error already set in store
        }
        try {
          await useMegaListStore.getState().reconcile();
        } catch {
          // Silent
        }
      })();
    }
    wasGameRunning.current = valheimRunning;
  }, [valheimRunning, enabled, autoSync, pushAllProfiles]);

  // Non-resetting debounced push — fires 3s after the FIRST trigger,
  // not the last. This ensures changes get pushed promptly even if the
  // user is making rapid edits. Suppressed while game is running so we
  // don't push partial state mid-session; the game-exit hook above
  // catches up once the user is back in MegaLoad.
  const schedulePush = useCallback(() => {
    if (!enabled || !autoSync || valheimRunning) return;

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
  }, [enabled, autoSync, valheimRunning, pushAllProfiles]);

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
