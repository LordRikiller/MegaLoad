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
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  Globe,
  Gamepad2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useProfileStore } from "../../stores/profileStore";
import { useUpdateStore } from "../../stores/updateStore";
import { useToastStore } from "../../stores/toastStore";
import { detectValheimPath, launchValheim } from "../../lib/tauri-api";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/mods", icon: Package, label: "Mods" },
  { to: "/browse", icon: Globe, label: "Browse" },
  { to: "/config", icon: Settings2, label: "Config Editor" },
  { to: "/trainer", icon: Gamepad2, label: "Trainer" },
  { to: "/logs", icon: ScrollText, label: "Log Viewer" },
  { to: "/profiles", icon: Users, label: "Profiles" },
  { to: "/settings", icon: Cog, label: "Settings" },
];

export function Sidebar() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const [launching, setLaunching] = useState(false);
  const [valheimPath, setValheimPath] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const {
    checking,
    updating,
    updateResult,
    error: updateError,
    startupCheckDone,
    autoUpdate,
    sessionUpdatedMods,
  } = useUpdateStore();
  const addToast = useToastStore((s) => s.addToast);
  const hasRunStartupCheck = useRef(false);

  useEffect(() => {
    detectValheimPath().then(setValheimPath).catch(() => {});
  }, []);

  // Auto-update on startup when profile is available
  useEffect(() => {
    if (profile?.bepinex_path && !hasRunStartupCheck.current) {
      hasRunStartupCheck.current = true;
      autoUpdate(profile.bepinex_path);
    }
  }, [profile?.bepinex_path, autoUpdate]);

  useEffect(() => {
    if (launchError) {
      const t = setTimeout(() => setLaunchError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [launchError]);

  const handleLaunch = async () => {
    if (!profile?.bepinex_path || !valheimPath) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      await launchValheim(valheimPath, profile.bepinex_path);
    } catch (e) {
      setLaunchError(String(e));
    } finally {
      setTimeout(() => setLaunching(false), 2000);
    }
  };

  const handleCheckUpdates = () => {
    if (profile?.bepinex_path) {
      autoUpdate(profile.bepinex_path);
    }
  };

  const updatesBlocking = checking || updating;
  const launchDisabled =
    !profile || !valheimPath || launching || updatesBlocking;

  const updatedCount =
    updateResult?.mods.filter((m) => m.status === "updated").length ?? 0;
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
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
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
                      const names = sessionUpdatedMods.length > 0
                        ? sessionUpdatedMods.join(", ")
                        : updateResult?.mods
                            .filter((m) => m.status === "updated")
                            .map((m) => m.name)
                            .join(", ") ?? "";
                      addToast({
                        type: "success",
                        title: `${sessionUpdatedMods.length || updatedCount} mod${(sessionUpdatedMods.length || updatedCount) > 1 ? "s" : ""} updated this session`,
                        message: names,
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

      {/* Launch Button */}
      <div className="p-3 border-t border-zinc-800/50">
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
              Launching...
            </>
          ) : updatesBlocking ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Updating...
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
