import { useEffect, useMemo, useState } from "react";
import { useProfileStore } from "../stores/profileStore";
import { useModStore } from "../stores/modStore";
import {
  Package,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { cn, formatModName } from "../lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { installMod, validateBepinex, findBepinexSources, installBepinexCore, downloadBepinex, detectValheimPath, type BepInExStatus } from "../lib/tauri-api";
import { SyncingOverlay } from "../components/SyncingOverlay";

export function Mods() {
  const { activeProfile } = useProfileStore();
  const { mods, loading, error, fetchMods, toggleMod, deleteMod } =
    useModStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [bepStatus, setBepStatus] = useState<BepInExStatus | null>(null);
  const [installingBep, setInstallingBep] = useState(false);
  const [bepToast, setBepToast] = useState<string | null>(null);
  const profile = activeProfile();

  // Conflict detection: find duplicate DLL file names among enabled mods
  const conflicts = useMemo(() => {
    const enabledMods = mods.filter((m) => m.enabled);
    const seen = new Map<string, string[]>();
    for (const mod of enabledMods) {
      const key = mod.file_name.toLowerCase();
      const existing = seen.get(key) || [];
      existing.push(mod.folder || "(loose)");
      seen.set(key, existing);
    }
    const dupes: { fileName: string; locations: string[] }[] = [];
    for (const [fileName, locations] of seen) {
      if (locations.length > 1) {
        dupes.push({ fileName, locations });
      }
    }
    return dupes;
  }, [mods]);

  useEffect(() => {
    if (profile?.bepinex_path) {
      fetchMods(profile.bepinex_path);
      validateBepinex(profile.bepinex_path)
        .then(setBepStatus)
        .catch((e) => console.warn("[MegaLoad]", e));
    }
  }, [profile?.bepinex_path, fetchMods]);

  useEffect(() => {
    if (bepToast) {
      const t = setTimeout(() => setBepToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [bepToast]);

  const handleInstallBepinex = async () => {
    if (!profile?.bepinex_path) return;
    setInstallingBep(true);
    try {
      // First try to find an existing local BepInEx installation
      const sources = await findBepinexSources();
      if (sources.length > 0) {
        await installBepinexCore(sources[0][1], profile.bepinex_path);
        setBepToast(`BepInEx core installed from: ${sources[0][0]}`);
      } else {
        // No local source — download from GitHub
        setBepToast("Downloading BepInEx from GitHub...");
        let valheimPath: string;
        try {
          valheimPath = await detectValheimPath();
        } catch {
          setBepToast("Cannot find Valheim installation. Set the path in Settings first.");
          return;
        }
        const result = await downloadBepinex(valheimPath, profile.bepinex_path);
        setBepToast(result);
      }
      // Re-validate
      const status = await validateBepinex(profile.bepinex_path);
      setBepStatus(status);
    } catch (e) {
      setBepToast(`Failed to install BepInEx: ${e}`);
    } finally {
      setInstallingBep(false);
    }
  };

  const filteredMods = mods.filter((mod) => {
    const matchesSearch = mod.name
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "enabled" && mod.enabled) ||
      (filter === "disabled" && !mod.enabled);
    return matchesSearch && matchesFilter;
  });

  const handleToggle = async (mod: (typeof mods)[0]) => {
    if (profile?.bepinex_path) {
      await toggleMod(
        profile.bepinex_path,
        mod.folder,
        mod.file_name,
        !mod.enabled
      );
    }
  };

  const handleDelete = async (mod: (typeof mods)[0]) => {
    if (profile?.bepinex_path) {
      await deleteMod(
        profile.bepinex_path,
        mod.folder,
        mod.file_name,
        mod.enabled
      );
    }
  };

  const handleInstall = async () => {
    if (!profile?.bepinex_path) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "DLL", extensions: ["dll"] }],
    });
    if (selected) {
      await installMod(profile.bepinex_path, selected);
      fetchMods(profile.bepinex_path);
    }
  };

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-300">
          No Active Profile
        </h2>
        <p className="text-zinc-500 mt-2">
          Select or create a profile to manage mods
        </p>
      </div>
    );
  }

  return (
    <div className="relative space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SyncingOverlay />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide">Mods</h1>
          <p className="text-zinc-500 mt-1">
            Profile: {profile.name} &middot; {mods.length} mod
            {mods.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-zinc-950 font-semibold text-sm hover:bg-brand-400 transition-colors active:scale-[0.98]"
        >
          <Upload className="w-4 h-4" />
          Install Mod
        </button>
      </div>

      {/* Toast */}
      {bepToast && (
        <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-lg bg-brand-500/90 text-zinc-950 text-sm font-medium shadow-xl animate-in slide-in-from-top-2 duration-300 max-w-sm">
          {bepToast}
        </div>
      )}

      {/* BepInEx Health Warning */}
      {bepStatus && !bepStatus.path_exists && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400">BepInEx Path Not Found</p>
            <p className="text-xs text-zinc-400 mt-1">
              The profile's BepInEx path doesn't exist on disk. You may need to recreate this profile.
            </p>
          </div>
        </div>
      )}
      {bepStatus && bepStatus.path_exists && !bepStatus.has_core && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-400">BepInEx Core Missing</p>
            <p className="text-xs text-zinc-400 mt-1">
              This profile doesn't have BepInEx installed. Mods won't load when you launch the game.
            </p>
            <button
              onClick={handleInstallBepinex}
              disabled={installingBep}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 text-zinc-950 text-xs font-bold hover:bg-brand-400 transition-colors disabled:opacity-50"
            >
              {installingBep ? (
                <>
                  <Package className="w-3.5 h-3.5 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Package className="w-3.5 h-3.5" />
                  Install BepInEx Core
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search mods..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg glass border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all"
          />
        </div>
        <div className="flex rounded-lg glass border border-zinc-800 overflow-hidden">
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium capitalize transition-colors",
                filter === f
                  ? "bg-brand-500/15 text-brand-400"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Conflict Warning */}
      {conflicts.length > 0 && (
        <div className="glass rounded-xl p-4 border border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
            <AlertTriangle className="w-4 h-4" />
            {conflicts.length} Mod Conflict{conflicts.length > 1 ? "s" : ""} Detected
          </div>
          {conflicts.map((c) => (
            <p key={c.fileName} className="text-xs text-zinc-400 ml-6">
              <span className="text-amber-300 font-mono">{c.fileName}</span>{" "}
              found in: {c.locations.join(", ")}
            </p>
          ))}
        </div>
      )}

      {/* Mod List */}
      {loading ? (
        <div className="text-center py-12 text-zinc-500">Loading mods...</div>
      ) : error ? (
        <div className="text-center py-12 text-red-400">{error}</div>
      ) : filteredMods.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <p className="text-zinc-500">
            {search ? "No mods match your search" : "No mods installed"}
          </p>
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filteredMods.map((mod) => {
            const hasConflict = mod.enabled && conflicts.some(
              (c) => c.fileName.toLowerCase() === mod.file_name.toLowerCase()
            );
            return (
            <div
              key={`${mod.folder}/${mod.file_name}`}
              className={cn(
                "glass rounded-xl p-4 flex items-center gap-4 group transition-all duration-200",
                hasConflict
                  ? "border-amber-500/30 hover:border-amber-500/50"
                  : mod.enabled
                    ? "border-zinc-800/50 hover:border-zinc-700/50"
                    : "border-zinc-800/30 opacity-60 hover:opacity-80"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  mod.enabled ? "bg-brand-500/10" : "bg-zinc-800"
                )}
              >
                <Package
                  className={cn(
                    "w-5 h-5",
                    mod.enabled ? "text-brand-400" : "text-zinc-600"
                  )}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-zinc-200 truncate">
                    {formatModName(mod.name)}
                  </h3>
                  {hasConflict && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400">
                      CONFLICT
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 truncate">
                  {mod.folder || mod.file_name}
                  {mod.version && <span className="text-zinc-400 font-mono"> · v{mod.version}</span>}
                </p>
                {mod.description && (
                  <p className="text-xs text-zinc-600 truncate mt-0.5">
                    {mod.description}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleDelete(mod)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Delete mod"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Toggle */}
              <button
                onClick={() => handleToggle(mod)}
                className="shrink-0"
                title={mod.enabled ? "Disable" : "Enable"}
              >
                {mod.enabled ? (
                  <ToggleRight className="w-8 h-8 text-brand-400" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-zinc-600" />
                )}
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
