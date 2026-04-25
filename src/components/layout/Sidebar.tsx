import { NavLink } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Package,
  Settings2,
  Users,
  Rocket,
  Cog,
  ScrollText,
  Database,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  Globe,
  Gamepad2,
  Cloud,
  CloudOff,
  Monitor,
  UserCircle,
  Bug,
  MessageCircle,
  Shield,
  ListChecks,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useProfileStore } from "../../stores/profileStore";
import { useModStore } from "../../stores/modStore";
import { useUpdateStore } from "../../stores/updateStore";
import { useAppUpdateStore } from "../../stores/appUpdateStore";
import { useToastStore } from "../../stores/toastStore";
import { usePlayerDataStore } from "../../stores/playerDataStore";
import { useIdentityStore } from "../../stores/identityStore";
import { useSyncStore } from "../../stores/syncStore";
import { useGameStatusStore } from "../../stores/gameStatusStore";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBugStore } from "../../stores/bugStore";
import { detectValheimPath, launchValheim, checkGameStatus, startSteam, deployBundledPlugins } from "../../lib/tauri-api";
import type { GameStatus } from "../../lib/tauri-api";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/profiles", icon: Users, label: "Profiles" },
  { to: "/mods", icon: Package, label: "Mods" },
  { to: "/browse", icon: Globe, label: "Browse Mods" },
  { to: "/config", icon: Settings2, label: "Config Editor" },
  { to: "/trainer", icon: Gamepad2, label: "Trainer" },
  { to: "/valheim-data", icon: Database, label: "Valheim Data" },
  { to: "/megalist", icon: ListChecks, label: "MegaList" },
  { to: "/player-data", icon: UserCircle, label: "Player Data" },
  { to: "/logs", icon: ScrollText, label: "Log Viewer" },
];

