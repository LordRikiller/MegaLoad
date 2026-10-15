import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  FileArchive,
  FolderOpen,
  List,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Minus,
  MoreHorizontal,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import * as api from "../lib/tauri-api";
import type { AtlasData, MapImportProgress, MapPackInfo, MapSourcePeek } from "../lib/tauri-api";
import { useToastStore } from "../stores/toastStore";
import { useMapSyncStore } from "../stores/mapSyncStore";
import { cn } from "../lib/utils";
import { debugLog } from "../lib/debug";
import { GROUPS, displayName } from "../lib/map/valheimNames";
import type { FilterNode } from "../lib/map/valheimNames";
import { buildLootIndex, fmtOdds, itemLabel, lootOdds } from "../lib/map/loot";
import type { LootIndex } from "../lib/map/loot";

// ---------------------------------------------------------------------------
// Categories, biomes, flags
// ---------------------------------------------------------------------------

/** Every prefab in the name tables belongs to exactly one group, so the marker
 *  a location draws is its group's icon — what the place IS. */
const PREFAB_ICON: Record<string, string> = {};
for (const g of GROUPS) for (const pf of g.prefabs) PREFAB_ICON[pf] = g.icon ?? "landmark";
const ICON_NAMES = [...new Set([...GROUPS.map((g) => g.icon ?? "landmark"), "landmark"])];

/** Selection is held at leaf level: a group with children is only ever a
 *  shorthand for ticking all of them. */
function leavesOf(n: FilterNode): FilterNode[] {
  return n.children?.length ? n.children : [n];
}

/** Valheim's own biome colours, matching the basemap palette. */
const BIOME_COLOUR: Record<string, string> = {
  Meadows: "#6C8E3F",
  BlackForest: "#3E6B3A",
  Swamp: "#6B5F42",
  Mountain: "#DEE2E9",
  Plains: "#C8AC58",
  Mistlands: "#5E566F",
  AshLands: "#A34434",
  DeepNorth: "#C4DAE8",
  Ocean: "#2A4C77",
  None: "#3A4050",
};
const BIOME_LABEL: Record<string, string> = {
  BlackForest: "Black Forest",
  AshLands: "Ashlands",
  DeepNorth: "Deep North",
};
const BIOME_ORDER = ["Meadows", "BlackForest", "Swamp", "Mountain", "Plains", "Mistlands", "AshLands", "DeepNorth", "Ocean"];

/** Boss altars carry no distinctive content rows, so they are named. */
const BOSS = new Set([
  "Eikthyrnir",
  "GDKing",
  "Bonemass",
  "Dragonqueen",
  "GoblinKing",
  "Mistlands_DvergrBossEntrance1",
  "FaderLocation",
  "DN_Bossroom",
]);
const MERCHANT = new Set(["Vendor_BlackForest", "BogWitch_Camp", "Hildir_camp"]);

const F_BOSS = 1,
  F_DUNGEON = 2,
  F_VEGVISIR = 4,
  F_CHEST = 8,
  F_MERCHANT = 16,
  F_RUNESTONE = 32,
  F_PICKABLE = 64,
  F_SPAWNER = 128;

const CATS = [
  { key: "boss", label: "Bosses", bit: F_BOSS, icon: "boss" },
  { key: "dungeon", label: "Dungeons", bit: F_DUNGEON, icon: "dungeon" },
  { key: "vegvisir", label: "Vegvisir", bit: F_VEGVISIR, icon: "vegvisir" },
  { key: "runestone", label: "Runestones", bit: F_RUNESTONE, icon: "runestone" },
  { key: "chest", label: "Chests", bit: F_CHEST, icon: "chest" },
  { key: "merchant", label: "Traders", bit: F_MERCHANT, icon: "merchant" },
  { key: "pickable", label: "Pickables", bit: F_PICKABLE, icon: "pickable" },
  { key: "spawner", label: "Spawners", bit: F_SPAWNER, icon: "spawner" },
] as const;

type IconSet = Partial<Record<string, HTMLImageElement>>;

/** Every icon a group can name, loaded once. (MegaServer loaded only the eight
 *  content icons, so quest/structure/grave/resource/landmark pins fell back to
 *  plain dots.) */
function useMapIcons(): IconSet {
  const [icons, setIcons] = useState<IconSet>({});
  useEffect(() => {
    let live = true;
    const out: IconSet = {};
    let left = ICON_NAMES.length;
    const settle = () => {
      if (--left === 0 && live) setIcons(out);
    };
    for (const name of ICON_NAMES) {
      const img = new Image();
      img.onload = () => {
        out[name] = img;
        settle();
      };
      img.onerror = settle;
      img.src = `/mapicons/${name}.png`;
    }
    return () => {
      live = false;
    };
  }, []);
  return icons;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toggle(set: Set<string>, key: string) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function fmtDist(m: number) {
  return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m";
}

function fmtBytes(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  return Math.round(n / 1e3) + " KB";
}

function fmtWhen(secs: number) {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toast(type: "info" | "success" | "warning", title: string, message?: string) {
  useToastStore.getState().addToast({ type, title, message });
}

const SECTIONS_KEY = "megaload_map_sections";
function readSections(): { filters: boolean; results: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(SECTIONS_KEY) || "null");
    if (v && typeof v.filters === "boolean" && typeof v.results === "boolean") return v;
  } catch {
    /* default below */
  }
  return { filters: true, results: true };
}

