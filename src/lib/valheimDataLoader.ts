// ── Valheim Data Loader ──────────────────────────────────────
// Pulls the Valheim item dataset from the MegaWorker (CF endpoint), caches
// it to %APPDATA%/MegaLoad/, and hot-swaps it into VALHEIM_ITEMS at runtime
// — no installer rebuild required when data changes.
//
// Behaviour:
//   1. On boot, read any cached dataset and apply it BEFORE first React render.
//      Falls back to the bundled snapshot if the cache is missing/invalid.
//   2. After mount, fire a remote fetch; if it returns new data, apply it and
//      bump dataVersion so subscribers re-render in place.
//   3. Every 15 minutes thereafter, repeat the remote fetch silently. The
//      Worker returns 304 when nothing changed, so most polls are no-ops.
//
// Falls back gracefully — the bundled dataset shipped with the installer is
// always the safety net.

import { invoke } from "@tauri-apps/api/core";
import { useValheimDataStore } from "../stores/valheimDataStore";
import type { ValheimItem } from "../data/valheim-items";
import { debugLog } from "./debug";

const POLL_INTERVAL_MS = 15 * 60 * 1000;

type FetchResult =
  | { status: "updated"; version: string; body: string; size: number }
  | { status: "unchanged"; version: string }
  | { status: "failed"; error: string };

interface CachedDataResult {
  version: string;
  body: string;
}

// Worker payload is the array literal produced by convert-dump.cjs — same
// shape as the bundled VALHEIM_ITEMS export. Treating each entry as a
// ValheimItem after the array guard saves a per-item structural check that
// would otherwise hammer startup with no real safety benefit (a corrupted
// payload would already have failed JSON.parse).
function safeParseItems(body: string): ValheimItem[] | null {
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as ValheimItem[];
  } catch {
    return null;
  }
}

/**
 * Apply a cached payload synchronously before the React tree mounts. Called
 * from main.tsx ahead of ReactDOM.createRoot so the very first paint shows
 * the user's latest data, not the bundled snapshot from N versions ago.
 */
export async function bootstrapValheimData(): Promise<void> {
  try {
    const cached = await invoke<CachedDataResult | null>("read_cached_valheim_data");
    if (!cached) {
      debugLog("valheimData: no cache, using bundled snapshot");
      return;
    }
    const items = safeParseItems(cached.body);
    if (!items) {
      debugLog("valheimData: cache parse failed, using bundled snapshot");
      return;
    }
    useValheimDataStore
      .getState()
      .applyRemoteData(items, cached.version, "cache");
    debugLog(`valheimData: bootstrapped from cache (v${cached.version}, ${items.length} items)`);
  } catch (e) {
    debugLog(`valheimData: bootstrap failed: ${e}`);
  }
}

/**
 * Fetch the latest data from the Worker once. Returns true if the store was
 * updated, false if the remote was unchanged or unreachable.
 */
export async function refreshValheimData(): Promise<boolean> {
  try {
    const result = await invoke<FetchResult>("fetch_valheim_data");
    if (result.status === "updated") {
      const items = safeParseItems(result.body);
      if (!items) {
        debugLog("valheimData: remote payload failed parse, keeping current");
        return false;
      }
      useValheimDataStore
        .getState()
        .applyRemoteData(items, result.version, "remote");
      debugLog(`valheimData: applied remote v${result.version} (${items.length} items)`);
      return true;
    }
    if (result.status === "unchanged") {
      debugLog(`valheimData: remote unchanged (v${result.version})`);
      // Mark the store as remote-current even though we didn't swap — useful
      // for the "Data: v<version>" footer on the Valheim Data page.
      const store = useValheimDataStore.getState();
      if (store.dataSource !== "remote" || store.dataVersionLabel !== result.version) {
        useValheimDataStore.setState({
          dataSource: "remote",
          dataVersionLabel: result.version,
        });
      }
      return false;
    }
    debugLog(`valheimData: fetch failed: ${result.error}`);
    return false;
  } catch (e) {
    debugLog(`valheimData: fetch threw: ${e}`);
    return false;
  }
}

let pollTimer: number | null = null;

/**
 * Start the 15-min refresh loop. Idempotent — calling twice doesn't stack
 * timers. Tear down with stopValheimDataPoll() if needed (test/teardown only;
 * normal app lifetime keeps the poll running until process exit).
 */
export function startValheimDataPoll(): void {
  if (pollTimer !== null) return;
  // Kick off an immediate fetch on mount (before the first 15-min tick).
  void refreshValheimData();
  pollTimer = window.setInterval(() => {
    void refreshValheimData();
  }, POLL_INTERVAL_MS);
}

export function stopValheimDataPoll(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}
