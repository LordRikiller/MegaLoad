import { useEffect, useRef } from "react";
import { useSyncStore } from "../stores/syncStore";
import { useIdentityStore } from "../stores/identityStore";
import { useToastStore } from "../stores/toastStore";
import { useMegaListStore } from "../stores/megaListStore";
import { useGameStatusStore } from "../stores/gameStatusStore";

const POLL_INTERVAL_MS = 30_000; // Check for remote changes every 30s
const INITIAL_PULL_DELAY_MS = 2_000; // Let IdentityGate clear first

/**
 * Auto-sync hook — handles:
 * 1. Initial pull on app startup (if sync enabled)
 * 2. Periodic polling for remote changes (30s) — paused while Valheim is running
 * 3. Single push + reconcile on game-exit transition (running → not running)
 *
 * Local edits are NOT pushed on every change — they're caught by the periodic
 * poll/push cadence and the game-exit push. Per-edit pushing was removed in
 * v1.10.39 because it was causing UI lockouts and unnecessary cloud churn.
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
  const identity = useIdentityStore((s) => s.identity);
  const valheimRunning = useGameStatusStore((s) => !!s.status?.valheim_running);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);
}
