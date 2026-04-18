import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  startPlayerDataWatcher,
  stopPlayerDataWatcher,
  syncPushPlayerData,
} from "../lib/tauri-api";
import { useSyncStore } from "../stores/syncStore";
import { useIdentityStore } from "../stores/identityStore";
import { useToastStore } from "../stores/toastStore";
import { usePlayerDataStore } from "../stores/playerDataStore";

const PUSH_DEBOUNCE_MS = 5_000;
const INITIAL_PUSH_DELAY_MS = 3_000;

/**
 * Global player-data lifecycle. Two responsibilities:
 *
 * 1. **Local store freshness** — always on. Starts the Tauri .fch watcher
 *    and on every change event re-reads the selected character into the
 *    Zustand store. Ensures Dashboard / sidebar stats stay live regardless
 *    of which page the user is on (previously only PlayerData.tsx wired
 *    this, so leaving the page left the store stale).
 *
 * 2. **Cloud push** — gated on `enabled && autoSync && identity`. On change
 *    event, debounced 5s, pushes all characters to the cloud.
 *
 * Mount once in AppShell.
 */
export function useAutoPlayerSync() {
  const enabled = useSyncStore((s) => s.enabled);
  const autoSync = useSyncStore((s) => s.autoSync);
  const identity = useIdentityStore((s) => s.identity);
  const addToast = useToastStore((s) => s.addToast);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPushDone = useRef(false);

  // Watcher + listener — always on so local store stays fresh
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
        // Always refresh the local store so every page sees fresh data.
        usePlayerDataStore.getState().refreshSelected();

        // Cloud push is optional — debounced + only when sync is on.
        if (!enabled || !autoSync || !identity) return;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(async () => {
          debounceTimerRef.current = null;
          try {
            const count = await syncPushPlayerData();
            if (count > 0) {
              addToast({
                type: "info",
                title: "Player Sync",
                message: `Pushed ${count} character${count !== 1 ? "s" : ""} to cloud`,
                duration: 2500,
              });
            }
          } catch (e) {
            console.warn("[MegaLoad] Auto player push failed:", e);
          }
        }, PUSH_DEBOUNCE_MS);
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

  // Deferred initial cloud push — only after identity is loaded + 3s delay
  useEffect(() => {
    if (!enabled || !autoSync || !identity || initialPushDone.current) return;

    initialPushTimerRef.current = setTimeout(() => {
      initialPushTimerRef.current = null;
      initialPushDone.current = true;

      (async () => {
        try {
          const count = await syncPushPlayerData();
          if (count > 0) {
            addToast({
              type: "info",
              title: "Player Sync",
              message: `Pushed ${count} character${count !== 1 ? "s" : ""} on startup`,
              duration: 2500,
            });
          }
        } catch (e) {
          console.warn("[MegaLoad] Initial player push failed:", e);
        }
      })();
    }, INITIAL_PUSH_DELAY_MS);

    return () => {
      if (initialPushTimerRef.current) {
        clearTimeout(initialPushTimerRef.current);
        initialPushTimerRef.current = null;
      }
    };
  }, [enabled, autoSync, identity, addToast]);
}
