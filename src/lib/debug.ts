import { logFromFrontend } from "./tauri-api";
import { useSettingsStore } from "../stores/settingsStore";

// Helpers for debug-level frontend logging. Every call is gated on the user's
// `Logging Enabled` setting — silent in release when debug is off, verbose when
// it's on. Debug writes go through `logFromFrontend` so they land in the same
// `megaload.log` as backend entries.
//
// When to use what:
//   debugLog(...)  — diagnostic chatter ("loaded 12 profiles", "resolved path X")
//   debugWarn(...) — diagnostic soft-errors we actively handle and want captured
//   console.error(...) — unrecoverable exceptions in `.catch` blocks; runs always
//   console.warn(...)  — recoverable errors in `.catch` blocks; runs always
//
// Do NOT use raw `console.log` — that's the ungated pattern we're avoiding.

function isLoggingEnabled(): boolean {
  try {
    return useSettingsStore.getState().loggingEnabled;
  } catch {
    return false;
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

export function debugLog(...args: unknown[]): void {
  if (!isLoggingEnabled()) return;
  const msg = formatArgs(args);
  logFromFrontend(msg).catch(() => {
    // Fallback to console so the message isn't lost if the Tauri bridge fails.
    console.warn("[MegaLoad debugLog fallback]", msg);
  });
}

export function debugWarn(...args: unknown[]): void {
  if (!isLoggingEnabled()) return;
  const msg = formatArgs(args);
  logFromFrontend(`WARN ${msg}`).catch(() => {
    console.warn("[MegaLoad debugWarn fallback]", msg);
  });
}
