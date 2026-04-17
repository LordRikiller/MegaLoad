# MegaLoad — Tauri Desktop Mod Manager

See the workspace-level `../CLAUDE.md` for the bug-and-fix workflow, debug-first
diagnosis rules, and deploy cadence that apply to every project here. This file
covers MegaLoad-specific invariants.

## Debug logging

Frontend debug output goes through `src/lib/debug.ts`:

- `debugLog(...args)` / `debugWarn(...args)` — short-circuit unless `useSettingsStore.getState().loggingEnabled` is true, then forward to `logFromFrontend()` which writes to `megaload.log` via the gated Rust `app_log()` path. Use these for diagnostic chatter ("loaded 12 profiles", "resolved path X").
- Raw `console.log` in store or page code is a bug — use `debugLog` instead.
- `console.warn` / `console.error` are permitted **only** inside `.catch` blocks for recoverable and unrecoverable errors respectively. Not for diagnostics.
- Tauri backend (`src-tauri/src/commands/*.rs`) already gates via `app_log()`. Don't add `println!` outside `#[cfg(test)]`.

Toggle: Settings → Logging Enabled (persists as `logging_enabled` in `%APPDATA%/MegaLoad/settings.json`).

## MegaBugs ownership responsibilities

- **Owner** detected by `~/.megaload/megabugs-admin.key` — that's Milord's machine.
- **Collaborators** live in `collaborators.json` on the `ccmrik/MegaBugs` repo, managed from `AdminPanel.tsx` (per-user Make/Revoke Collaborator button).
- Only the owner can `delete_ticket` or set status to `"closed"`. Both backend commands check `is_local_owner()` and reject otherwise. Do not weaken these checks.

## Log-export convention

`src/pages/LogViewer.tsx` exports as `LogOutput_YYYY-MM-DD_HH-MM-SS_<player_id>.log`. Keep this format stable — Milord's log-attachment workflow relies on it (see `feedback-logs-latest-per-player.md`).

## Version bumping

For every release, bump all three files in the same commit:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `version`

## Build & release

- `npm run tauri build` produces the MSI/exe.
- Signing + `latest.json` update are separate steps — see `feedback-deploy-after-changes.md` in memory for the full pipeline.
- `mod-manifest.json` must be uploaded as a release asset on every MegaLoad release or users hit 404 (see `feedback-mod-manifest-in-releases.md`).
