import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { useProfileStore } from "../stores/profileStore";
import {
  getConfigFiles,
  saveConfigValue,
  resetConfigFile,
  cleanOrphanConfigs,
  deleteConfigFile,
  startConfigWatcher,
  stopConfigWatcher,
  type ConfigFile,
  type ConfigEntry,
  type ConfigSection,
} from "../lib/tauri-api";
import {
  Search,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  AlertCircle,
  Settings2,
  FileText,
  X,
  Undo2,
  List,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn, formatModName } from "../lib/utils";

/** Natural sort comparator — handles "1 - Foo", "2 - Bar", "10 - Baz" correctly */
function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aParts = a.match(re) || [];
  const bParts = b.match(re) || [];
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    if (i >= aParts.length) return -1;
    if (i >= bParts.length) return 1;
    const aIsNum = /^\d+$/.test(aParts[i]);
    const bIsNum = /^\d+$/.test(bParts[i]);
    if (aIsNum && bIsNum) {
      const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
      if (diff !== 0) return diff;
    } else {
      const cmp = aParts[i].localeCompare(bParts[i]);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

function sortSections(sections: ConfigSection[]): ConfigSection[] {
  return [...sections].sort((a, b) => naturalCompare(a.name, b.name));
}

export function ConfigEditor() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const [configs, setConfigs] = useState<ConfigFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedMod, setSelectedMod] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );
  const [changeCount, setChangeCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ConfigFile | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedModRef = useRef(selectedMod);
  selectedModRef.current = selectedMod;

  // Reload configs from disk, preserving UI state (selected mod, expanded sections)
  const reloadConfigs = useCallback(
    async (isInitial = false) => {
      if (!profile?.bepinex_path) return;
      try {
        const files = await getConfigFiles(profile.bepinex_path);
        setConfigs(files);
        // Preserve selectedMod if it still exists; auto-select first on initial load
        const current = selectedModRef.current;
        if (current && files.some((f) => f.file_name === current)) {
          // Keep current selection — no-op
        } else if (isInitial && files.length > 0) {
          setSelectedMod(files[0].file_name);
        }
      } catch {
        // silently ignore reload failures
      }
    },
    [profile?.bepinex_path]
  );

  // Initial load + orphan cleanup
  useEffect(() => {
    if (profile?.bepinex_path) {
      setLoading(true);
      cleanOrphanConfigs(profile.bepinex_path)
        .catch((e) => console.warn("[MegaLoad]", e))
        .then(() => reloadConfigs(true))
        .finally(() => setLoading(false));
    }
  }, [profile?.bepinex_path, reloadConfigs]);

  // File watcher: watch BepInEx/config for changes and reload
  useEffect(() => {
    if (!profile?.bepinex_path) return;

    startConfigWatcher(profile.bepinex_path).catch((e) => console.warn("[MegaLoad]", e));

    const unlistenPromise = listen("config-files-changed", () => {
      reloadConfigs();
    });

    return () => {
      stopConfigWatcher().catch((e) => console.warn("[MegaLoad]", e));
      unlistenPromise.then((fn) => fn());
    };
  }, [profile?.bepinex_path, reloadConfigs]);

  // Reload when window regains focus (catches config changes from game runs, manual edits, etc.)
  useEffect(() => {
    const handleFocus = () => reloadConfigs();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [reloadConfigs]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      if (prev.has(key) && prev.size === 1) {
        // Already the only expanded section — collapse it
        return new Set<string>();
      }
      // Accordion: expand only this one, collapse all others
      return new Set([key]);
    });
  };

  const handleSave = useCallback(
    async (
      configPath: string,
      section: string,
      key: string,
      value: string
    ) => {
      await saveConfigValue(configPath, section, key, value);
      setConfigs((prev) =>
        prev.map((cfg) =>
          cfg.path === configPath
            ? {
                ...cfg,
                sections: cfg.sections.map((sec) =>
                  sec.name === section
                    ? {
                        ...sec,
                        entries: sec.entries.map((entry) =>
                          entry.key === key ? { ...entry, value } : entry
                        ),
                      }
                    : sec
                ),
              }
            : cfg
        )
      );
      setChangeCount((c) => c + 1);
    },
    []
  );

  const handleResetFile = async (configPath: string) => {
    try {
      const updated = await resetConfigFile(configPath);
      setConfigs((prev) =>
        prev.map((cfg) => (cfg.path === configPath ? updated : cfg))
      );
      setToast("Reset all values to defaults");
    } catch (e) {
      setToast(`Error: ${e}`);
    }
  };

  const handleDeleteFile = async (config: ConfigFile) => {
    try {
      await deleteConfigFile(config.path);
      setConfigs((prev) => prev.filter((cfg) => cfg.path !== config.path));
      setSelectedMod(null);
      setDeleteConfirm(null);
      setToast(`Deleted ${config.file_name}`);
    } catch (e) {
      setToast(`Error: ${e}`);
      setDeleteConfirm(null);
    }
  };

  const selectedConfig = configs.find((c) => c.file_name === selectedMod);

  // Sort sections naturally (1, 2, 3... not 1, 10, 11, 2...)
  const sortedSections = useMemo(
    () => (selectedConfig ? sortSections(selectedConfig.sections) : []),
    [selectedConfig]
  );

  const scrollToSection = (sectionKey: string) => {
    // Accordion: expand only this section, collapse all others
    setExpandedSections(new Set([sectionKey]));
    // Scroll after re-render, accounting for the sticky header
    setTimeout(() => {
      const el = sectionRefs.current[sectionKey];
      const container = contentRef.current;
      if (el && container) {
        const headerHeight = 72; // sticky mod title header (~py-4 + content)
        const elTop = el.offsetTop - headerHeight;
        container.scrollTo({ top: Math.max(0, elTop), behavior: "smooth" });
      }
    }, 0);
  };

  // Check if all sections are expanded
  const allSectionsExpanded =
    selectedConfig != null &&
    sortedSections.length > 0 &&
    sortedSections.every((s) =>
      expandedSections.has(`${selectedConfig.file_name}:${s.name}`)
    );

  const toggleAllSections = () => {
    if (!selectedConfig) return;
    if (allSectionsExpanded) {
      // Collapse all
      setExpandedSections(new Set());
    } else {
      // Expand all
      const allKeys = sortedSections.map(
        (s) => `${selectedConfig.file_name}:${s.name}`
      );
      setExpandedSections(new Set(allKeys));
    }
  };

  // Filter mod list by sidebar search
  const filteredConfigs = search
    ? configs.filter(
        (c) =>
          c.mod_name.toLowerCase().includes(search.toLowerCase()) ||
          formatModName(c.mod_name).toLowerCase().includes(search.toLowerCase()) ||
          c.file_name.toLowerCase().includes(search.toLowerCase())
      )
    : configs;

  // Global search: filter entries across all configs
  const globalSearchResults =
    globalSearch.length >= 2
      ? configs.flatMap((cfg) =>
          cfg.sections.flatMap((sec) =>
            sec.entries
              .filter(
                (entry) =>
                  entry.key
                    .toLowerCase()
                    .includes(globalSearch.toLowerCase()) ||
                  entry.description
                    ?.toLowerCase()
                    .includes(globalSearch.toLowerCase()) ||
                  entry.value
                    .toLowerCase()
                    .includes(globalSearch.toLowerCase())
              )
              .map((entry) => ({
                config: cfg,
                section: sec,
                entry,
              }))
          )
        )
      : [];

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-300">
          No Active Profile
        </h2>
        <p className="text-zinc-500 mt-2">Select or create a profile first</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Toast */}
      {toast && (
        <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-lg bg-brand-500/90 text-zinc-950 text-sm font-medium shadow-xl animate-in slide-in-from-top-2 duration-300">
          {toast}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass rounded-2xl border border-zinc-700/50 shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-red-500/10">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-200">
                Delete Config File
              </h3>
            </div>
            <p className="text-sm text-zinc-400 mb-2">
              Are you sure you want to delete the config file for{" "}
              <span className="font-semibold text-zinc-200">
                {formatModName(deleteConfirm.mod_name)}
              </span>
              ?
            </p>
            <p className="text-xs text-zinc-600 font-mono mb-1">
              {deleteConfirm.file_name}
            </p>
            <p className="text-xs text-zinc-500 mb-5">
              The mod will regenerate a default config file on next game launch.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteFile(deleteConfirm)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300 border border-red-500/20 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide">Config Editor</h1>
          <p className="text-zinc-500 mt-1">
            Edit BepInEx mod configurations
            {changeCount > 0 && (
              <span className="ml-2 text-brand-400">
                &middot; {changeCount} change{changeCount > 1 ? "s" : ""} saved
              </span>
            )}
          </p>
        </div>

        {/* Global Search + Refresh */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => reloadConfigs()}
            className="p-2.5 rounded-lg glass border border-zinc-800 text-zinc-400 hover:text-brand-400 hover:border-brand-500/50 transition-all"
            title="Reload configs from disk"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search all settings..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-lg glass border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all"
          />
          {globalSearch && (
            <button
              onClick={() => setGlobalSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Global Search Results */}
      {globalSearch.length >= 2 && (
        <div className="mb-4 glass rounded-xl border border-brand-500/20 max-h-80 overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-zinc-800/50 flex items-center justify-between sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Search Results ({globalSearchResults.length})
            </span>
            <button
              onClick={() => setGlobalSearch("")}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear
            </button>
          </div>
          {globalSearchResults.length === 0 ? (
            <p className="text-sm text-zinc-500 p-4">No matching settings</p>
          ) : (
            <div className="divide-y divide-zinc-800/30">
              {globalSearchResults.slice(0, 50).map((result, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedMod(result.config.file_name);
                    setGlobalSearch("");
                    const key = `${result.config.file_name}:${result.section.name}`;
                    setExpandedSections((prev) => new Set([...prev, key]));
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">
                      {result.entry.key}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                      {formatModName(result.config.mod_name)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {result.entry.description || result.entry.value}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Config File List */}
        <div className="w-64 shrink-0 glass rounded-xl border border-zinc-800/50 flex flex-col">
          <div className="p-3 border-b border-zinc-800/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Filter mods..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 transition-all"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {loading ? (
              <div className="flex items-center gap-2 p-3">
                <div className="w-3 h-3 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
                <span className="text-xs text-zinc-500">Loading...</span>
              </div>
            ) : filteredConfigs.length === 0 ? (
              <p className="text-xs text-zinc-500 p-3">
                No config files found
              </p>
            ) : (
              filteredConfigs.map((cfg) => {
                const entryCount = cfg.sections.reduce(
                  (sum, s) => sum + s.entries.length,
                  0
                );
                return (
                  <button
                    key={cfg.file_name}
                    onClick={() => setSelectedMod(cfg.file_name)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200",
                      selectedMod === cfg.file_name
                        ? "bg-brand-500/15 text-brand-400"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      <span className="text-xs font-medium truncate">
                        {formatModName(cfg.mod_name)}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600 ml-6">
                      {entryCount} setting{entryCount !== 1 ? "s" : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Config Content */}
        <div className="flex-1 flex min-w-0 gap-0">
          {/* Section Navigation Menu */}
          {selectedConfig && sortedSections.length > 1 && (
            <div className="w-48 shrink-0 glass rounded-l-xl border border-r-0 border-zinc-800/50 flex flex-col">
              <div className="px-3 py-3 border-b border-zinc-800/50 flex items-center gap-2">
                <List className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Sections
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {/* Show All / Hide All toggle — sticky at top */}
                <button
                  onClick={toggleAllSections}
                  className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold text-brand-400 hover:bg-brand-500/10 transition-colors sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/30 mb-1"
                >
                  {allSectionsExpanded ? "Hide All" : "Show All"}
                </button>
                {sortedSections.map((section) => {
                  const sectionKey = `${selectedConfig.file_name}:${section.name}`;
                  const isActive = expandedSections.has(sectionKey) && expandedSections.size === 1;
                  return (
                    <button
                      key={sectionKey}
                      onClick={() => scrollToSection(sectionKey)}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors truncate",
                        isActive
                          ? "bg-brand-500/15 text-brand-400"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                      )}
                      title={section.name}
                    >
                      <span className="truncate block">{section.name}</span>
                      <span className="text-[9px] text-zinc-600">
                        {section.entries.length} setting{section.entries.length !== 1 ? "s" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Config Entries */}
          <div
            ref={contentRef}
            className={cn(
              "flex-1 glass border border-zinc-800/50 overflow-y-auto",
              selectedConfig && sortedSections.length > 1
                ? "rounded-r-xl border-l-0"
                : "rounded-xl"
            )}
          >
          {!selectedConfig ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Settings2 className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-zinc-500 text-sm">
                Select a config file to edit
              </p>
            </div>
          ) : (
            <div>
              {/* Config Header */}
              <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm px-5 py-4 border-b border-zinc-800/50 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-200">
                    {formatModName(selectedConfig.mod_name)}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5 font-mono">
                    {selectedConfig.file_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleResetFile(selectedConfig.path)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
                    title="Reset all to defaults"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Reset All
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(selectedConfig)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete config file"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Sections */}
              <div className="p-5 space-y-3">
                {sortedSections.map((section) => {
                  const sectionKey = `${selectedConfig.file_name}:${section.name}`;
                  const isExpanded = expandedSections.has(sectionKey);

                  return (
                    <div
                      key={sectionKey}
                      ref={(el) => { sectionRefs.current[sectionKey] = el; }}
                      className="rounded-xl border border-zinc-800/40 overflow-hidden bg-zinc-900/30"
                    >
                      <button
                        onClick={() => toggleSection(sectionKey)}
                        className="w-full flex items-center gap-2.5 px-5 py-3.5 hover:bg-zinc-800/30 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-zinc-500" />
                        )}
                        <span className="text-sm font-semibold text-zinc-300">
                          {section.name}
                        </span>
                        <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-full ml-auto">
                          {section.entries.length}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="divide-y divide-zinc-800/20">
                          {section.entries.map((entry) => (
                            <ConfigEntryRow
                              key={entry.key}
                              entry={entry}
                              onSave={(value) =>
                                handleSave(
                                  selectedConfig.path,
                                  section.name,
                                  entry.key,
                                  value
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Smart Config Entry Row — renders the right control per type
// ============================================================

function ConfigEntryRow({
  entry,
  onSave,
}: {
  entry: ConfigEntry;
  onSave: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(entry.value);

  // Detect types
  const isBoolean =
    entry.value_type === "Boolean" ||
    entry.value.toLowerCase() === "true" ||
    entry.value.toLowerCase() === "false";
  const hasAcceptable =
    entry.acceptable_values && entry.acceptable_values.length > 0;
  const isNumber =
    entry.value_type === "Int32" ||
    entry.value_type === "Single" ||
    entry.value_type === "Double" ||
    entry.value_type === "Float";
  const isKeyboard = entry.value_type === "KeyboardShortcut";
  const isColor =
    entry.value_type === "Color" ||
    /^#[0-9a-fA-F]{6,8}$/.test(entry.value) ||
    /^RGBA\(/.test(entry.value);

  // Parse numeric range from acceptable values
  const numRange = parseNumericRange(entry);

  useEffect(() => {
    setLocalValue(entry.value);
  }, [entry.value]);

  const handleReset = () => {
    if (entry.default_value !== null) {
      setLocalValue(entry.default_value);
      onSave(entry.default_value);
    }
  };

  const isDefault =
    entry.default_value !== null && localValue === entry.default_value;

  // Wide controls (sliders, text inputs, selects) go on their own row
  const isWideControl = (isNumber && numRange) || (!isBoolean && !isColor && !isKeyboard);

  const controlEl = isBoolean ? (
    <BooleanToggle
      value={localValue}
      onChange={(v) => {
        setLocalValue(v);
        onSave(v);
      }}
    />
  ) : isNumber && numRange ? (
    <SliderControl
      value={localValue}
      min={numRange.min}
      max={numRange.max}
      step={numRange.step}
      isFloat={
        entry.value_type === "Single" ||
        entry.value_type === "Float" ||
        entry.value_type === "Double"
      }
      onChange={setLocalValue}
      onCommit={(v) => onSave(v)}
    />
  ) : hasAcceptable ? (
    <SelectControl
      value={localValue}
      options={entry.acceptable_values!}
      onChange={(v) => {
        setLocalValue(v);
        onSave(v);
      }}
    />
  ) : isKeyboard ? (
    <KeybindCapture
      value={localValue}
      onChange={(v) => {
        setLocalValue(v);
        onSave(v);
      }}
    />
  ) : isColor ? (
    <ColorPicker
      value={localValue}
      onChange={(v) => {
        setLocalValue(v);
        onSave(v);
      }}
    />
  ) : isNumber ? (
    <NumberInput
      value={localValue}
      onChange={setLocalValue}
      onCommit={(v) => onSave(v)}
    />
  ) : (
    <TextInput
      value={localValue}
      onChange={setLocalValue}
      onCommit={(v) => onSave(v)}
    />
  );

  const resetBtn = !isDefault && entry.default_value !== null && (
    <button
      onClick={handleReset}
      className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-600 hover:text-brand-400 transition-colors opacity-0 group-hover/entry:opacity-100"
      title={`Reset to: ${entry.default_value}`}
    >
      <RotateCcw className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="px-5 py-4 hover:bg-zinc-800/20 transition-colors group/entry">
      {/* Title row — label + inline controls for compact types (boolean, color, keybind) */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-200">
              {entry.key}
            </span>
            {entry.value_type && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-zinc-500 font-mono">
                {entry.value_type}
              </span>
            )}
            {!isDefault && entry.default_value !== null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand-500/10 text-brand-400 font-medium">
                Modified
              </span>
            )}
          </div>
        </div>

        {/* Inline controls for compact types */}
        {!isWideControl && (
          <div className="flex items-center gap-2 shrink-0">
            {resetBtn}
            {controlEl}
          </div>
        )}
      </div>

      {/* Description & default */}
      {(entry.description || entry.default_value !== null) && (
        <div className="mt-1.5">
          {entry.description && (
            <p className="text-xs text-zinc-500 leading-relaxed max-w-lg">
              {entry.description}
            </p>
          )}
          {entry.default_value !== null && (
            <p className="text-[10px] text-zinc-600 mt-1 font-mono">
              Default: {entry.default_value}
            </p>
          )}
        </div>
      )}

      {/* Wide controls on their own row */}
      {isWideControl && (
        <div className="flex items-center gap-2 mt-3">
          {controlEl}
          {resetBtn}
        </div>
      )}
    </div>
  );
}

// ------------------
// Boolean Toggle
// ------------------

function BooleanToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const isOn = value.toLowerCase() === "true";
  return (
    <button
      onClick={() => onChange(isOn ? "false" : "true")}
      className={cn(
        "relative w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-brand-500/25",
        isOn ? "bg-brand-500" : "bg-zinc-700"
      )}
    >
      <div
        className={cn(
          "absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300",
          isOn ? "left-[30px]" : "left-1"
        )}
      />
      <span
        className={cn(
          "absolute text-[9px] font-bold uppercase top-1/2 -translate-y-1/2",
          isOn ? "left-2 text-zinc-900" : "right-2 text-zinc-400"
        )}
      >
        {isOn ? "ON" : "OFF"}
      </span>
    </button>
  );
}

// ------------------
// Select Dropdown
// ------------------

function SelectControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all cursor-pointer min-w-[160px]"
    >
      {options.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

// ------------------
// Keybind Capture
// ------------------

function KeybindCapture({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!capturing) return;

    const handleKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("LeftControl");
      if (e.shiftKey) parts.push("LeftShift");
      if (e.altKey) parts.push("LeftAlt");

      // Map key to Unity KeyCode format
      const keyMap: Record<string, string> = {
        " ": "Space",
        Enter: "Return",
        Escape: "Escape",
        Tab: "Tab",
        Backspace: "Backspace",
        Delete: "Delete",
        ArrowUp: "UpArrow",
        ArrowDown: "DownArrow",
        ArrowLeft: "LeftArrow",
        ArrowRight: "RightArrow",
        Control: "",
        Shift: "",
        Alt: "",
        Meta: "",
      };

      let key = keyMap[e.key] !== undefined ? keyMap[e.key] : e.key;
      if (key.length === 1) key = key.toUpperCase();

      if (key) {
        const modifiers = parts.length > 0 ? " + " + parts.join(" + ") : "";
        onChange(key + modifiers);
      }

      setCapturing(false);
    };

    const handleBlur = () => setCapturing(false);

    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [capturing, onChange]);

  const displayValue = value === "None" || !value ? "Not set" : value;

  return (
    <div className="flex items-center gap-2">
      <button
        ref={ref}
        onClick={() => setCapturing(true)}
        className={cn(
          "px-4 py-2 rounded-lg border text-sm font-mono min-w-[140px] text-center transition-all",
          capturing
            ? "bg-brand-500/10 border-brand-500 text-brand-400 animate-pulse"
            : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-600"
        )}
      >
        {capturing ? "Press a key..." : displayValue}
      </button>
      {value && value !== "None" && (
        <button
          onClick={() => onChange("None")}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
          title="Clear keybind"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ------------------
// Color Picker
// ------------------

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const toHex = (v: string): string => {
    if (v.startsWith("#")) return v.slice(0, 7);
    const match = v.match(/RGBA\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    if (match) {
      const r = Math.round(parseFloat(match[1]) * 255);
      const g = Math.round(parseFloat(match[2]) * 255);
      const b = Math.round(parseFloat(match[3]) * 255);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    return "#ffffff";
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={toHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-8 rounded cursor-pointer border border-zinc-700 bg-transparent"
      />
      <span className="text-xs font-mono text-zinc-400 min-w-[70px]">
        {value}
      </span>
    </div>
  );
}

// ------------------
// Slider Control
// ------------------

function SliderControl({
  value,
  min,
  max,
  step,
  isFloat,
  onChange,
  onCommit,
}: {
  value: string;
  min: number;
  max: number;
  step: number;
  isFloat: boolean;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const numVal = parseFloat(value) || 0;
  const pct = Math.min(100, Math.max(0, ((numVal - min) / (max - min)) * 100));

  return (
    <div className="flex items-center gap-3 min-w-[240px]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={numVal}
        onChange={(e) => {
          const v = isFloat
            ? parseFloat(e.target.value).toString()
            : Math.round(parseFloat(e.target.value)).toString();
          onChange(v);
        }}
        onMouseUp={(e) => onCommit((e.target as HTMLInputElement).value)}
        onKeyUp={(e) => onCommit((e.target as HTMLInputElement).value)}
        className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-brand-500"
        style={{
          background: `linear-gradient(to right, rgb(245 158 11) ${pct}%, rgb(63 63 70) ${pct}%)`,
        }}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        className="w-20 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 text-right font-mono focus:outline-none focus:border-brand-500/50 transition-all"
      />
    </div>
  );
}

// ------------------
// Number Input
// ------------------

function NumberInput({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
      }}
      className="w-28 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 text-right font-mono focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all"
    />
  );
}

// ------------------
// Text Input
// ------------------

function TextInput({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
      }}
      className="w-52 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 font-mono focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all"
    />
  );
}

// ------------------
// Parse range from BepInEx config metadata
// ------------------

function parseNumericRange(entry: ConfigEntry): {
  min: number;
  max: number;
  step: number;
} | null {
  if (entry.acceptable_values) {
    for (const av of entry.acceptable_values) {
      const rangeMatch = av.match(
        /(?:From\s+)?(-?[\d.]+)\s+to\s+(-?[\d.]+)/i
      );
      if (rangeMatch) {
        const min = parseFloat(rangeMatch[1]);
        const max = parseFloat(rangeMatch[2]);
        const isFloat =
          entry.value_type === "Single" ||
          entry.value_type === "Float" ||
          entry.value_type === "Double";
        return { min, max, step: isFloat ? (max - min) / 100 : 1 };
      }
    }
  }

  if (entry.description) {
    const rangeMatch = entry.description.match(
      /(?:range|between|from)\s*:?\s*(-?[\d.]+)\s*(?:to|-|~)\s*(-?[\d.]+)/i
    );
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      const isFloat =
        entry.value_type === "Single" ||
        entry.value_type === "Float" ||
        entry.value_type === "Double";
      return { min, max, step: isFloat ? (max - min) / 100 : 1 };
    }
  }

  return null;
}
