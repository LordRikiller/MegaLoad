import React, { useEffect, useState, useCallback } from "react";
import { useProfileStore } from "../stores/profileStore";
import { useTrainerStore } from "../stores/trainerStore";
import {
  Shield,
  Zap,
  Swords,
  Package,
  Map,
  Heart,
  Wind,
  AlertCircle,
  Save,
  Trash2,
  RotateCcw,
  FolderOpen,
  Loader2,
  Gauge,
  ArrowUpFromDot,
} from "lucide-react";
import { cn } from "../lib/utils";

const categoryIcons: Record<string, typeof Shield> = {
  Survival: Heart,
  Creative: Package,
  Combat: Swords,
  Items: Zap,
  World: Map,
};

const categoryColors: Record<string, string> = {
  Survival: "text-emerald-400 bg-emerald-500/10",
  Creative: "text-purple-400 bg-purple-500/10",
  Combat: "text-red-400 bg-red-500/10",
  Items: "text-brand-400 bg-brand-500/10",
  World: "text-blue-400 bg-blue-500/10",
};

export function Trainer() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const {
    cheats,
    savedProfiles,
    speedMultiplier,
    jumpMultiplier,
    loading,
    fetchCheats,
    toggle,
    saveProfile,
    loadProfile,
    deleteProfile,
    reset,
    setMultiplier,
  } = useTrainerStore();

  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.bepinex_path) {
      fetchCheats(profile.bepinex_path);
    }
  }, [profile?.bepinex_path, fetchCheats]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Numpad key bindings — mirrors MegaTrainer's in-game NumpadBindings
  const numpadMap: Record<string, string> = {
    Numpad0: "god_mode",
    Numpad1: "unlimited_stamina",
    Numpad2: "unlimited_weight",
    Numpad3: "ghost_mode",
    Numpad4: "fly_mode",
    Numpad5: "no_placement_cost",
    Numpad6: "no_weather_damage",
    Numpad7: "instant_kill",
    Numpad8: "no_durability_loss",
  };

  // ALT + Numpad bindings
  const altNumpadMap: Record<string, string> = {
    Numpad0: "explore_map",
    Numpad1: "always_rested",
    Numpad2: "infinite_eitr",
    Numpad3: "tame_all",
    Numpad4: "no_structure_damage",
    Numpad5: "fast_skill_up",
  };

  // Reverse lookup: cheat ID → key label for display
  const cheatKeyLabel: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(numpadMap).map(([code, id]) => [id, code.replace("Numpad", "Num ")])
    ),
    ...Object.fromEntries(
      Object.entries(altNumpadMap).map(([code, id]) => [id, "Alt+" + code.replace("Numpad", "Num ")])
    ),
  };

  useEffect(() => {
    if (!profile?.bepinex_path) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // ALT + Numpad toggles
      if (e.altKey) {
        const cheatId = altNumpadMap[e.code];
        if (cheatId) {
          e.preventDefault();
          const cheat = cheats.find((c) => c.id === cheatId);
          if (cheat) {
            toggle(profile.bepinex_path, cheatId, !cheat.enabled);
            setToast(`${cheat.name}: ${!cheat.enabled ? "ON" : "OFF"}`);
          }
          return;
        }
      }

      // Regular numpad toggles (no modifier)
      if (!e.altKey) {
        const cheatId = numpadMap[e.code];
        if (cheatId) {
          e.preventDefault();
          const cheat = cheats.find((c) => c.id === cheatId);
          if (cheat) {
            toggle(profile.bepinex_path, cheatId, !cheat.enabled);
            setToast(`${cheat.name}: ${!cheat.enabled ? "ON" : "OFF"}`);
          }
          return;
        }
      }

      const ctrl = e.ctrlKey;
      if (e.code === "NumpadAdd") {
        e.preventDefault();
        if (ctrl) {
          const val = Math.round(Math.min(jumpMultiplier + 0.1, 16) * 10) / 10;
          setMultiplier(profile.bepinex_path, "jump", val);
          useTrainerStore.setState({ jumpMultiplier: val });
          setToast(`Jump Height: ${val.toFixed(1)}x`);
        } else {
          const val = Math.round(Math.min(speedMultiplier + 0.1, 16) * 10) / 10;
          setMultiplier(profile.bepinex_path, "speed", val);
          useTrainerStore.setState({ speedMultiplier: val });
          setToast(`Speed: ${val.toFixed(1)}x`);
        }
        return;
      }
      if (e.code === "NumpadSubtract") {
        e.preventDefault();
        if (ctrl) {
          const val = Math.round(Math.max(jumpMultiplier - 0.1, 0.1) * 10) / 10;
          setMultiplier(profile.bepinex_path, "jump", val);
          useTrainerStore.setState({ jumpMultiplier: val });
          setToast(`Jump Height: ${val.toFixed(1)}x`);
        } else {
          const val = Math.round(Math.max(speedMultiplier - 0.1, 0.1) * 10) / 10;
          setMultiplier(profile.bepinex_path, "speed", val);
          useTrainerStore.setState({ speedMultiplier: val });
          setToast(`Speed: ${val.toFixed(1)}x`);
        }
        return;
      }
      if (e.code === "NumpadMultiply") {
        e.preventDefault();
        setMultiplier(profile.bepinex_path, "speed", 1.0);
        setMultiplier(profile.bepinex_path, "jump", 1.0);
        useTrainerStore.setState({ speedMultiplier: 1.0, jumpMultiplier: 1.0 });
        setToast("Speed & Jump: 1.0x (reset)");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [profile?.bepinex_path, cheats, toggle, setMultiplier, speedMultiplier, jumpMultiplier]);

  const handleToggle = async (cheatId: string, enabled: boolean) => {
    if (!profile?.bepinex_path) return;
    await toggle(profile.bepinex_path, cheatId, enabled);
  };

  const handleSave = async () => {
    if (!profile?.bepinex_path || !saveName.trim()) return;
    await saveProfile(profile.bepinex_path, saveName.trim());
    setToast(`Saved profile: ${saveName.trim()}`);
    setActiveProfileName(saveName.trim());
    setSaveName("");
    setShowSaveInput(false);
  };

  const handleQuickSave = async () => {
    if (!profile?.bepinex_path || !activeProfileName) return;
    await saveProfile(profile.bepinex_path, activeProfileName);
    setToast(`Saved: ${activeProfileName}`);
  };

  const handleLoad = async (name: string) => {
    if (!profile?.bepinex_path) return;
    await loadProfile(profile.bepinex_path, name);
    setActiveProfileName(name);
    setToast(`Loaded profile: ${name}`);
  };

  const handleDelete = async (name: string) => {
    if (!profile?.bepinex_path) return;
    await deleteProfile(profile.bepinex_path, name);
    if (activeProfileName === name) setActiveProfileName(null);
    setToast(`Deleted profile: ${name}`);
  };

  const handleReset = async () => {
    if (!profile?.bepinex_path) return;
    await reset(profile.bepinex_path);
    setActiveProfileName(null);
    setToast("All cheats disabled");
  };

  // Debounced multiplier persistence
  const multiplierTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handleMultiplier = useCallback(
    (kind: "speed" | "jump", value: number) => {
      if (!profile?.bepinex_path) return;
      const rounded = Math.round(value * 10) / 10;
      // Optimistic update in store
      if (kind === "speed") useTrainerStore.setState({ speedMultiplier: rounded });
      else useTrainerStore.setState({ jumpMultiplier: rounded });
      // Debounce the backend call
      clearTimeout(multiplierTimers.current[kind]);
      multiplierTimers.current[kind] = setTimeout(() => {
        setMultiplier(profile.bepinex_path, kind, rounded);
      }, 150);
    },
    [profile?.bepinex_path, setMultiplier]
  );

  // Group cheats by category
  const categories = [...new Set(cheats.map((c) => c.category))];
  const filteredCheats = activeCategory
    ? cheats.filter((c) => c.category === activeCategory)
    : cheats;
  const enabledCount = cheats.filter((c) => c.enabled).length;

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-300">
          No Active Profile
        </h2>
        <p className="text-zinc-500 mt-2">
          Select a profile to use the trainer
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Toast */}
      {toast && (
        <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-lg bg-brand-500/90 text-zinc-950 text-sm font-medium shadow-xl animate-in slide-in-from-top-2 duration-300">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">Trainer</h1>
          <p className="text-zinc-500 mt-1">
            {enabledCount} cheat{enabledCount !== 1 ? "s" : ""} active
            {enabledCount > 0 && (
              <span className="text-brand-400"> &middot; Active</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={enabledCount === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset All
          </button>
          {activeProfileName && (
            <button
              onClick={handleQuickSave}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500 text-zinc-950 text-xs font-bold hover:bg-brand-400 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save "{activeProfileName}"
            </button>
          )}
          <button
            onClick={() => setShowSaveInput(!showSaveInput)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500/15 text-brand-400 text-xs font-semibold hover:bg-brand-500/25 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save As
          </button>
        </div>
      </div>

      {/* Save Profile Input */}
      {showSaveInput && (
        <div className="glass rounded-xl p-4 border border-brand-500/20 mb-4 flex items-center gap-3 animate-in slide-in-from-top-2 duration-200">
          <Save className="w-4 h-4 text-brand-400 shrink-0" />
          <input
            type="text"
            placeholder="Profile name..."
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setShowSaveInput(false);
            }}
            autoFocus
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 transition-all"
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            className="px-4 py-2 rounded-lg bg-brand-500 text-zinc-950 text-xs font-bold hover:bg-brand-400 transition-colors disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => setShowSaveInput(false)}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* Saved Profiles */}
      {savedProfiles.length > 0 && (
        <div className="mb-4">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Saved States
          </h2>
          <div className="flex flex-wrap gap-2">
            {savedProfiles.map((sp) => {
              const activeCount = sp.cheats.filter((c) => c.enabled).length;
              const isActive = sp.name === activeProfileName;
              return (
                <div
                  key={sp.name}
                  className={cn(
                    "flex items-center gap-1 glass rounded-lg border overflow-hidden",
                    isActive ? "border-brand-500/40 bg-brand-500/5" : "border-zinc-800/50"
                  )}
                >
                  <button
                    onClick={() => handleLoad(sp.name)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {sp.name}
                    <span className="text-[10px] text-zinc-500">
                      ({activeCount} active)
                    </span>
                  </button>
                  <button
                    onClick={() => handleDelete(sp.name)}
                    className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category Filter */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActiveCategory(null)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            !activeCategory
              ? "bg-zinc-800 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          All
        </button>
        {categories.map((cat) => {
          const Icon = categoryIcons[cat] || Shield;
          const colors = categoryColors[cat] || "text-zinc-400 bg-zinc-500/10";
          const colorParts = colors.split(" ");
          return (
            <button
              key={cat}
              onClick={() =>
                setActiveCategory(activeCategory === cat ? null : cat)
              }
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                activeCategory === cat
                  ? `${colorParts[1]} ${colorParts[0]}`
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat}
            </button>
          );
        })}
      </div>

      {/* Speed & Jump Sliders */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Speed */}
        <div className={cn(
          "glass rounded-xl p-4 border transition-all duration-300",
          speedMultiplier !== 1.0
            ? "border-brand-500/30 bg-brand-500/5"
            : "border-zinc-800/30"
        )}>
          <div className="flex items-center gap-2 mb-3">
            <div className={cn("p-1.5 rounded-lg", speedMultiplier !== 1.0 ? "bg-brand-500/15" : "bg-blue-500/10")}>
              <Gauge className={cn("w-4 h-4", speedMultiplier !== 1.0 ? "text-brand-400" : "text-blue-400")} />
            </div>
            <h3 className="font-semibold text-zinc-200 text-sm">Player Speed</h3>
            <span className={cn(
              "ml-auto text-sm font-bold tabular-nums",
              speedMultiplier !== 1.0 ? "text-brand-400" : "text-zinc-500"
            )}>
              {speedMultiplier.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="16"
            step="0.1"
            value={speedMultiplier}
            onChange={(e) => handleMultiplier("speed", parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-500 bg-zinc-700"
          />
          <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
            <span>0.1x</span>
            <span>1.0x</span>
            <span>16.0x</span>
          </div>
        </div>

        {/* Jump */}
        <div className={cn(
          "glass rounded-xl p-4 border transition-all duration-300",
          jumpMultiplier !== 1.0
            ? "border-brand-500/30 bg-brand-500/5"
            : "border-zinc-800/30"
        )}>
          <div className="flex items-center gap-2 mb-3">
            <div className={cn("p-1.5 rounded-lg", jumpMultiplier !== 1.0 ? "bg-brand-500/15" : "bg-purple-500/10")}>
              <ArrowUpFromDot className={cn("w-4 h-4", jumpMultiplier !== 1.0 ? "text-brand-400" : "text-purple-400")} />
            </div>
            <h3 className="font-semibold text-zinc-200 text-sm">Jump Height</h3>
            <span className={cn(
              "ml-auto text-sm font-bold tabular-nums",
              jumpMultiplier !== 1.0 ? "text-brand-400" : "text-zinc-500"
            )}>
              {jumpMultiplier.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="16"
            step="0.1"
            value={jumpMultiplier}
            onChange={(e) => handleMultiplier("jump", parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-500 bg-zinc-700"
          />
          <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
            <span>0.1x</span>
            <span>1.0x</span>
            <span>16.0x</span>
          </div>
        </div>
      </div>

      {/* Cheat Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredCheats.map((cheat) => {
              const Icon = categoryIcons[cheat.category] || Shield;
              const colors =
                categoryColors[cheat.category] ||
                "text-zinc-400 bg-zinc-500/10";
              const colorParts = colors.split(" ");

              return (
                <div
                  key={cheat.id}
                  className={cn(
                    "glass rounded-xl p-4 border transition-all duration-300 group",
                    cheat.enabled
                      ? "border-brand-500/30 bg-brand-500/5"
                      : "border-zinc-800/30 hover:border-zinc-700/50"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <div
                          className={cn(
                            "p-1.5 rounded-lg",
                            cheat.enabled
                              ? "bg-brand-500/15"
                              : colorParts[1]
                          )}
                        >
                          <Icon
                            className={cn(
                              "w-4 h-4",
                              cheat.enabled
                                ? "text-brand-400"
                                : colorParts[0]
                            )}
                          />
                        </div>
                        <h3 className="font-semibold text-zinc-200 text-sm">
                          {cheat.name}
                        </h3>
                        {cheatKeyLabel[cheat.id] && (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono font-semibold text-zinc-400 border border-zinc-700/50 shrink-0">
                            {cheatKeyLabel[cheat.id]}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        {cheat.description}
                      </p>
                    </div>

                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(cheat.id, !cheat.enabled)}
                      className={cn(
                        "relative w-14 h-7 rounded-full transition-colors duration-300 shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500/25",
                        cheat.enabled ? "bg-brand-500" : "bg-zinc-700"
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300",
                          cheat.enabled ? "left-[30px]" : "left-1"
                        )}
                      />
                      <span
                        className={cn(
                          "absolute text-[9px] font-bold uppercase top-1/2 -translate-y-1/2",
                          cheat.enabled
                            ? "left-2 text-zinc-900"
                            : "right-2 text-zinc-400"
                        )}
                      >
                        {cheat.enabled ? "ON" : "OFF"}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Banner */}
      <div className="mt-4 glass rounded-xl p-4 border border-zinc-800/30 flex items-start gap-3">
        <Wind className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-zinc-400">
            <span className="font-semibold text-zinc-300">
              How it works:
            </span>{" "}
            Toggle cheats here or in-game with Numpad 0-9 (Alt+Num for extras). Speed: Num+/Num-, Jump: Ctrl+Num+/Num-, Reset: Num*.
            MegaLoad auto-installs the trainer plugin.
          </p>
          <p className="text-[10px] text-zinc-600 mt-1">
            Save states persist across sessions. In-game hotkeys sync back to MegaLoad.
          </p>
        </div>
      </div>
    </div>
  );
}
