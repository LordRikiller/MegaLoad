import { useEffect, useState, useRef } from "react";
import { useProfileStore } from "../stores/profileStore";
import { useThunderstoreStore } from "../stores/thunderstoreStore";
import { useUpdateStore } from "../stores/updateStore";
import {
  getThunderstoreDetail,
  getStarterMods,
  installModUpdate,
  type ThunderstoreListItem,
  type ThunderstoreModDetail,
  type StarterMod,
} from "../lib/tauri-api";
import {
  Search,
  Download,
  Star,
  Package,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ExternalLink,
  Trash2,
  RefreshCw,
  X,
  Filter,
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  Crown,
} from "lucide-react";
import { cn, formatModName } from "../lib/utils";
import { SyncingOverlay } from "../components/SyncingOverlay";

export function Browse() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const { updateResult, checkUpdates } = useUpdateStore();
  const {
    items,
    total,
    page,
    perPage,
    query,
    category,
    categories,
    loading,
    error,
    installedMods,
    installing,
    search,
    loadCategories,
    loadInstalledMods,
    install,
    uninstall,
    setQuery,
    nextPage,
    prevPage,
  } = useThunderstoreStore();

  const [searchInput, setSearchInput] = useState(query);
  const [selectedMod, setSelectedMod] = useState<ThunderstoreModDetail | null>(
    null
  );
  const [_detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ourMods, setOurMods] = useState<StarterMod[]>([]);
  const [installingOurMod, setInstallingOurMod] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    search();
    loadCategories();
    getStarterMods()
      .then(setOurMods)
      .catch((e) => console.warn("[MegaLoad]", e));
  }, []);

  useEffect(() => {
    if (profile?.bepinex_path) {
      loadInstalledMods(profile.bepinex_path);
    }
  }, [profile?.bepinex_path]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Debounced live search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(searchInput);
      search(searchInput, category, 0);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const handleCategoryChange = (cat: string) => {
    const newCat = cat === category ? "" : cat;
    search(query, newCat, 0);
    setShowCategories(false);
  };

  const handleViewDetail = async (item: ThunderstoreListItem) => {
    setDetailLoading(true);
    try {
      const detail = await getThunderstoreDetail(item.full_name);
      setSelectedMod(detail);
    } catch (e) {
      setToast(`Failed to load details: ${e}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleInstall = async (item: ThunderstoreListItem) => {
    if (!profile?.bepinex_path) return;
    try {
      const result = await install(profile.bepinex_path, item);
      setToast(result);
    } catch (e) {
      setToast(`Install failed: ${e}`);
    }
  };

  const handleUninstall = async (fullName: string) => {
    if (!profile?.bepinex_path) return;
    try {
      await uninstall(profile.bepinex_path, fullName);
      setToast("Mod uninstalled");
    } catch (e) {
      setToast(`Uninstall failed: ${e}`);
    }
  };

  const isInstalled = (fullName: string) =>
    installedMods.some((m) => m.full_name === fullName);

  const getInstalledVersion = (fullName: string) =>
    installedMods.find((m) => m.full_name === fullName)?.version ?? null;

  const isOurModInstalled = (modName: string) => {
    if (!updateResult?.mods) return false;
    const mod = updateResult.mods.find((m) => m.name === modName);
    return mod ? mod.status !== "not-installed" : false;
  };

  const handleInstallOurMod = async (mod: StarterMod) => {
    if (!profile?.bepinex_path) return;
    setInstallingOurMod(mod.name);
    try {
      await installModUpdate(profile.bepinex_path, mod.name, mod.download_url, mod.version);
      setToast(`${mod.name} installed!`);
      // Refresh update state so installed status updates
      checkUpdates(profile.bepinex_path, true);
    } catch (e) {
      setToast(`Failed to install ${mod.name}: ${e}`);
    } finally {
      setInstallingOurMod(null);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-300">
          No Active Profile
        </h2>
        <p className="text-zinc-500 mt-2">
          Select a profile to browse and install mods
        </p>
      </div>
    );
  }

  // Detail view
  if (selectedMod) {
    return (
      <ModDetailView
        mod={selectedMod}
        isInstalled={isInstalled(selectedMod.full_name)}
        installedVersion={getInstalledVersion(selectedMod.full_name)}
        installing={installing.has(selectedMod.full_name)}
        onBack={() => setSelectedMod(null)}
        onInstall={async () => {
          if (!profile?.bepinex_path) return;
          try {
            const latest = selectedMod.versions[0];
            const result = await install(profile.bepinex_path, {
              full_name: selectedMod.full_name,
              name: selectedMod.name,
              owner: selectedMod.owner,
              version: latest.version_number,
              description: latest.description,
              downloads: latest.downloads,
              rating: selectedMod.rating,
              icon: selectedMod.icon,
              categories: selectedMod.categories,
              is_deprecated: selectedMod.is_deprecated,
              date_updated: latest.date_created,
              dependency_count: latest.dependencies.length,
            });
            setToast(result);
          } catch (e) {
            setToast(`Install failed: ${e}`);
          }
        }}
        onUninstall={() => handleUninstall(selectedMod.full_name)}
      />
    );
  }

  return (
    <div className="relative flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SyncingOverlay />
      {/* Toast */}
      {toast && (
        <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-lg bg-brand-500/90 text-zinc-950 text-sm font-medium shadow-xl animate-in slide-in-from-top-2 duration-300 max-w-sm">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide">
            Browse Mods
          </h1>
          <p className="text-zinc-500 mt-1">
            {total.toLocaleString()} mods available on Thunderstore
          </p>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search Thunderstore mods..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-lg glass border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all"
          />
          {searchInput && (
            <button
              onClick={() => {
                setSearchInput("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowCategories(!showCategories)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
              category
                ? "bg-brand-500/15 text-brand-400 border border-brand-500/30"
                : "glass border border-zinc-800 text-zinc-400 hover:text-zinc-200"
            )}
          >
            <Filter className="w-4 h-4" />
            {category || "Category"}
          </button>

          {showCategories && (
            <div className="absolute right-0 top-full mt-2 z-50 w-64 max-h-80 overflow-y-auto glass rounded-xl border border-zinc-800/50 shadow-2xl">
              <button
                onClick={() => handleCategoryChange("")}
                className={cn(
                  "w-full text-left px-4 py-2.5 text-sm transition-colors",
                  !category
                    ? "bg-brand-500/15 text-brand-400"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                )}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategoryChange(cat)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-sm transition-colors",
                    category === cat
                      ? "bg-brand-500/15 text-brand-400"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Filters */}
      {(query || category) && (
        <div className="flex items-center gap-2 mb-3">
          {query && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/50 text-xs text-zinc-300">
              Search: "{query}"
              <button
                onClick={() => {
                  setSearchInput("");
                  setQuery("");
                  search("", category, 0);
                }}
              >
                <X className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
              </button>
            </span>
          )}
          {category && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 text-xs text-brand-400">
              {category}
              <button onClick={() => handleCategoryChange("")}>
                <X className="w-3 h-3 text-brand-400/50 hover:text-brand-400" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Our Mods — Featured Section */}
        {ourMods.length > 0 && page === 0 && !query && !category && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-brand-400" />
              <h2 className="text-sm font-semibold text-zinc-300">Our Mods</h2>
              <span className="text-[10px] text-zinc-600 ml-1">by MegaLoad</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ourMods.map((mod) => {
                const installed = isOurModInstalled(mod.name);
                const isInstalling = installingOurMod === mod.name;
                return (
                  <div
                    key={mod.name}
                    className={cn(
                      "glass rounded-xl p-4 flex items-center gap-4 transition-all duration-200 border",
                      installed
                        ? "border-emerald-500/20"
                        : "border-brand-500/20 hover:border-brand-500/40"
                    )}
                  >
                    <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0">
                      <Crown className="w-5 h-5 text-brand-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-zinc-200 truncate text-sm">{formatModName(mod.name)}</h3>
                        <span className="text-[10px] text-zinc-500 font-mono">v{mod.version}</span>
                        {installed && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400">
                            INSTALLED
                          </span>
                        )}
                      </div>
                      {mod.description && (
                        <p className="text-[11px] text-zinc-500 truncate mt-0.5">{mod.description}</p>
                      )}
                    </div>
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isInstalling ? (
                        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                      ) : installed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <button
                          onClick={() => handleInstallOurMod(mod)}
                          className="p-2 rounded-lg hover:bg-brand-500/10 text-zinc-500 hover:text-brand-400 transition-colors"
                          title="Install"
                        >
                          <Download className="w-4.5 h-4.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => search()}
              className="mt-3 px-4 py-2 rounded-lg glass border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">No mods found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {items.map((item) => {
              const installed = isInstalled(item.full_name);
              const installedVer = getInstalledVersion(item.full_name);
              const isInstalling = installing.has(item.full_name);
              const hasUpdate =
                installed && installedVer && installedVer !== item.version;

              return (
                <div
                  key={item.full_name}
                  className={cn(
                    "glass rounded-xl p-4 flex items-center gap-4 group transition-all duration-200 cursor-pointer",
                    installed
                      ? "border-emerald-500/20 hover:border-emerald-500/40"
                      : "border-zinc-800/50 hover:border-zinc-700/50"
                  )}
                  onClick={() => handleViewDetail(item)}
                >
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-zinc-800">
                    {item.icon ? (
                      <img
                        src={item.icon}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-6 h-6 text-zinc-600" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-zinc-200 truncate">
                        {item.name}
                      </h3>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        v{item.version}
                      </span>
                      {item.is_deprecated && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400">
                          DEPRECATED
                        </span>
                      )}
                      {installed && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400">
                          INSTALLED
                        </span>
                      )}
                      {hasUpdate && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand-500/15 text-brand-400">
                          UPDATE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      by {item.owner}
                    </p>
                    <p className="text-xs text-zinc-600 truncate mt-0.5">
                      {item.description}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 shrink-0 text-xs text-zinc-500">
                    <div className="flex items-center gap-1" title="Downloads">
                      <Download className="w-3.5 h-3.5" />
                      {formatDownloads(item.downloads)}
                    </div>
                    <div className="flex items-center gap-1" title="Rating">
                      <Star className="w-3.5 h-3.5" />
                      {item.rating}
                    </div>
                    {item.dependency_count > 0 && (
                      <span
                        className="text-[10px] text-zinc-600"
                        title="Dependencies"
                      >
                        {item.dependency_count} deps
                      </span>
                    )}
                  </div>

                  {/* Install/Uninstall Button */}
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isInstalling ? (
                      <div className="w-9 h-9 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                      </div>
                    ) : installed ? (
                      <button
                        onClick={() => handleUninstall(item.full_name)}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Uninstall"
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstall(item)}
                        className="p-2 rounded-lg hover:bg-brand-500/10 text-zinc-500 hover:text-brand-400 transition-colors"
                        title="Install"
                      >
                        <Download className="w-4.5 h-4.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50 mt-4">
          <button
            onClick={prevPage}
            disabled={page === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>
          <span className="text-xs text-zinc-500">
            Page {page + 1} of {totalPages} &middot;{" "}
            {total.toLocaleString()} results
          </span>
          <button
            onClick={nextPage}
            disabled={page + 1 >= totalPages}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Detail View ────────────────────────────────────────────

function ModDetailView({
  mod: detail,
  isInstalled,
  installedVersion,
  installing,
  onBack,
  onInstall,
  onUninstall,
}: {
  mod: ThunderstoreModDetail;
  isInstalled: boolean;
  installedVersion: string | null;
  installing: boolean;
  onBack: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const latest = detail.versions[0];
  const hasUpdate =
    isInstalled &&
    installedVersion &&
    installedVersion !== latest?.version_number;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-4 transition-colors w-fit"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Browse
      </button>

      {/* Mod Header */}
      <div className="glass rounded-xl p-6 border border-zinc-800/50 mb-4">
        <div className="flex items-start gap-5">
          {/* Icon */}
          <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-zinc-800">
            {detail.icon ? (
              <img
                src={detail.icon}
                alt={detail.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="w-10 h-10 text-zinc-600" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-norse font-bold text-3xl text-zinc-100 tracking-wide">
                {detail.name}
              </h1>
              {detail.is_deprecated && (
                <span className="px-2 py-1 rounded text-xs font-bold bg-red-500/15 text-red-400">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  DEPRECATED
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-1">
              by{" "}
              <span className="text-zinc-300 font-medium">{detail.owner}</span>
            </p>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
              {detail.description}
            </p>

            {/* Tags */}
            {detail.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {detail.categories.map((cat) => (
                  <span
                    key={cat}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800/80 text-zinc-400"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="shrink-0 flex flex-col items-end gap-2">
            {installing ? (
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500/20 text-brand-400 text-sm font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" />
                Installing...
              </div>
            ) : isInstalled ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1.5 text-emerald-400 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  Installed v{installedVersion}
                </div>
                {hasUpdate && (
                  <button
                    onClick={onInstall}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/15 text-brand-400 text-xs font-semibold hover:bg-brand-500/25 transition-colors"
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                    Update to v{latest?.version_number}
                  </button>
                )}
                <button
                  onClick={onUninstall}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Uninstall
                </button>
              </div>
            ) : (
              <button
                onClick={onInstall}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 text-zinc-950 font-semibold text-sm hover:bg-brand-400 transition-colors"
              >
                <Download className="w-4 h-4" />
                Install
              </button>
            )}

            {detail.website_url && (
              <a
                href={detail.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Website
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Version History */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h2 className="text-lg font-semibold text-zinc-200 mb-3">
          Version History
        </h2>
        <div className="space-y-2">
          {detail.versions.map((ver, i) => (
            <div
              key={ver.version_number}
              className={cn(
                "glass rounded-xl p-4 border transition-all",
                i === 0
                  ? "border-brand-500/20"
                  : "border-zinc-800/30"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-zinc-200">
                    v{ver.version_number}
                  </span>
                  {i === 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand-500/15 text-brand-400">
                      LATEST
                    </span>
                  )}
                  <span className="text-xs text-zinc-500">
                    {formatSize(ver.file_size)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Download className="w-3 h-3" />
                    {ver.downloads.toLocaleString()}
                  </span>
                  <span>
                    {new Date(ver.date_created).toLocaleDateString()}
                  </span>
                </div>
              </div>
              {ver.description && (
                <p className="text-xs text-zinc-500 mt-2">
                  {ver.description}
                </p>
              )}
              {ver.dependencies.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {ver.dependencies.map((dep) => (
                    <span
                      key={dep}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-500 font-mono"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
