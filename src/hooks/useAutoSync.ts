import { useEffect, useRef } from "react";
import { useSyncStore } from "../stores/syncStore";
import { useIdentityStore } from "../stores/identityStore";
import { useToastStore } from "../stores/toastStore";
import { useMegaListStore } from "../stores/megaListStore";
import { useGameStatusStore } from "../stores/gameStatusStore";
import { debugWarn } from "../lib/debug";

const POLL_INTERVAL_MS = 30_000; // Check for remote changes every 30s
const INITIAL_PULL_DELAY_MS = 2_000; // Let IdentityGate clear first
/**
 * Consecutive MegaList reconcile failures before we say something out loud.
 * One failure is usually a dropped connection and not worth a toast; a run of
 * them means lists genuinely aren't syncing, which used to be completely
 * invisible — every reconcile error was swallowed by a bare `catch {}`, so an
 * account could go months without syncing and nobody would know.
 */
const LIST_FAILURE_TOAST_THRESHOLD = 3;

/**
 * Auto-sync hook — handles:
 * 1. Initial pull on app startup (if sync enabled)
 * 2. Periodic pull + push every 30s — paused while Valheim is running
 * 3. Final push + reconcile on game-exit transition (running → not running)
 *
 * Local edits are NOT pushed on every change — they're caught by the periodic
 * push cadence and the game-exit push. Per-edit pushing was removed in
 * v1.10.39 because it was causing UI lockouts and unnecessary cloud churn.
 * The 30s poll-push was added in v1.10.53: prior to that, configs only
 * uploaded on Valheim exit, so any session that didn't launch the game
 * stranded its edits locally (ticket 20260524-222756-b294a49e). The Rust
 * push path short-circuits when nothing has changed, so an idle poll-push
 * is cheap.
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
  const listFailureStreak = useRef(0);
  const listFailureToasted = useRef(false);

  // MegaList reconcile is best-effort, but "best-effort" used to mean "silent
  // forever". Log every failure and surface a toast once a run of them says the
  // problem is real rather than a blip. Resets as soon as one succeeds.
  const noteListSync = useRef<(err: unknown | null, where: string) => void>(() => {});
  noteListSync.current = (err, where) => {
    if (err === null) {
      listFailureStreak.current = 0;
      listFailureToasted.current = false;
      return;
    }
    listFailureStreak.current += 1;
    debugWarn(
      `MegaList reconcile failed (${where}, streak ${listFailureStreak.current}):`,
      err
    );
    if (
      listFailureStreak.current >= LIST_FAILURE_TOAST_THRESHOLD &&
      !listFailureToasted.current
    ) {
      listFailureToasted.current = true;
      addToast({
        type: "warning",
        title: "MegaLists not syncing",
        message: `${listFailureStreak.current} attempts failed. Your lists are safe locally, but they aren't reaching the cloud.`,
        duration: 8000,
      });
    }
  };

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
        } catch (e) {
          debugWarn("Cloud Sync: initial profile pull failed:", e);
        }
        try {
          await useMegaListStore.getState().reconcile();
          noteListSync.current(null, "startup");
        } catch (e) {
          noteListSync.current(e, "startup");
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
      } catch (e) {
        debugWarn("Cloud Sync: poll pull failed:", e);
      }
      // Push any local edits to the cloud. The Rust side short-circuits when
      // the merged bundle matches remote (only `last_updated` would change),
      // so an idle poll-push is essentially free. Without this, configs only
      // sync on Valheim exit — sessions that never launch the game would
      // strand their edits locally (ticket 20260524-222756-b294a49e).
      try {
        await pushAllProfiles();
      } catch (e) {
        debugWarn("Cloud Sync: poll push failed:", e);
      }
      try {
        await useMegaListStore.getState().reconcile();
        noteListSync.current(null, "poll");
      } catch (e) {
        noteListSync.current(e, "poll");
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, autoSync, syncing, valheimRunning, checkForRemoteChanges, pullAllProfiles, pushAllProfiles, addToast]);

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
        } catch (e) {
          // Error is also set in the store; this is the diagnostic trail.
          debugWarn("Cloud Sync: game-exit push failed:", e);
        }
        try {
          await useMegaListStore.getState().reconcile();
          noteListSync.current(null, "game-exit");
        } catch (e) {
          noteListSync.current(e, "game-exit");
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
