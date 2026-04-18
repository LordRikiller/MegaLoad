import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  startPlayerDataWatcher,
  stopPlayerDataWatcher,
  syncReconcilePlayerData,
} from "../lib/tauri-api";
import { useSyncStore } from "../stores/syncStore";
import { useIdentityStore } from "../stores/identityStore";
import { useToastStore } from "../stores/toastStore";
import { usePlayerDataStore } from "../stores/playerDataStore";

const RECONCILE_DEBOUNCE_MS = 5_000;
const INITIAL_RECONCILE_DELAY_MS = 3_000;

/**
 * Global player-data lifecycle.
 *
 * **Local store freshness** — always on: Tauri `.fch` watcher fires on
 * every save; we refresh the Zustand store so Dashboard / sidebar stay
 * live regardless of which page is mounted.
 *
 * **Cloud reconcile** — gated on `enabled && autoSync && identity`.
 * Replaces the old "auto-push on startup / on every change" logic, which
 * caused stale clients to clobber newer remote data. The reconcile call
 * compares mtimes per character and moves bytes in whichever direction
 * is newer — whoever played most recently wins, every time.
 */
export function useAutoPlayerSync() {
  const enabled = useSyncStore((s) => s.enabled);
  const autoSync = useSyncStore((s) => s.autoSync);
  const identity = useIdentityStore((s) => s.identity);
  const addToast = useToastStore((s) => s.addToast);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDone = useRef(false);

  // Watcher + listener — always on so the local store stays fresh regardless of sync.
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        await startPlayerDataWatcher();
      } catch (e) {
        console.warn("[MegaLoad] Failed to start player data watcher:", e);
      }
      if (cancelled) return;

      unlistenFn = await listen("player-data-changed", () => {
        // Always refresh local state.
        usePlayerDataStore.getState().refreshSelected();

        // Cloud reconcile is optional and debounced.
        if (!enabled || !autoSync || !identity) return;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(async () => {
          debounceTimerRef.current = null;
          try {
            const r = await syncReconcilePlayerData();
            if (r.pulled > 0 || r.pushed > 0) {
              const parts: string[] = [];
              if (r.pushed > 0) parts.push(`pushed ${r.pushed}`);
              if (r.pulled > 0) parts.push(`pulled ${r.pulled}`);
              addToast({
                type: "info",
                title: "Player Sync",
                message: parts.join(" · "),
                duration: 2500,
              });
              if (r.pulled > 0) {
                // New bytes landed locally — reload the selected character.
                usePlayerDataStore.getState().fetchCharacters();
                usePlayerDataStore.getState().refreshSelected();
              }
            }
          } catch (e) {
            console.warn("[MegaLoad] Auto reconcile failed:", e);
          }
        }, RECONCILE_DEBOUNCE_MS);
      });
    })();

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      stopPlayerDataWatcher().catch(() => {});
    };
  }, [enabled, autoSync, identity, addToast]);

  // One reconcile on startup — after identity loads + short UI settle delay.
  useEffect(() => {
    if (!enabled || !autoSync || !identity || initialDone.current) return;
    initialTimerRef.current = setTimeout(() => {
      initialTimerRef.current = null;
      initialDone.current = true;
      (async () => {
        try {
          const r = await syncReconcilePlayerData();
          if (r.pulled > 0 || r.pushed > 0) {
            const parts: string[] = [];
            if (r.pulled > 0) parts.push(`pulled ${r.pulled}`);
            if (r.pushed > 0) parts.push(`pushed ${r.pushed}`);
            addToast({
              type: "info",
              title: "Player Sync",
              message: `Startup reconcile — ${parts.join(" · ")}`,
              duration: 3000,
            });
            if (r.pulled > 0) {
              usePlayerDataStore.getState().fetchCharacters();
              usePlayerDataStore.getState().refreshSelected();
            }
          }
        } catch (e) {
          console.warn("[MegaLoad] Initial reconcile failed:", e);
        }
      })();
    }, INITIAL_RECONCILE_DELAY_MS);

    return () => {
      if (initialTimerRef.current) {
        clearTimeout(initialTimerRef.current);
        initialTimerRef.current = null;
      }
    };
  }, [enabled, autoSync, identity, addToast]);
}