interface Loaded {
  info: MapPackInfo;
  data: AtlasData;
  basemap: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WorldMap() {
  const [worlds, setWorlds] = useState<MapPackInfo[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<MapImportProgress | null>(null);

  const syncRevision = useMapSyncStore((s) => s.revision);
  const runSync = useMapSyncStore((s) => s.run);

  const refreshWorlds = useCallback(async () => {
    const w = await api.mapListWorlds();
    setWorlds(w.worlds);
    setActiveId((cur) => (cur && w.worlds.some((x) => x.id === cur) ? cur : w.active));
    return w;
  }, []);

  useEffect(() => {
    refreshWorlds().catch((e) => {
      console.warn("map list failed", e);
      setWorlds([]);
    });
  }, [refreshWorlds, syncRevision]);

  // Pull anything another machine added as soon as the page opens.
  useEffect(() => {
    void runSync();
  }, [runSync]);

  // Load the chosen world.
  useEffect(() => {
    if (!activeId) {
      setLoaded(null);
      return;
    }
    let live = true;
    let url: string | null = null;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const w = worlds?.find((x) => x.id === activeId);
      if (!w) return;
      const [text, bytes] = await Promise.all([api.mapAtlasPayload(activeId), api.mapBasemap(activeId)]);
      url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
      if (!live) return;
      setLoaded({ info: w, data: JSON.parse(text) as AtlasData, basemap: url });
    })()
      .catch((e) => {
        console.warn("atlas load failed", e);
        if (live) setLoadError(String(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // worlds is read for the info only; the payload does not change with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, worlds?.find((x) => x.id === activeId)?.atlasSha]);

  const pickWorld = useCallback((id: string) => {
    setActiveId(id);
    api.mapSetActive(id).catch((e) => debugLog("set active map failed", e));
  }, []);

  const doImport = useCallback(
    async (path: string) => {
      setProgress({ stage: "Starting", detail: "", fraction: 0 });
      const un = await listen<MapImportProgress>("map-import-progress", (e) => setProgress(e.payload));
      try {
        const info = await api.mapImport(path);
        await refreshWorlds();
        setActiveId(info.id);
        setAdding(false);
        toast(
          "success",
          `${info.seed} added`,
          `${info.locations.toLocaleString()} locations, world ${info.worldVersion}.`,
        );
        void runSync();
      } catch (e) {
        toast("warning", "Could not import that map", String(e));
      } finally {
        un();
        setProgress(null);
      }
    },
    [refreshWorlds, runSync],
  );

  const deleteWorld = useCallback(
    async (w: MapPackInfo) => {
      if (!window.confirm(`Remove ${w.seed} (${w.worldVersion}) from MegaLoad?\n\nWith Cloud Sync on, it is removed from your other PCs too.`))
        return;
      try {
        await api.mapDeleteWorld(w.id);
        if (activeId === w.id) setActiveId(null);
        await refreshWorlds();
        toast("info", `${w.seed} removed`);
        void runSync();
      } catch (e) {
        toast("warning", "Could not remove that world", String(e));
      }
    },
    [activeId, refreshWorlds, runSync],
  );

  const exportPack = useCallback(async (w: MapPackInfo) => {
    const dest = await save({
      defaultPath: `atlas-${w.id}.zip`,
      filters: [{ name: "Atlas pack", extensions: ["zip"] }],
    });
    if (!dest) return;
    try {
      await api.mapExportPack(w.id, dest);
      toast("success", "Pack exported", "MegaServer's Map page can import it.");
    } catch (e) {
      toast("warning", "Could not export the pack", String(e));
    }
  }, []);

  const active = worlds?.find((w) => w.id === activeId) ?? null;

  return (
    <div className="h-full min-h-[600px] flex flex-col animate-in">
      <header className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-3 mb-4">
        <div className="flex items-center gap-3 mr-2">
          <MapIcon className="w-8 h-8 text-brand-400" />
          <h1 className="font-norse font-bold text-4xl leading-none">World Map</h1>
        </div>
        {worlds && worlds.length > 0 && (
          <WorldPicker
            worlds={worlds}
            active={active}
            onPick={pickWorld}
            onAdd={() => setAdding(true)}
            onDelete={deleteWorld}
            onExport={exportPack}
          />
        )}
        <div className="flex-1" />
        <SyncPill />
        {worlds && worlds.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-zinc-950 hover:bg-brand-400 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add world
          </button>
        )}
      </header>

      {worlds === null ? (
        <CenterNote>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your worlds…
        </CenterNote>
      ) : worlds.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-6">
            <AddWorld onImport={doImport} first />
          </div>
        </div>
      ) : loadError ? (
        <CenterNote>
          <span className="text-red-300">The map could not be loaded: {loadError}</span>
        </CenterNote>
      ) : !loaded || loading ? (
        <CenterNote>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading {active?.seed ?? "the map"}…
        </CenterNote>
      ) : (
        <Atlas key={loaded.info.id + loaded.info.atlasSha} loaded={loaded} />
      )}

      {adding && (
        <Modal onClose={() => !progress && setAdding(false)}>
          <AddWorld onImport={doImport} />
        </Modal>
      )}
      {progress && <ImportOverlay p={progress} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function WorldPicker({
  worlds,
  active,
  onPick,
  onAdd,
  onDelete,
  onExport,
}: {
  worlds: MapPackInfo[];
  active: MapPackInfo | null;
  onPick: (id: string) => void;
  onAdd: () => void;
  onDelete: (w: MapPackInfo) => void;
  onExport: (w: MapPackInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-1.5 text-left transition-colors",
          "bg-zinc-950/90 border-zinc-800 hover:border-brand-500/60",
          open && "border-brand-500/60",
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-100 truncate max-w-[16rem]">
            {active?.seed ?? "Choose a world"}
          </span>
          {active && (
            <span className="block text-[11px] text-zinc-500">
              World {active.worldVersion} · {active.locations.toLocaleString()} locations
            </span>
          )}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-40 w-[22rem] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div className="px-3.5 py-2 border-b border-zinc-800 bg-zinc-900/80 text-[11px] uppercase tracking-wider text-zinc-500">
            Your worlds
          </div>
          <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-800/70">
            {worlds.map((w) => (
              <li key={w.id} className="group flex items-center gap-2 pr-2 hover:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    onPick(w.id);
                    setOpen(false);
                  }}
                  className="flex-1 min-w-0 flex items-center gap-3 px-3.5 py-2.5 text-left"
                >
                  <span className="w-4 shrink-0">
                    {active?.id === w.id && <Check className="w-4 h-4 text-brand-400" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-zinc-100 truncate">{w.seed}</span>
                    <span className="block text-[11px] text-zinc-500">
                      World {w.worldVersion} · {w.locations.toLocaleString()} locations
                      {w.source === "sync" ? " · from cloud" : ""}
                    </span>
                  </span>
                </button>
                <WorldMenu w={w} onDelete={() => onDelete(w)} onExport={() => onExport(w)} />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 border-t border-zinc-800 text-sm text-brand-300 hover:bg-zinc-900"
          >
            <Plus className="w-4 h-4" /> Add a world…
          </button>
        </div>
      )}
    </div>
  );
}

function WorldMenu({ w, onDelete, onExport }: { w: MapPackInfo; onDelete: () => void; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Options for ${w.seed}`}
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl py-1 text-sm">
          <MenuItem icon={PackageOpen} onClick={() => (setOpen(false), onExport())}>
            Export as pack
          </MenuItem>
          <MenuItem icon={FolderOpen} onClick={() => (setOpen(false), void api.mapOpenFolder())}>
            Open maps folder
          </MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => (setOpen(false), onDelete())}>
            Remove world
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  danger,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-900",
        danger ? "text-red-300" : "text-zinc-300",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {children}
    </button>
  );
}

function SyncPill() {
  const { status, detail, run } = useMapSyncStore();
  const Icon = status === "off" || status === "error" ? CloudOff : Cloud;
  const label =
    status === "syncing"
      ? "Syncing"
      : status === "off"
        ? "Sync off"
        : status === "error"
          ? "Sync failed"
          : status === "ok"
            ? "Synced"
            : "Sync";
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={status === "syncing"}
      title={detail || "Sync maps with your other PCs"}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors bg-zinc-950/90",
        status === "error"
          ? "border-red-500/40 text-red-300"
          : status === "off"
            ? "border-zinc-800 text-zinc-500"
            : "border-zinc-800 text-zinc-300 hover:border-brand-500/60",
      )}
    >
      {status === "syncing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center">
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-5 py-4 text-sm text-zinc-400">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding a world
// ---------------------------------------------------------------------------

function AddWorld({ onImport, first }: { onImport: (path: string) => void; first?: boolean }) {
  const [found, setFound] = useState<MapSourcePeek[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const scan = useCallback(() => {
    setFound(null);
    api
      .mapFindDownloads()
      .then(setFound)
      .catch(() => setFound([]));
  }, []);
  useEffect(scan, [scan]);

  const pick = async (directory: boolean) => {
    const picked = await open(
      directory
        ? { directory: true, multiple: false }
        : { multiple: false, filters: [{ name: "valheim-map.world download", extensions: ["zip"] }] },
    );
    if (typeof picked !== "string") return;
    setChecking(picked);
    try {
      const p = await api.mapPeekSource(picked);
      if (
        p.installed &&
        !window.confirm(`${p.seed} (${p.worldVersion}) is already installed. Rebuild it from this file?`)
      )
        return;
      onImport(picked);
    } catch (e) {
      toast("warning", "That file can't be used", String(e));
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl overflow-hidden">
      <div className="px-6 py-5 border-b border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950">
        <h2 className="font-norse text-3xl font-bold text-zinc-100">{first ? "Add your world" : "Add a world"}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Every boss altar, dungeon, trader, vegvisir and chest in a seed, searchable on a real map.
        </p>
      </div>

      <ol className="divide-y divide-zinc-800/80">
        <li className="flex gap-4 px-6 py-5">
          <StepNo n={1} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100">Download the world from valheim-map.world</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Enter your seed, pick the world version your game runs, then <b className="text-zinc-200">Download</b>{" "}
              → <b className="text-zinc-200">All Data</b>. It's a big zip (about 1.5 GB at Ultra). Leave it zipped.
            </p>
            <button
              type="button"
              onClick={() => void api.mapOpenGenerator()}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-brand-500/60"
            >
              <ExternalLink className="w-4 h-4" /> Open valheim-map.world
            </button>
          </div>
        </li>

        <li className="flex gap-4 px-6 py-5">
          <StepNo n={2} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">Import it</h3>
              <button
                type="button"
                onClick={scan}
                title="Look in Downloads again"
                className="ml-auto inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                <RefreshCw className="w-3 h-3" /> Rescan Downloads
              </button>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              MegaLoad reads the zip in place and builds the map. It takes under a minute, and the download can be
              deleted afterwards.
            </p>

            <div className="mt-3 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-3.5 py-2 border-b border-zinc-800 bg-zinc-900/80 text-[11px] uppercase tracking-wider text-zinc-500">
                Found in Downloads
              </div>
              {found === null ? (
                <div className="px-3.5 py-3 text-sm text-zinc-500 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking…
                </div>
              ) : found.length === 0 ? (
                <div className="px-3.5 py-3 text-sm text-zinc-500">
                  No <span className="font-mono text-zinc-400">MapData_*.zip</span> yet. Once the download finishes,
                  rescan or choose the file below.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800/70">
                  {found.map((f) => (
                    <li key={f.path} className="flex items-center gap-3 px-3.5 py-2.5">
                      <FileArchive className="w-5 h-5 text-brand-400 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-zinc-100 truncate">
                          {f.seed} <span className="text-zinc-500">· world {f.worldVersion}</span>
                        </span>
                        <span className="block text-[11px] text-zinc-500 truncate">
                          {f.kind === "pack"
                            ? "Atlas pack"
                            : `${f.tileSide}×${f.tileSide} tiles · ${f.resolution.toLocaleString()} px`}
                          {f.bytes ? ` · ${fmtBytes(f.bytes)}` : ""} · {fmtWhen(f.modified)}
                        </span>
                      </span>
                      {f.installed && (
                        <span className="text-[10px] uppercase tracking-wider text-emerald-400/90">Installed</span>
                      )}
                      <button
                        type="button"
                        onClick={() => onImport(f.path)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                          f.installed
                            ? "border border-zinc-700 text-zinc-300 hover:border-brand-500/60"
                            : "bg-brand-500 text-zinc-950 hover:bg-brand-400",
                        )}
                      >
                        <Download className="w-3.5 h-3.5" /> {f.installed ? "Rebuild" : "Import"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void pick(false)}
                disabled={!!checking}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-brand-500/60 disabled:opacity-50"
              >
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Choose a
                zip…
              </button>
              <button
                type="button"
                onClick={() => void pick(true)}
                disabled={!!checking}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-brand-500/60 disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4" /> Already unzipped? Choose the folder…
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Atlas packs exported from MegaServer or MapAtlas import the same way.</p>
          </div>
        </li>

        <li className="flex gap-4 px-6 py-5">
          <StepNo n={3} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100">It follows you to your other PCs</h3>
            <p className="mt-1 text-sm text-zinc-400">
              With Cloud Sync on, the finished map (about 9 MB, not the 1.5 GB download) syncs to every PC you sign
              in on, along with the trader sites you mark. You can keep as many worlds as you like and switch between
              them at the top of the page.
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}

function StepNo({ n }: { n: number }) {
  return (
    <span className="grid place-items-center w-7 h-7 shrink-0 rounded-full border border-brand-500/50 bg-brand-500/10 text-sm font-semibold text-brand-300">
      {n}
    </span>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-6" onMouseDown={onClose}>
      <div className="relative w-full max-w-3xl max-h-full overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

function ImportOverlay({ p }: { p: MapImportProgress }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-sm">
      <div className="w-[26rem] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
          <h3 className="font-norse text-2xl font-bold text-zinc-100">Building the map</h3>
        </div>
        <p className="mt-4 text-sm text-zinc-200">{p.stage}</p>
        <p className="text-xs text-zinc-500 h-4 truncate">{p.detail}</p>
        <div className="mt-3 h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-[width] duration-300"
            style={{ width: `${Math.round(p.fraction * 100)}%` }}
          />
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">Reading the whole download — keep MegaLoad open.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The atlas view
// ---------------------------------------------------------------------------

function Atlas({ loaded }: { loaded: Loaded }) {
  const A = loaded.data;
  const seed = loaded.info.seed;

  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [biomes, setBiomes] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [sections, setSections] = useState(readSections);
  const [traderIds, setTraderIds] = useState<Set<number>>(new Set());
  const syncRevision = useMapSyncStore((s) => s.revision);
  const runSync = useMapSyncStore((s) => s.run);

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
    } catch {
      /* per-viewer nicety only */
    }
  }, [sections]);

  useEffect(() => {
    api
      .mapMarks()
      .then((m) => setTraderIds(new Set(m[seed]?.traders ?? [])))
      .catch(() => setTraderIds(new Set()));
  }, [seed, syncRevision]);

  const markTimer = useRef<number | undefined>(undefined);
  const toggleTrader = useCallback(
    async (atlasId: number) => {
      const next = new Set(traderIds);
      if (next.has(atlasId)) next.delete(atlasId);
      else next.add(atlasId);
      const before = traderIds;
      setTraderIds(next); // optimistic — the map should move under the click
      try {
        await api.mapSetTraderMarks(seed, [...next]);
        window.clearTimeout(markTimer.current);
        markTimer.current = window.setTimeout(() => void runSync(), 4000);
      } catch (e) {
        setTraderIds(before);
        toast("warning", "Could not save that mark", String(e));
      }
    },
    [seed, traderIds, runSync],
  );

  /** The name tables cover every prefab in the current game; anything a newer
   *  or older world has beyond them still gets a home rather than vanishing. */
  const groups = useMemo(() => {
    const known = new Set(GROUPS.flatMap((g) => g.prefabs));
    const other = A.prefabs.filter((pf) => pf && !known.has(pf)).sort();
    return other.length
      ? [...GROUPS, { key: "other", label: "Other", icon: "landmark", prefabs: other } as FilterNode]
      : GROUPS;
  }, [A]);
  const leafPrefabs = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const g of groups) for (const leaf of leavesOf(g)) out[leaf.key] = leaf.prefabs;
    return out;
  }, [groups]);

  const flags = useMemo(() => {
    const n = A.p.length;
    const kind = (name: string) => A.kinds.indexOf(name);
    const kVeg = kind("Vegvisir"),
      kCon = kind("Container"),
      kPick = kind("Pickable"),
      kSpw = kind("Spawner"),
      kArea = kind("AreaSpawner");
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let f = 0;
      const pf = A.prefabs[A.p[i]];
      if (BOSS.has(pf)) f |= F_BOSS;
      if (MERCHANT.has(pf)) f |= F_MERCHANT;
      // Runestones and lore stones are a prefab family, not a content kind.
      if (
        pf.startsWith("Runestone_") ||
        pf === "DrakeLorestone" ||
        pf === "StoneCircle" ||
        pf === "NorthMemorialPlace" ||
        pf === "StartTemple"
      )
        f |= F_RUNESTONE;
      if (A.rOff[i + 1] > A.rOff[i]) f |= F_DUNGEON;
      for (let c = A.cOff[i], ce = A.cOff[i + 1]; c < ce; c++) {
        const k = A.cKind[c];
        if (k === kVeg) f |= F_VEGVISIR;
        else if (k === kCon) f |= F_CHEST;
        else if (k === kPick) f |= F_PICKABLE;
        else if (k === kSpw || k === kArea) f |= F_SPAWNER;
      }
      out[i] = f;
    }
    return out;
  }, [A]);

  const lootIx = useMemo(() => buildLootIndex(A), [A]);

  /** Per location: `base` is what it is and what the export lists in it; `full`
   *  adds what its chests can roll; `items` is every item index it holds. */
  const haystack = useMemo(() => {
    const n = A.p.length;
    const base = new Array<string>(n);
    const full = new Array<string>(n);
    const items = new Array<number[]>(n);
    for (let i = 0; i < n; i++) {
      const pf = A.prefabs[A.p[i]];
      const bio = A.biomes[A.b[i]];
      const parts = [pf, displayName(pf), bio, BIOME_LABEL[bio] ?? ""];
      const loot: string[] = [];
      const held = new Set<number>();
      for (let c = A.cOff[i], ce = A.cOff[i + 1]; c < ce; c++) {
        parts.push(A.kinds[A.cKind[c]], A.details[A.cDetail[c]], lootIx.detailExtra[A.cDetail[c]]);
        for (const it of lootIx.detailItems[A.cDetail[c]]) held.add(it);
        const t = A.cLoot?.[c] ?? -1;
        if (t >= 0) {
          loot.push(lootIx.tableText[t]);
          for (const e of A.loot![t].d) held.add(e[0]);
        }
      }
      base[i] = parts.join(" ").toLowerCase();
      full[i] = loot.length ? base[i] + " " + loot.join(" ") : base[i];
      items[i] = [...held];
    }
    return { base, full, items };
  }, [A, lootIx]);

  /** Items the WHOLE query names: a location then matches by holding one, not
   *  by scattering the words across a chest. */
  const itemHits = useMemo(() => {
    const out = new Set<number>();
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return out;
    lootIx.itemText.forEach((t, i) => {
      if (terms.every((q) => t.includes(q))) out.add(i);
    });
    return out;
  }, [lootIx, query]);

  const selectedPrefabs = useMemo(() => {
    const out = new Set<string>();
    for (const key of groupSel) for (const pf of leafPrefabs[key] ?? []) out.add(pf);
    return out;
  }, [groupSel, leafPrefabs]);

  /** Trader prefabs whose real site is known, so the other candidates drop. */
  const settledTraders = useMemo(() => {
    const out = new Set<string>();
    if (traderIds.size === 0) return out;
    for (let i = 0; i < A.p.length; i++) if (traderIds.has(A.ids[i])) out.add(A.prefabs[A.p[i]]);
    return out;
  }, [A, traderIds]);

  const matches = useMemo(() => {
    const n = A.p.length;
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let bits = 0;
    for (const c of CATS) if (cats.has(c.key)) bits |= c.bit;
    const wantBiome = biomes.size > 0;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      if (selectedPrefabs.size && !selectedPrefabs.has(A.prefabs[A.p[i]])) continue;
      if (bits && !(flags[i] & bits)) continue;
      if (flags[i] & F_MERCHANT && settledTraders.size) {
        const pf = A.prefabs[A.p[i]];
        if (settledTraders.has(pf) && !traderIds.has(A.ids[i])) continue;
      }
      if (wantBiome && !biomes.has(A.biomes[A.b[i]])) continue;
      if (terms.length) {
        const has = (h: string) => terms.every((t) => h.indexOf(t) >= 0);
        const ok = itemHits.size
          ? has(haystack.base[i]) || haystack.items[i].some((it) => itemHits.has(it))
          : has(haystack.full[i]);
        if (!ok) continue;
      }
      out.push(i);
    }
    // Nearest the world centre first — that is where players spawn.
    out.sort((a, b) => A.x[a] * A.x[a] + A.z[a] * A.z[a] - (A.x[b] * A.x[b] + A.z[b] * A.z[b]));
    return out;
  }, [A, flags, haystack, itemHits, query, cats, biomes, selectedPrefabs, settledTraders, traderIds]);

  const alwaysShow = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < A.p.length; i++) if (A.prefabs[A.p[i]] === "StartTemple") out.push(i);
    return out;
  }, [A]);

  const filterCount = cats.size + biomes.size + groupSel.size;
  const filtering = query.trim() !== "" || filterCount > 0;
  const icons = useMapIcons();
  const iconKeys = useMemo(() => {
    const byPrefab = A.prefabs.map((pf) => PREFAB_ICON[pf] ?? "landmark");
    return A.p.map((pi) => byPrefab[pi]);
  }, [A]);

  const clearFilters = () => {
    setCats(new Set());
    setBiomes(new Set());
    setGroupSel(new Set());
  };

  return (
    <div className="flex-1 min-h-0 grid gap-4 grid-cols-[minmax(300px,340px)_1fr] xl:grid-cols-[380px_1fr] 2xl:grid-cols-[420px_1fr]">
      {/* ── Rail ── */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="relative shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/95 pl-10 pr-9 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 shadow-lg focus:outline-none focus:border-brand-500/70 focus:ring-1 focus:ring-brand-500/30"
            placeholder="Search places, items, chests… e.g. Battle Idol"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-500 hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <Section
          icon={SlidersHorizontal}
          title="Filters"
          badge={filterCount || undefined}
          open={sections.filters}
          onToggle={() => setSections((s) => ({ ...s, filters: !s.filters }))}
          action={
            filterCount > 0 ? (
              <button type="button" onClick={clearFilters} className="text-xs text-zinc-400 hover:text-brand-300">
                Clear
              </button>
            ) : undefined
          }
          grow={1}
        >
          <SubHead>Places</SubHead>
          <div className="px-1.5">
            {groups.map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                sel={groupSel}
                open={expanded.has(g.key)}
                onToggleOpen={() => setExpanded(toggle(expanded, g.key))}
                onSet={setGroupSel}
              />
            ))}
          </div>
          <SubHead>Contains</SubHead>
          <div className="px-3.5 pb-1 flex flex-wrap gap-1.5">
            {CATS.map((c) => (
              <Chip key={c.key} on={cats.has(c.key)} icon={c.icon} onClick={() => setCats(toggle(cats, c.key))}>
                {c.label}
              </Chip>
            ))}
          </div>
          <SubHead>Biome</SubHead>
          <div className="px-3.5 pb-3.5 flex flex-wrap gap-1.5">
            {BIOME_ORDER.filter((b) => A.biomes.includes(b)).map((b) => (
              <Chip key={b} on={biomes.has(b)} swatch={BIOME_COLOUR[b]} onClick={() => setBiomes(toggle(biomes, b))}>
                {BIOME_LABEL[b] ?? b}
              </Chip>
            ))}
          </div>
        </Section>

        <Section
          icon={List}
          title="Results"
          badge={matches.length}
          hint="nearest spawn first"
          open={sections.results}
          onToggle={() => setSections((s) => ({ ...s, results: !s.results }))}
          grow={1.35}
        >
          <ResultList data={A} matches={matches} itemHits={itemHits} selected={selected} onPick={setSelected} />
        </Section>
      </div>

      {/* ── Map ── */}
      <div className="relative min-h-0 flex flex-col">
        <MapCanvas
          data={A}
          edge={loaded.info.edge}
          basemap={loaded.basemap}
          matches={matches}
          alwaysShow={alwaysShow}
          iconKeys={iconKeys}
          icons={icons}
          showPins={filtering}
          selected={selected}
          onPick={setSelected}
        />
        {selected !== null && (
          <div className="absolute top-3 right-3 z-20 w-[23rem] max-w-[calc(100%-4.5rem)] max-h-[calc(100%-1.5rem)] flex flex-col">
            <Detail
              data={A}
              lootIx={lootIx}
              itemHits={itemHits}
              i={selected}
              onClose={() => setSelected(null)}
              trader={
                flags[selected] & F_MERCHANT
                  ? {
                      found: traderIds.has(A.ids[selected]),
                      onToggle: () => void toggleTrader(A.ids[selected]),
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail cards — Filters and Results share this shell so they always match
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  badge,
  hint,
  action,
  open,
  onToggle,
  grow,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: number;
  hint?: string;
  action?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Share of the rail's spare height while open. */
  grow: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-h-0 flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-lg overflow-hidden",
        open ? "min-h-[9rem]" : "shrink-0",
      )}
      style={open ? { flex: `${grow} 1 0%` } : undefined}
    >
      <div className={cn("shrink-0 flex items-center gap-2.5 px-3.5 py-2.5 bg-zinc-900/80", open && "border-b border-zinc-800")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-2.5 min-w-0 text-left group"
        >
          <ChevronRight className={cn("w-3.5 h-3.5 text-zinc-500 transition-transform", open && "rotate-90")} />
          <Icon className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 group-hover:text-zinc-50">
            {title}
          </span>
          {badge !== undefined && (
            <span className="rounded-full bg-brand-500/15 border border-brand-500/30 px-1.5 text-[11px] font-mono tabular-nums text-brand-300">
              {badge.toLocaleString()}
            </span>
          )}
          {hint && <span className="text-[11px] text-zinc-500 truncate">{hint}</span>}
        </button>
        <span className="flex-1" />
        {action}
      </div>
      {open && <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>}
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3.5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
      {children}
    </p>
  );
}

function GroupRow({
  group,
  sel,
  open,
  onToggleOpen,
  onSet,
}: {
  group: FilterNode;
  sel: Set<string>;
  open: boolean;
  onToggleOpen: () => void;
  onSet: (s: Set<string>) => void;
}) {
  const leaves = leavesOf(group);
  const on = leaves.filter((l) => sel.has(l.key)).length;
  const all = on === leaves.length;
  const some = on > 0 && !all;
  const setAll = (want: boolean) => {
    const next = new Set(sel);
    for (const l of leaves) {
      if (want) next.add(l.key);
      else next.delete(l.key);
    }
    onSet(next);
  };
  const hasKids = !!group.children?.length;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
          all || some ? "bg-brand-500/10" : "hover:bg-zinc-900",
        )}
      >
        <Box checked={all} partial={some} onChange={() => setAll(!all)} />
        <img src={`/mapicons/${group.icon ?? "landmark"}.png`} alt="" className="w-5 h-5 shrink-0" />
        <button
          type="button"
          onClick={hasKids ? onToggleOpen : () => setAll(!all)}
          className="flex-1 min-w-0 text-left text-sm text-zinc-200 truncate"
        >
          {group.label}
          {some && <span className="ml-1.5 text-[11px] text-zinc-500">{on}/{leaves.length}</span>}
        </button>
        {hasKids && (
          <button
            type="button"
            onClick={onToggleOpen}
            aria-label={open ? "Collapse" : "Expand"}
            className="p-0.5 text-zinc-500 hover:text-zinc-200"
          >
            <ChevronRight className={cn("w-4 h-4 transition-transform", open && "rotate-90")} />
          </button>
        )}
      </div>
      {open && hasKids && (
        <div className="ml-[1.15rem] pl-3 border-l border-zinc-800 my-0.5">
          {group.children!.map((c) => (
            <label key={c.key} className="flex items-center gap-2.5 px-2 py-1 rounded-md hover:bg-zinc-900 cursor-pointer">
              <Box
                checked={sel.has(c.key)}
                onChange={() => {
                  const next = new Set(sel);
                  if (next.has(c.key)) next.delete(c.key);
                  else next.add(c.key);
                  onSet(next);
                }}
              />
              <span className="flex-1 text-[13px] text-zinc-300">{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Box({ checked, partial, onChange }: { checked: boolean; partial?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={partial ? "mixed" : checked}
      onClick={onChange}
      className={cn(
        "grid place-items-center w-4 h-4 shrink-0 rounded border transition-colors",
        checked || partial ? "border-brand-500 bg-brand-500/25" : "border-zinc-600 hover:border-zinc-400",
      )}
    >
      {checked && <Check className="w-3 h-3 text-brand-300" />}
      {partial && !checked && <span className="w-1.5 h-0.5 bg-brand-300 rounded" />}
    </button>
  );
}

function Chip({
  on,
  swatch,
  icon,
  onClick,
  children,
}: {
  on: boolean;
  swatch?: string;
  icon?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        on
          ? "border-brand-500 bg-brand-500/15 text-zinc-100"
          : "border-zinc-700/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
      )}
    >
      {swatch && <span className="w-2.5 h-2.5 rounded-sm ring-1 ring-black/40" style={{ background: swatch }} />}
      {icon && <img src={`/mapicons/${icon}.png`} alt="" className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}

/** Item indexes in i's chests that are also in `hits`, with the best odds. */
function lootMatches(A: AtlasData, i: number, hits: Set<number>) {
  const best = new globalThis.Map<number, number>();
  if (!hits.size || !A.cLoot || !A.loot) return best;
  for (let c = A.cOff[i], ce = A.cOff[i + 1]; c < ce; c++) {
    const t = A.cLoot[c];
    if (t < 0) continue;
    const table = A.loot[t];
    const odds = lootOdds(table);
    table.d.forEach((e, k) => {
      if (hits.has(e[0])) best.set(e[0], Math.max(best.get(e[0]) ?? 0, odds[k]));
    });
  }
  return best;
}

function ResultList({
  data: A,
  matches,
  itemHits,
  selected,
  onPick,
}: {
  data: AtlasData;
  matches: number[];
  itemHits: Set<number>;
  selected: number | null;
  onPick: (i: number) => void;
}) {
  const [cap, setCap] = useState(80);
  useEffect(() => setCap(80), [matches]);

  if (!matches.length) {
    return (
      <div className="h-full grid place-items-center p-6 text-center">
        <div>
          <Search className="w-6 h-6 mx-auto text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500">Nothing matches those filters.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-zinc-800/60">
        {matches.slice(0, cap).map((i) => {
          const biome = A.biomes[A.b[i]];
          const loot = [...lootMatches(A, i, itemHits)].sort((a, b) => b[1] - a[1]);
          const pf = A.prefabs[A.p[i]];
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-selected={selected === i}
                className={cn(
                  "w-full text-left pl-2 pr-3.5 py-2 flex items-center gap-2.5 transition-colors border-l-2",
                  selected === i ? "bg-brand-500/15 border-brand-400" : "border-transparent hover:bg-zinc-900",
                )}
              >
                <span className="w-1.5 h-8 rounded-sm shrink-0" style={{ background: BIOME_COLOUR[biome] ?? "#555" }} />
                <img src={`/mapicons/${PREFAB_ICON[pf] ?? "landmark"}.png`} alt="" className="w-5 h-5 shrink-0 opacity-90" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-100">{displayName(pf)}</span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {BIOME_LABEL[biome] ?? biome} · <span className="font-mono">{pf}</span>
                  </span>
                  {loot.length > 0 && (
                    <span className="block truncate text-[11px] text-brand-300/90">
                      Chest:{" "}
                      {loot
                        .slice(0, 2)
                        .map(([it, p]) => `${itemLabel(A, it).name} (${fmtOdds(p)})`)
                        .join(", ")}
                      {loot.length > 2 ? ` +${loot.length - 2}` : ""}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  {fmtDist(Math.hypot(A.x[i], A.z[i]))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {cap < matches.length && (
        <button
          type="button"
          onClick={() => setCap(cap + 200)}
          className="w-full py-2.5 text-xs text-zinc-400 hover:text-brand-300 border-t border-zinc-800"
        >
          Show more ({(matches.length - cap).toLocaleString()} left)
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail card — same shell as the rail cards
// ---------------------------------------------------------------------------

function Detail({
  data: A,
  lootIx,
  itemHits,
  i,
  onClose,
  trader,
}: {
  data: AtlasData;
  lootIx: LootIndex;
  itemHits: Set<number>;
  i: number;
  onClose: () => void;
  trader?: { found: boolean; onToggle: () => void };
}) {
  const biome = A.biomes[A.b[i]];
  const pf = A.prefabs[A.p[i]];
  const contents: { kind: string; detail: string; extra: string; count: number }[] = [];
  const chests: { names: string[]; count: number; table: number }[] = [];
  for (let c = A.cOff[i], ce = A.cOff[i + 1]; c < ce; c++) {
    contents.push({
      kind: A.kinds[A.cKind[c]],
      detail: A.details[A.cDetail[c]],
      extra: lootIx.detailExtra[A.cDetail[c]] ?? "",
      count: A.cCount[c],
    });
    const t = A.cLoot?.[c] ?? -1;
    if (t < 0) continue;
    const name = A.details[A.cDetail[c]].replace(/\s*\(\d+\)$/, "");
    const at = chests.find((x) => x.table === t);
    if (at) {
      at.count += A.cCount[c];
      if (!at.names.includes(name)) at.names.push(name);
    } else chests.push({ names: [name], count: A.cCount[c], table: t });
  }
  const rooms = A.rOff[i + 1] - A.rOff[i];

  const copyGoto = () => {
    // goto takes the two horizontal axes only — height is not an argument.
    const text = `goto ${Math.round(A.x[i])} ${Math.round(A.z[i])}`;
    navigator.clipboard.writeText(text).then(
      () => useToastStore.getState().addToast({ type: "success", title: "Copied", message: text, duration: 2000 }),
      (e) => toast("warning", "Could not copy", String(e)),
    );
  };

  return (
    <section className="min-h-0 flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl overflow-hidden">
      <div className="shrink-0 flex items-start gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
        <img src={`/mapicons/${PREFAB_ICON[pf] ?? "landmark"}.png`} alt="" className="w-8 h-8 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-400">
            {rooms > 0 ? "Dungeon" : "Location"}
          </p>
          <h3 className="text-base font-semibold text-zinc-100 leading-snug">{displayName(pf)}</h3>
          <p className="font-mono text-[11px] text-zinc-500 break-all">{pf}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <DT>Position</DT>
          <dd className="font-mono text-zinc-200 tabular-nums">
            {A.x[i].toFixed(1)}, {A.y[i].toFixed(1)}, {A.z[i].toFixed(1)}
            <span className="ml-2 text-[11px] text-zinc-500">x, y, z</span>
          </dd>
          <DT>Biome</DT>
          <dd className="flex items-center gap-2 text-zinc-200">
            <span className="w-2.5 h-2.5 rounded-sm ring-1 ring-black/40" style={{ background: BIOME_COLOUR[biome] ?? "#555" }} />
            {BIOME_LABEL[biome] ?? biome}
          </dd>
          <DT>Terrain</DT>
          <dd className="font-mono text-zinc-200 tabular-nums">
            {A.h[i].toFixed(1)} m{A.s[i] ? " (submerged)" : ""} · forest {A.f[i].toFixed(2)}
          </dd>
          <DT>Spawn</DT>
          <dd className="font-mono text-zinc-200 tabular-nums">{fmtDist(Math.hypot(A.x[i], A.z[i]))} away</dd>
        </dl>

        <button
          type="button"
          onClick={copyGoto}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-brand-400 transition-colors"
        >
          <Copy className="w-4 h-4" /> Copy goto command
        </button>

        {trader && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-xs text-zinc-400">
              Valheim lays down ten candidate sites for each trader and only the first one you discover holds them.
              Mark the real one and the other nine come off the map.
            </p>
            <button
              type="button"
              onClick={trader.onToggle}
              className={cn(
                "mt-2.5 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                trader.found
                  ? "border border-zinc-700 text-zinc-300 hover:border-brand-500/60"
                  : "bg-brand-500/90 text-zinc-950 hover:bg-brand-400",
              )}
            >
              <Check className="w-4 h-4" />
              {trader.found ? "Found here — unmark" : "The trader is here"}
            </button>
          </div>
        )}

        {contents.length > 0 && (
          <div>
            <DetailHead>Contents ({contents.length})</DetailHead>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-zinc-800/70">
                  {contents.map((c, n) => (
                    <tr key={n}>
                      <td className="px-2 py-1 text-right font-mono text-brand-400 tabular-nums w-10 align-top">
                        {c.count > 1 ? `${c.count}×` : ""}
                      </td>
                      <td className="px-2 py-1 text-zinc-500 uppercase whitespace-nowrap align-top text-[10px] tracking-wide">
                        {c.kind}
                      </td>
                      <td className="px-2 py-1 text-zinc-300 break-all">
                        {c.detail}
                        {c.extra && <span className="block text-zinc-500">{c.extra}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {chests.map((ch) => (
          <ChestLoot key={ch.table} data={A} chest={ch} itemHits={itemHits} />
        ))}

        {rooms > 0 && <p className="text-xs text-zinc-500">{rooms.toLocaleString()} distinct dungeon rooms.</p>}
      </div>
    </section>
  );
}

function DT({ children }: { children: React.ReactNode }) {
  return <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 pt-1">{children}</dt>;
}

function DetailHead({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{children}</p>;
}

function ChestLoot({
  data: A,
  chest,
  itemHits,
}: {
  data: AtlasData;
  chest: { names: string[]; count: number; table: number };
  itemHits: Set<number>;
}) {
  const t = A.loot![chest.table];
  const odds = lootOdds(t);
  const rows = t.d.map((e, k) => ({ e, p: odds[k], ...itemLabel(A, e[0]) })).sort((a, b) => b.p - a.p);
  const picks = t.n[0] === t.n[1] ? `${t.n[0]}` : `${t.n[0]}–${t.n[1]}`;
  return (
    <div>
      <DetailHead>Chest loot{chest.count > 1 ? ` · ${chest.count} chests` : ""}</DetailHead>
      <p className="mb-1.5 text-[11px] text-zinc-500 break-all">
        <span className="font-mono">{chest.names.join(", ")}</span> · rolls {picks} of {t.d.length}
        {t.o ? ", no repeats" : ""}
        {t.c < 1 ? ` · ${Math.round(t.c * 100)}% chance of anything` : ""}
      </p>
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map(({ e, p, id, name }) => (
              <tr key={id} className={itemHits.has(e[0]) ? "bg-brand-500/15" : undefined}>
                <td className="px-2 py-1">
                  <span className="block text-zinc-200">{name}</span>
                  {name !== id && <span className="block font-mono text-[10px] text-zinc-500">{id}</span>}
                </td>
                <td className="px-2 py-1 text-right font-mono text-zinc-400 tabular-nums whitespace-nowrap">
                  {e[1] === e[2] ? `${e[1]}` : `${e[1]}–${e[2]}`}
                </td>
                <td
                  className="px-2 py-1 text-right font-mono text-brand-400 tabular-nums w-14"
                  title="Chance a single chest holds this when it first rolls"
                >
                  {fmtOdds(p)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-600">
        Odds per chest. A chest rolls once, the first time its area loads, so one already opened may be empty.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The map canvas. Pan, zoom and picking are imperative on refs — running
// 12,000 pins through React state every frame would be pointless work.
// ---------------------------------------------------------------------------

function MapCanvas({
  data: A,
  edge,
  basemap,
  matches,
  alwaysShow,
  iconKeys,
  icons,
  showPins,
  selected,
  onPick,
}: {
  data: AtlasData;
  edge: number;
  basemap: string;
  matches: number[];
  alwaysShow: number[];
  iconKeys: string[];
  icons: IconSet;
  showPins: boolean;
  selected: number | null;
  onPick: (i: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // k is the on-screen size of the whole world square, in CSS pixels.
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);
  const visible = useRef<Set<number>>(new Set());
  // Once the view has been moved by hand, resizing must not yank it back.
  const userMoved = useRef(false);
  const [ready, setReady] = useState(false);
  const [zoomLabel, setZoomLabel] = useState("");

  const WORLD = A.world;
  const HALF = WORLD / 2;
  // The playable world is a disc inside the square: frame the disc.
  const discFraction = Math.min(1, (2 * (edge || HALF)) / WORLD);

  const fitK = useCallback(() => {
    const { w, h } = size.current;
    return (Math.min(w, h) * 0.97) / discFraction;
  }, [discFraction]);

  const clampK = useCallback((k: number) => Math.max(fitK() * 0.6, Math.min(WORLD * 4, k)), [fitK, WORLD]);

  const draw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { w, h, dpr } = size.current;
      const v = view.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0A0E16";
      ctx.fillRect(0, 0, w, h);

      const img = imgRef.current;
      if (img) {
        // Smooth while downscaling; crisp once magnified past native pixels.
        ctx.imageSmoothingEnabled = v.k <= img.width;
        // Draw only the part of the basemap on screen. Zoomed in, the whole
        // image would be scaled to tens of thousands of pixels every frame,
        // which software canvases skip outright.
        const s = img.width / v.k; // source px per screen px
        const x0 = Math.max(0, -v.tx * s);
        const y0 = Math.max(0, -v.ty * s);
        const x1 = Math.min(img.width, (w - v.tx) * s);
        const y1 = Math.min(img.height, (h - v.ty) * s);
        if (x1 > x0 && y1 > y0) {
          ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, v.tx + x0 / s, v.ty + y0 / s, (x1 - x0) / s, (y1 - y0) / s);
        }
      }

      // The world's rim; the basemap is transparent past it.
      const r = (edge / WORLD) * v.k;
      ctx.beginPath();
      ctx.arc(v.tx + v.k / 2, v.ty + v.k / 2, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(150,170,200,.35)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const glyph = v.k > WORLD * 1.5 ? 26 : v.k > WORLD / 1.5 ? 19 : 13;
      const disc = glyph * 0.6;
      const vis = visible.current;
      vis.clear();

      const marker = (i: number, sx: number, sy: number) => {
        ctx.beginPath();
        ctx.arc(sx, sy, disc, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,20,.82)";
        ctx.fill();
        ctx.strokeStyle = "rgba(226,232,240,.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const art = icons[iconKeys[i]];
        if (art) {
          ctx.drawImage(art, sx - glyph / 2, sy - glyph / 2, glyph, glyph);
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1.6, disc * 0.34), 0, Math.PI * 2);
          ctx.fillStyle = "#F8FAFC";
          ctx.fill();
        }
      };

      const place = (i: number) => {
        const sx = ((A.x[i] + HALF) / WORLD) * v.k + v.tx;
        const sy = ((HALF - A.z[i]) / WORLD) * v.k + v.ty;
        if (sx < -glyph || sy < -glyph || sx > w + glyph || sy > h + glyph) return;
        vis.add(i);
        marker(i, sx, sy);
      };
      for (const i of alwaysShow) place(i);
      if (showPins) for (const i of matches) place(i);

      if (selected !== null) {
        const sx = ((A.x[selected] + HALF) / WORLD) * v.k + v.tx;
        const sy = ((HALF - A.z[selected]) / WORLD) * v.k + v.ty;
        if (!showPins) {
          marker(selected, sx, sy);
          vis.add(selected);
        }
        ctx.beginPath();
        ctx.arc(sx, sy, disc + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(8,12,20,.9)";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = "#E5A548";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      setZoomLabel((v.k / WORLD).toFixed(2) + "×");
    });
  }, [A, HALF, WORLD, edge, matches, alwaysShow, selected, iconKeys, icons, showPins]);

  const fit = useCallback(() => {
    const { w, h } = size.current;
    const v = view.current;
    v.k = fitK();
    v.tx = (w - v.k) / 2;
    v.ty = (h - v.k) / 2;
    userMoved.current = false;
    draw();
  }, [draw, fitK]);

  // Refit for as long as the view has not been moved by hand — the first
  // ResizeObserver callback often lands before the flex layout has settled.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      const was = size.current;
      size.current = { w, h, dpr };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (!userMoved.current) {
        fit();
      } else {
        view.current.tx += (w - was.w) / 2;
        view.current.ty += (h - was.h) / 2;
        draw();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, draw]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setReady(true);
      draw();
    };
    img.onerror = () => setReady(true); // pins still work without terrain
    img.src = basemap;
    return () => {
      imgRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  useEffect(draw, [draw]);

  // Fly to a selection made from the list. The detail card covers the right
  // ~24rem of the map, so a pin under it counts as off-screen, and the fly
  // lands it in the middle of the part still showing.
  useEffect(() => {
    if (selected === null) return;
    const v = view.current;
    const { w, h } = size.current;
    const covered = w > 700 ? 390 : 0;
    const sx = ((A.x[selected] + HALF) / WORLD) * v.k + v.tx;
    if (visible.current.has(selected) && sx < w - covered) {
      draw();
      return;
    }
    userMoved.current = true;
    if (v.k < WORLD && !visible.current.has(selected)) v.k = clampK(WORLD);
    v.tx = (w - covered) / 2 - ((A.x[selected] + HALF) / WORLD) * v.k;
    v.ty = h / 2 - ((HALF - A.z[selected]) / WORLD) * v.k;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const zoomAt = (sx: number, sy: number, factor: number) => {
    userMoved.current = true;
    const v = view.current;
    const wx = ((sx - v.tx) / v.k) * WORLD - HALF;
    const wz = HALF - ((sy - v.ty) / v.k) * WORLD;
    v.k = clampK(v.k * factor);
    v.tx += sx - (((wx + HALF) / WORLD) * v.k + v.tx);
    v.ty += sy - (((HALF - wz) / WORLD) * v.k + v.ty);
    draw();
  };

  // React's onWheel is passive, so preventDefault there is ignored; bind natively.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.25 : 1 / 1.25);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  });

  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  return (
    <div
      ref={wrapRef}
      className="relative flex-1 min-h-0 rounded-xl border border-zinc-800 overflow-hidden bg-[#0A0E16] shadow-lg"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) {
            d.moved = true;
            userMoved.current = true;
          }
          view.current.tx += dx;
          view.current.ty += dy;
          d.x = e.clientX;
          d.y = e.clientY;
          draw();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          // A click, not a drag: pick the nearest visible pin.
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const v = view.current;
          let best = -1;
          let bestD = 14 * 14;
          for (const i of visible.current) {
            const px = ((A.x[i] + HALF) / WORLD) * v.k + v.tx;
            const py = ((HALF - A.z[i]) / WORLD) * v.k + v.ty;
            const dd = (px - sx) * (px - sx) + (py - sy) * (py - sy);
            if (dd < bestD) {
              bestD = dd;
              best = i;
            }
          }
          if (best >= 0) onPick(best);
        }}
      />

      {ready && !showPins && selected === null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-3">
          <p className="rounded-lg border border-zinc-700/80 bg-zinc-950/90 px-3.5 py-2 text-xs text-zinc-300 shadow-lg">
            Showing the starting stone. Tick a place, a biome, or search to fill the map.
          </p>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Drawing the basemap…
          </span>
        </div>
      )}

      <div className="absolute top-3 left-3 flex flex-col rounded-lg border border-zinc-700/80 bg-zinc-950/90 shadow-lg overflow-hidden divide-y divide-zinc-800">
        <IconBtn label="Zoom in" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.6)}>
          <Plus className="w-4 h-4" />
        </IconBtn>
        <IconBtn label="Zoom out" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.6)}>
          <Minus className="w-4 h-4" />
        </IconBtn>
        <IconBtn label="Fit the whole world" onClick={fit}>
          <Maximize2 className="w-4 h-4" />
        </IconBtn>
        <IconBtn
          label="Jump to spawn"
          onClick={() => {
            userMoved.current = true;
            const v = view.current;
            const { w, h } = size.current;
            v.k = clampK(WORLD);
            v.tx = w / 2 - v.k / 2;
            v.ty = h / 2 - v.k / 2;
            draw();
          }}
        >
          <Crosshair className="w-4 h-4" />
        </IconBtn>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-3 py-2.5 bg-gradient-to-t from-black/70 to-transparent">
        <p className="text-[11px] text-zinc-300/90">
          Drag to pan · scroll to zoom · click a marker ·{" "}
          {showPins
            ? `${matches.length.toLocaleString()} of ${A.p.length.toLocaleString()} shown`
            : `${A.p.length.toLocaleString()} locations`}
        </p>
        <span className="rounded border border-zinc-700 bg-zinc-950/80 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
          {zoomLabel}
        </span>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid place-items-center w-9 h-9 text-zinc-300 hover:text-brand-300 hover:bg-zinc-900 transition-colors"
    >
      {children}
    </button>
  );
}