export function Sidebar() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const isAdmin = useIdentityStore((s) => s.isAdmin);
  const chatAvailable = useChatStore((s) => s.available);
  const checkChatAvailable = useChatStore((s) => s.checkAvailable);
  const megabugsEnabled = useSettingsStore((s) => s.megabugsEnabled);
  const notificationCount = useBugStore((s) => s.notificationCount);
  const newUserCount = useBugStore((s) => s.newUserCount);
  const startNotificationPolling = useBugStore((s) => s.startNotificationPolling);
  const [launching, setLaunching] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<string | null>(null);
  const [valheimPath, setValheimPath] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [gameStatus, setGameStatus] = useState<GameStatus | null>(null);
  const {
    checking,
    updating,
    updateResult,
    error: updateError,
    startupCheckDone,
    autoUpdate,
    checkUpdates,
    sessionUpdatedMods,
  } = useUpdateStore();
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    detectValheimPath().then(setValheimPath).catch((e) => console.warn("[MegaLoad]", e));
  }, []);

  // Check MegaChat API key availability
  useEffect(() => {
    checkChatAvailable();
  }, [checkChatAvailable]);

  // Start MegaBugs notification polling for badge counts
  useEffect(() => {
    if (megabugsEnabled && isAdmin) startNotificationPolling();
  }, [megabugsEnabled, isAdmin, startNotificationPolling]);

  // Auto-update on startup when profile is available (re-run on profile switch)
  const lastCheckedProfile = useRef<string | null>(null);
  const wasGameRunning = useRef(false);
  const deployedThisSession = useRef(false);
  useEffect(() => {
    const bep = profile?.bepinex_path;
    if (!bep) return;

    const runDeploy = () => {
      // Idempotent — Rust side compares versions and only overwrites older or
      // missing DLLs. Surfaces per-plugin outcomes so silent failures (most
      // often fs::copy blocked by Valheim's file lock) actually get seen.
      deployBundledPlugins(bep)
        .then((result) => {
          deployedThisSession.current = true;
          useModStore.getState().fetchMods(bep);
          if (result.failure_count > 0) {
            const failed = result.outcomes.filter((o) => o.action === "failed");
            useToastStore.getState().addToast({
              type: "warning",
              title: `Bundled plugin deploy failed (${result.failure_count})`,
              message: failed
                .map((o) => `${o.dll}: ${o.error ?? "unknown error"}`)
                .join(" · "),
              duration: 0,
            });
          }
        })
        .catch((e) => {
          useToastStore.getState().addToast({
            type: "warning",
            title: "Bundled plugin deploy errored",
            message: String(e),
            duration: 0,
          });
        });
    };

    // Profile switch — always auto-update
    if (bep !== lastCheckedProfile.current) {
      lastCheckedProfile.current = bep;
      if (gameStatus?.valheim_running) {
        // Valheim is holding DLL locks — deferring to post-game is the difference
        // between a stale v1.4.1 lingering invisibly and a clean upgrade. We
        // retry in the "game just stopped" branch below.
        deployedThisSession.current = false;
        checkUpdates(bep);
      } else {
        runDeploy();
        autoUpdate(bep);
      }
    }
    // Game just stopped — install any pending updates AND retry a deferred deploy
    else if (wasGameRunning.current && !gameStatus?.valheim_running) {
      if (!deployedThisSession.current) runDeploy();
      autoUpdate(bep);
      // Refresh player data after game exits (character save updated)
      usePlayerDataStore.getState().refreshSelected();
    }

    wasGameRunning.current = !!gameStatus?.valheim_running;
  }, [profile?.bepinex_path, autoUpdate, checkUpdates, gameStatus?.valheim_running]);

  useEffect(() => {
    if (launchError) {
      const t = setTimeout(() => setLaunchError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [launchError]);

  // Poll game/Steam status every 3 seconds. Mirror into useGameStatusStore so
  // useAutoSync (and anyone else) can react to game-running transitions
  // without re-polling.
  useEffect(() => {
    if (!valheimPath) return;
    const setStoreStatus = useGameStatusStore.getState().setStatus;
    const poll = () =>
      checkGameStatus(valheimPath)
        .then((s) => {
          setGameStatus(s);
          setStoreStatus(s);
        })
        .catch((e) => console.warn("[MegaLoad]", e));
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      clearInterval(id);
      setStoreStatus(null);
    };
  }, [valheimPath]);

  const handleLaunch = async () => {
    if (!profile?.bepinex_path || !valheimPath) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      // Step 1: Start Steam if not running
      const status = await checkGameStatus(valheimPath);
      if (!status.steam_running) {
        setLaunchPhase("Starting Steam...");
        await startSteam(valheimPath);
        // Wait for Steam to be detected (poll every 2s, up to 30s)
        let steamUp = false;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const s = await checkGameStatus(valheimPath);
          setGameStatus(s);
          if (s.steam_running) { steamUp = true; break; }
        }
        if (!steamUp) throw "Steam failed to start within 30 seconds.";
      }

      // Step 2: Wait for cloud sync to finish (poll every 2s, up to 90s)
      setLaunchPhase("Waiting for Cloud Sync...");
      let syncCleared = false;
      for (let i = 0; i < 45; i++) {
        const s = await checkGameStatus(valheimPath);
        setGameStatus(s);
        if (!s.cloud_syncing) { syncCleared = true; break; }
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Hard gate: refuse to launch if cloud sync is still active
      if (!syncCleared) {
        const finalCheck = await checkGameStatus(valheimPath);
        setGameStatus(finalCheck);
        if (finalCheck.cloud_syncing) {
          throw "Steam Cloud sync is still in progress. Wait for it to finish and try again — launching now could cause save conflicts.";
        }
      }

      // Step 3: Launch
      setLaunchPhase("Launching...");
      await launchValheim(valheimPath, profile.bepinex_path);
    } catch (e) {
      setLaunchError(String(e));
    } finally {
      setLaunchPhase(null);
      setTimeout(() => setLaunching(false), 2000);
    }
  };

  const handleCheckUpdates = () => {
    if (!profile?.bepinex_path) return;
    // Always check MegaLoad itself alongside mod updates — the Tauri updater
    // populates the Titlebar badge + Settings surface if a new version is out.
    useAppUpdateStore.getState().checkForAppUpdate().catch((e) => console.warn("[MegaLoad]", e));
    if (gameStatus?.valheim_running) {
      addToast({
        type: "warning",
        title: "Close Valheim first",
        message: "Mods can't be updated while the game is running. Close Valheim and try again.",
        duration: 5000,
      });
      // Still check for available mod updates, just don't install
      checkUpdates(profile.bepinex_path, true);
      return;
    }
    autoUpdate(profile.bepinex_path, true);
  };

  const updatesBlocking = checking || updating;
  const gameBlocking =
    gameStatus?.valheim_running || gameStatus?.cloud_syncing || false;
  const launchDisabled =
    !profile || !valheimPath || launching || updatesBlocking || gameBlocking;

  const updatedCount = sessionUpdatedMods.length;
  const availableCount =
    updateResult?.mods.filter((m) => m.status === "update-available").length ?? 0;
  const errorCount =
    updateResult?.mods.filter((m) => m.status === "error").length ?? 0;

  const firstError =
    updateResult?.mods.find((m) => m.error)?.error ?? null;

  return (
    <aside className="w-56 glass border-r border-zinc-800/50 flex flex-col shrink-0">
      {/* Nav Items */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg font-norse font-bold text-lg tracking-wide transition-all duration-200",
                isActive
                  ? "bg-brand-500/15 text-brand-400 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              )
            }
          >
            <item.icon className="w-4.5 h-4.5 shrink-0" />
            {item.label}
          </NavLink>
        ))}
        {/* MegaChat — only visible when API key is configured */}
        {chatAvailable && (
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg font-norse font-bold text-lg tracking-wide transition-all duration-200",
                isActive
                  ? "bg-brand-500/15 text-brand-400 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              )
            }
          >
            <MessageCircle className="w-4.5 h-4.5 shrink-0" />
            MegaChat
          </NavLink>
        )}
        {megabugsEnabled && (
          <NavLink
            to="/bugs"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg font-norse font-bold text-lg tracking-wide transition-all duration-200",
                isActive
                  ? "bg-brand-500/15 text-brand-400 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              )
            }
          >
            <Bug className="w-4.5 h-4.5 shrink-0" />
            MegaBugs
            {notificationCount > 0 && (
              <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/90 text-[10px] font-bold text-white leading-none">
                {notificationCount}
              </span>
            )}
          </NavLink>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg font-norse font-bold text-lg tracking-wide transition-all duration-200",
              isActive
                ? "bg-brand-500/15 text-brand-400 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            )
          }
        >
          <Cog className="w-4.5 h-4.5 shrink-0" />
          Settings
        </NavLink>
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg font-norse font-bold text-lg tracking-wide transition-all duration-200",
                isActive
                  ? "bg-brand-500/15 text-brand-400 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              )
            }
          >
            <Shield className="w-4.5 h-4.5 shrink-0" />
            Admin
            {(notificationCount + newUserCount) > 0 && (
              <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500/90 text-[10px] font-bold text-white leading-none">
                {notificationCount + newUserCount}
              </span>
            )}
          </NavLink>
        )}
      </nav>

      {/* Profile indicator */}
      {profile && (
        <div className="px-4 py-2 border-t border-zinc-800/50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-zinc-500 truncate">
              {profile.name}
            </span>
          </div>
        </div>
      )}

      {/* Cloud Sync Status */}
      <SyncStatusIndicator />

      {/* Update Status */}
      {profile && (
        <div className="px-3 pt-2 border-t border-zinc-800/50">
          {/* Update check in progress */}
          {updatesBlocking && (
            <div className="flex items-center gap-2 text-xs text-brand-400 py-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{updating ? "Updating mods..." : "Checking updates..."}</span>
            </div>
          )}

          {/* Result summary */}
          {startupCheckDone && !updatesBlocking && updateResult && (
            <div className="text-xs py-1.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {updatedCount > 0 && (
                  <button
                    onClick={() => {
                      addToast({
                        type: "success",
                        title: `${updatedCount} mod${updatedCount > 1 ? "s" : ""} updated`,
                        message: sessionUpdatedMods.join(", "),
                        duration: 8000,
                      });
                    }}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    {updatedCount} updated
                  </button>
                )}
                {availableCount > 0 && (
                  <span className="flex items-center gap-1 text-brand-400">
                    <Download className="w-3 h-3" />
                    {availableCount} pending
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="flex items-center gap-1 text-red-400">
                    <AlertCircle className="w-3 h-3" />
                    {errorCount} failed
                  </span>
                )}
                {updatedCount === 0 && availableCount === 0 && errorCount === 0 && (
                  <span className="flex items-center gap-1 text-zinc-500">
                    <CheckCircle2 className="w-3 h-3" />
                    All mods up to date
                  </span>
                )}
              </div>
              {firstError && (
                <p className="text-[10px] text-red-400/70 leading-tight truncate" title={firstError}>
                  {firstError}
                </p>
              )}
            </div>
          )}

          {updateError && (
            <p className="text-[10px] text-red-400 py-1 leading-tight">
              {updateError}
            </p>
          )}

          {/* Check for Updates button */}
          <button
            onClick={handleCheckUpdates}
            disabled={updatesBlocking}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 mt-1 mb-1 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-700/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={cn(
                "w-3 h-3",
                checking && "animate-spin"
              )}
            />
            Check for Updates
          </button>
        </div>
      )}

      {/* Game Status + Launch Button */}
      <div className="p-3 border-t border-zinc-800/50">
        {/* Game/Steam status indicator */}
        {gameStatus && valheimPath && (
          <div className="mb-2 space-y-1">
            {gameStatus.valheim_running && (
              <div className="flex items-center gap-2 text-xs text-brand-400">
                <Monitor className="w-3 h-3 shrink-0" />
                <span>Valheim is running</span>
              </div>
            )}
            {gameStatus.cloud_syncing && (
              <div className="flex items-center gap-2 text-xs text-sky-400">
                <Cloud className="w-3 h-3 shrink-0 animate-pulse" />
                <span>Steam Cloud syncing...</span>
              </div>
            )}
            {!gameStatus.steam_running && !gameStatus.valheim_running && !gameStatus.cloud_syncing && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <CloudOff className="w-3 h-3 shrink-0" />
                <span>Steam not running — will start automatically</span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleLaunch}
          disabled={launchDisabled}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg active:scale-[0.98]",
            !launchDisabled
              ? "bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-zinc-950 glow-brand hover:shadow-brand-500/25"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none"
          )}
        >
          {launching ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {launchPhase || "Launching..."}
            </>
          ) : updatesBlocking ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Updating...
            </>
          ) : gameStatus?.valheim_running ? (
            <>
              <Monitor className="w-4 h-4" />
              Game Running
            </>
          ) : gameStatus?.cloud_syncing ? (
            <>
              <Cloud className="w-4 h-4 animate-pulse" />
              Cloud Syncing...
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4" />
              Launch Valheim
            </>
          )}
        </button>
        {!profile && (
          <p className="text-[10px] text-zinc-600 text-center mt-1.5">
            Select a profile first
          </p>
        )}
        {launchError && (
          <p className="text-[10px] text-red-400 text-center mt-1.5 leading-tight">
            {launchError}
          </p>
        )}
      </div>
    </aside>
  );
}

function formatSyncLabel(lastPush: string | null, lastPull: string | null): string {
  if (!lastPush && !lastPull) return "Cloud sync on";
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const yr = d.getFullYear();
    const hr = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${mon}/${yr} ${hr}:${min}`;
  };
  const pushMs = lastPush ? new Date(lastPush).getTime() : 0;
  const pullMs = lastPull ? new Date(lastPull).getTime() : 0;
  // If both happened within 5 seconds of each other, show "Synced"
  if (pushMs && pullMs && Math.abs(pushMs - pullMs) < 5000) {
    return `Synced ${fmt(pushMs > pullMs ? lastPush! : lastPull!)}`;
  }
  // Show the most recent one
  if (pushMs >= pullMs && lastPush) return `Pushed ${fmt(lastPush)}`;
  if (lastPull) return `Pulled ${fmt(lastPull)}`;
  return "Cloud sync on";
}

function SyncStatusIndicator() {
  const enabled = useSyncStore((s) => s.enabled);
  const syncing = useSyncStore((s) => s.syncing);
  const syncProgress = useSyncStore((s) => s.syncProgress);
  const error = useSyncStore((s) => s.error);
  const lastPush = useSyncStore((s) => s.lastPush);
  const lastPull = useSyncStore((s) => s.lastPull);

  // Auto-clear sync errors after 15 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useSyncStore.setState({ error: null }), 15_000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!enabled) return null;

  return (
    <div className="px-4 py-1">
      <div className="flex items-center gap-2">
        {syncing ? (
          <>
            <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
            <span className="text-[10px] text-cyan-400 truncate">{syncProgress || "Syncing..."}</span>
          </>
        ) : error ? (
          <>
            <CloudOff className="w-3 h-3 text-red-400 flex-shrink-0" />
            <span className="text-[10px] text-red-400 truncate" title={error}>{error}</span>
          </>
        ) : (
          <>
            <Cloud className="w-3 h-3 text-cyan-500/50" />
            <span className="text-[10px] text-zinc-600">{formatSyncLabel(lastPush, lastPull)}</span>
          </>
        )}
      </div>
    </div>
  );
}
