import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  ChevronLeft,
  ChevronDown,
  ExternalLink,
  Package,
  Sword,
  Shield,
  Utensils,
  FlaskConical,
  Wrench,
  Crosshair,
  Landmark,
  Skull,
  HelpCircle,
  Gem,
  ArrowUpDown,
  ShoppingCart,
  Lock,
  Store,
  Download,
  Plus,
  Minus,
  Trash2,
  LayoutGrid,
  Table2,
  ChevronsUpDown,
  ChevronUp,
  Factory,
  ArrowRight,
  Filter,
  Check,
  TreePine,
  Pickaxe,
  Hammer,
  Hand,
  Boxes,
  Archive,
  Eye,
  EyeOff,
  Shirt,
  MapPin,
  Copy,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { saveTextFile } from "../lib/tauri-api";
import { cn } from "../lib/utils";
import {
  useValheimDataStore,
  getFilteredItems,
  getUsedIn,
  getDroppedBy,
  getItemById,
  getWikiUrl,
  getRelatedItems,
  getTypeCounts,
  getBiomeCounts,
  getStationCounts,
  getVendorCounts,
  getFactoryCounts,
  getArmorSet,
  getVendorForItem,
  getVendorBuyPrice,
  getCreatureIconId,
  getStationItems,
  getStationItemsByLevel,
  getStationMaterials,
  getProcessingStationForOutput,
  getItemSource,
  VENDORS,
  VENDOR_LIST,
  BIOME_ORDER,
  STATION_LIST,
  STATION_ICONS,
  PROCESSING_STATIONS,
  PROCESSING_STATION_LIST,
  PROCESSING_STATION_ICONS,
  getStationUpgrades,
  getSubcategoryCounts,
  DAMAGE_TYPES,
  FACTION_LIST,
  type SortOption,
  type TableSortKey,
} from "../stores/valheimDataStore";
import { VALHEIM_ITEMS, type ValheimItem, type ItemType, itemMap, tokenMap } from "../data/valheim-items";
import { usePlayerDataStore } from "../stores/playerDataStore";
import { useToastStore } from "../stores/toastStore";

/** Renders a game icon with Lucide fallback */
function ItemIcon({ id, type, size = 36, className = "" }: { id: string; type?: ItemType; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const Icon = TYPE_ICONS[type || "Misc"] || Package;

  // For creatures, try trophy icon as fallback
  if (type === "Creature" && failed && !fallbackFailed) {
    const item = getItemById(id);
    if (item) {
      const trophyId = getCreatureIconId(item);
      if (trophyId !== id) {
        return (
          <img
            src={`/icons/${trophyId}.png`}
            alt=""
            width={size}
            height={size}
            className={cn("object-contain", className)}
            onError={() => setFallbackFailed(true)}
            loading="lazy"
          />
        );
      }
    }
  }

  if (failed) {
    return <Icon className={cn("text-zinc-400", className)} style={{ width: size * 0.5, height: size * 0.5 }} />;
  }
  return (
    <img
      src={`/icons/${id}.png`}
      alt=""
      width={size}
      height={size}
      className={cn("object-contain", className)}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

/** Renders a station icon */
function StationIcon({ station, size = 36, className = "" }: { station: string; size?: number; className?: string }) {
  const iconId = STATION_ICONS[station];
  if (!iconId) return <Wrench className={cn("text-amber-400", className)} style={{ width: size * 0.5, height: size * 0.5 }} />;
  return (
    <img
      src={`/icons/${iconId}.png`}
      alt={station}
      width={size}
      height={size}
      className={cn("object-contain", className)}
      loading="lazy"
    />
  );
}

/** Parse "28 (+2/lvl)" (items) or "40/40lvl" (creatures) → { base, perLevel } */
function parseStatValue(value: string): { base: number; perLevel: number } | null {
  // Creature format: "40/40lvl"
  const cm = value.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)lvl$/);
  if (cm) return { base: parseFloat(cm[1]), perLevel: parseFloat(cm[2]) };
  // Item format: "105 (+6/lvl)"
  const im = value.match(/^(-?\d+(?:\.\d+)?)\s*(?:\(\+(\d+(?:\.\d+)?)\/lvl\))?$/);
  if (!im) return null;
  return { base: parseFloat(im[1]), perLevel: im[2] ? parseFloat(im[2]) : 0 };
}

/** Compute stat at a given quality level */
function statAtLevel(value: string, level: number): string {
  const p = parseStatValue(value);
  if (!p) return value;
  if (p.perLevel === 0) return value;
  const computed = p.base + p.perLevel * (level - 1);
  return Number.isInteger(computed) ? `${computed}` : computed.toFixed(1);
}

/** Check if an item has per-level stats (items: "/lvl", creatures: "Nlvl") */
function hasPerLevelStats(item: ValheimItem): boolean {
  return item.maxQuality > 1 && item.stats.some((s) => s.value.includes("lvl"));
}

const TYPE_ICONS: Record<ItemType, typeof Package> = {
  Material: Gem,
  Weapon: Sword,
  Armor: Shield,
  Clothing: Shirt,
  Food: Utensils,
  Potion: FlaskConical,
  Tool: Wrench,
  Ammo: Crosshair,
  BuildPiece: Landmark,
  Creature: Skull,
  WorldObject: MapPin,
  Misc: HelpCircle,
};

const TYPE_ORDER: ItemType[] = [
  "Material", "Weapon", "Armor", "Clothing", "Food", "Potion",
  "Tool", "Ammo", "BuildPiece", "Creature", "WorldObject", "Misc",
];

const TYPE_GROUP_LABELS: Partial<Record<ItemType, string>> = {
  Material: "Materials",
  Weapon: "Weapons",
  Armor: "Armour",
  Clothing: "Clothing",
  Food: "Food",
  Potion: "Potions",
  Tool: "Tools",
  Ammo: "Ammo",
  BuildPiece: "Build Pieces",
  Creature: "Creatures",
  WorldObject: "World Objects",
  Misc: "Misc",
};

export const BIOME_COLORS: Record<string, string> = {
  Meadows: "text-lime-400",
  "Black Forest": "text-teal-400",
  Swamp: "text-green-500",
  Mountain: "text-slate-300",
  Plains: "text-yellow-400",
  Mistlands: "text-purple-400",
  Ocean: "text-blue-400",
  Ashlands: "text-orange-400",
  "Deep North": "text-sky-400",
};

export const BIOME_BG_COLORS: Record<string, string> = {
  Meadows: "bg-lime-500/10 border-lime-500/20",
  "Black Forest": "bg-teal-500/10 border-teal-500/20",
  Swamp: "bg-green-500/10 border-green-500/20",
  Mountain: "bg-slate-400/10 border-slate-400/20",
  Plains: "bg-yellow-500/10 border-yellow-500/20",
  Mistlands: "bg-purple-500/10 border-purple-500/20",
  Ocean: "bg-blue-500/10 border-blue-500/20",
  Ashlands: "bg-orange-500/10 border-orange-500/20",
  "Deep North": "bg-sky-500/10 border-sky-500/20",
};

const VENDOR_ICONS: Record<string, string> = {
  Haldor: "/icons/vendor_haldor.png",
  Hildir: "/icons/vendor_hildir.png",
  "Bog Witch": "/icons/vendor_bogwitch.png",
};

function VendorIcon({ name, size = 24, className = "" }: { name: string; size?: number; className?: string }) {
  const src = VENDOR_ICONS[name];
  if (!src) return <Store className={className} style={{ width: size, height: size }} />;
  return (
    <img
      src={src}
      alt={name}
      className={cn("rounded-full object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name A→Z" },
  { value: "name-desc", label: "Name Z→A" },
  { value: "tier-asc", label: "Tier ↑ (Low → High)" },
  { value: "tier-desc", label: "Tier ↓ (High → Low)" },
  { value: "biome-grouped", label: "Biome (Progression)" },
];

/** Icon color classes per biome for group headers */
const BIOME_HEADER_COLORS: Record<string, string> = {
  Meadows: "text-lime-400",
  "Black Forest": "text-teal-400",
  Swamp: "text-green-500",
  Mountain: "text-slate-300",
  Plains: "text-yellow-400",
  Mistlands: "text-purple-400",
  Ocean: "text-blue-400",
  Ashlands: "text-orange-400",
  "Deep North": "text-sky-400",
  Unknown: "text-zinc-500",
};

function BiomeBadge({ biome, onClick }: { biome: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 rounded text-[10px] font-semibold border transition-all",
        onClick ? "cursor-pointer hover:brightness-125" : "cursor-default",
        BIOME_BG_COLORS[biome] || "bg-zinc-800/60 border-zinc-700/30",
        BIOME_COLORS[biome] || "text-zinc-400"
      )}
    >
      {biome}
    </button>
  );
}

function TypeBadge({ type, subcategory, onClick, onSubcategoryClick }: { type: string; subcategory?: string; onClick?: () => void; onSubcategoryClick?: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-zinc-800/80 border border-zinc-700/50 transition-colors",
          onClick ? "cursor-pointer hover:text-brand-400 hover:border-brand-500/30 text-zinc-400" : "cursor-default text-zinc-400"
        )}
      >
        {type === "BuildPiece" ? "Build Piece" : type}
      </button>
      {subcategory && subcategory !== type && (
        <button
          type="button"
          onClick={onSubcategoryClick}
          className={cn(
            "px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-zinc-800/50 border border-zinc-700/30 transition-colors",
            onSubcategoryClick ? "cursor-pointer hover:text-brand-400 hover:border-brand-500/30 text-zinc-500" : "cursor-default text-zinc-500"
          )}
        >
          {subcategory}
        </button>
      )}
    </>
  );
}

// ── Copy-to-clipboard ──────────────────────────────────────

/** Copies item.name to clipboard and fires a toast. Stops event propagation so it works inside clickable cards/rows. */
function copyItemName(item: ValheimItem, e?: React.MouseEvent) {
  copyText(item.name, e);
}

/** Copies arbitrary text to clipboard with a toast. */
function copyText(text: string, e?: React.MouseEvent) {
  e?.stopPropagation();
  e?.preventDefault();
  navigator.clipboard.writeText(text).then(
    () =>
      useToastStore.getState().addToast({
        type: "success",
        title: "Copied",
        message: text,
        duration: 1500,
      }),
    () =>
      useToastStore.getState().addToast({
        type: "warning",
        title: "Copy failed",
        message: "Clipboard not available",
        duration: 2500,
      })
  );
}

/**
 * Clickable pill for a damage type or faction/tameable value on a creature detail.
 * Matches the visual weight of BiomeBadge so cards feel consistent.
 */
function DetailChip({
  label,
  tone = "zinc",
  onClick,
  title,
}: {
  label: string;
  tone?: "red" | "orange" | "emerald" | "zinc" | "purple" | "amber" | "blue";
  onClick?: () => void;
  title?: string;
}) {
  const tones: Record<string, string> = {
    red: "bg-red-500/10 text-red-300 border-red-500/25 hover:bg-red-500/20",
    orange: "bg-orange-500/10 text-orange-300 border-orange-500/25 hover:bg-orange-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/20",
    zinc: "bg-zinc-800/60 text-zinc-300 border-zinc-700/40 hover:bg-zinc-800",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/25 hover:bg-purple-500/20",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/25 hover:bg-amber-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/25 hover:bg-blue-500/20",
  };
  const base = "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors";
  if (!onClick) {
    return <span className={cn(base, tones[tone], "cursor-default")}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title ?? label}
      className={cn(base, tones[tone], "cursor-pointer")}
    >
      {label}
    </button>
  );
}

function CopyTextButton({
  text,
  size = 16,
  title,
  className = "",
}: {
  text: string;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => copyText(text, e)}
      title={title ?? `Copy "${text}"`}
      aria-label={title ?? "Copy"}
      className={cn(
        "p-1 rounded text-zinc-500 hover:text-brand-400 hover:bg-zinc-800/60 transition-colors",
        className
      )}
    >
      <Copy style={{ width: size, height: size }} />
    </button>
  );
}

function CopyButton({
  item,
  size = 14,
  className = "",
  title = "Copy name",
}: {
  item: ValheimItem;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => copyItemName(item, e)}
      title={title}
      aria-label={title}
      className={cn(
        "p-1 rounded text-zinc-500 hover:text-brand-400 hover:bg-zinc-800/60 transition-colors",
        className
      )}
    >
      <Copy style={{ width: size, height: size }} />
    </button>
  );
}

// ── Filter Sidebar Components ──────────────────────────────

function FilterAccordion({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800/30 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-1.5 px-1 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <span className="uppercase tracking-wider">{title}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="pb-1.5 space-y-0.5">
          {children}
        </div>
      )}
    </div>
  );
}

function FilterCheckbox({
  checked,
  onChange,
  count,
  icon,
  children,
  labelClassName,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  count?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <button type="button" onClick={onChange} className={cn("flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer hover:bg-zinc-800/40 transition-colors group w-full text-left", className)}>
      <div className={cn(
        "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
        checked
          ? "bg-brand-500 border-brand-500"
          : "border-zinc-700 group-hover:border-zinc-500"
      )}>
        {checked && <Check className="w-2.5 h-2.5 text-white" />}
      </div>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className={cn("text-[11px] truncate flex-1", labelClassName || (checked ? "text-zinc-200" : "text-zinc-400"))}>
        {children}
      </span>
      {count != null && count > 0 && (
        <span className="text-[9px] text-zinc-600 tabular-nums shrink-0">{count}</span>
      )}
    </button>
  );
}

export function ValheimData() {
  const navigate = useNavigate();
  const {
    query, activeTypes, activeBiomes, activeStations, activeFactories, activeVendors, sortBy,
    selectedItem, selectedStation, selectedFactory, selectedVendor,
    cartItems, activeSubcategories, onlyTameable,
    activeFactions, activeDealsDamage, activeWeakTo,
    viewMode, tableSortKey, tableSortDir,
    stationMaterialsMode, setStationMaterialsMode,
    setQuery, setActiveType, setActiveSubcategory, setActiveBiome,
    setActiveStation, setActiveFactory, setActiveVendor, setSortBy, setSelectedItem,
    setSelectedStation, setSelectedFactory, setSelectedVendor,
    setViewMode, setTableSort,
    toggleType, toggleSubcategory, toggleBiome, toggleStation, toggleFactory, toggleVendor,
    setOnlyTameable, toggleOnlyTameable,
    toggleFaction, toggleDealsDamage, toggleWeakTo,
  } = useValheimDataStore();

  const [searchInput, setSearchInput] = useState(query);
  const [sortOpen, setSortOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef(0);

  // Debounced live search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(searchInput);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // Close sort/export dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    if (sortOpen || exportOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen, exportOpen]);

  // Save scroll position before navigating to detail, restore on back
  const selectItem = (item: ValheimItem) => {
    if (scrollContainerRef.current) {
      savedScrollPos.current = scrollContainerRef.current.scrollTop;
    }
    setSelectedItem(item);
  };

  useEffect(() => {
    if (!selectedItem && !selectedStation && !selectedFactory && !selectedVendor && scrollContainerRef.current && savedScrollPos.current > 0) {
      scrollContainerRef.current.scrollTop = savedScrollPos.current;
    }
  }, [selectedItem, selectedStation, selectedFactory, selectedVendor]);

  const items = getFilteredItems(query, activeTypes, activeBiomes, activeStations, activeVendors, sortBy, activeSubcategories, activeFactories, onlyTameable, activeFactions, activeDealsDamage, activeWeakTo);
  const typeCounts = getTypeCounts(query, activeBiomes, activeStations);
  const biomeCounts = getBiomeCounts(query, activeTypes, activeStations);
  const stationCounts = getStationCounts(query, activeTypes, activeBiomes);
  const vendorCounts = getVendorCounts(query, activeTypes, activeBiomes, activeStations);
  const factoryCounts = getFactoryCounts(query, activeTypes, activeBiomes, activeStations);
  const subcategoryCounts = getSubcategoryCounts(query, activeTypes, activeBiomes, activeStations);
  const totalMatching = items.length;

  const stationMaterials = useMemo(() => {
    if (!stationMaterialsMode || activeStations.length === 0) return [];
    return getStationMaterials(activeStations, stationMaterialsMode);
  }, [stationMaterialsMode, activeStations]);
  const subcategoryEntries = Object.entries(subcategoryCounts).sort((a, b) => b[1] - a[1]);
  const hasActiveFilters = query || activeTypes.length > 0 || activeSubcategories.length > 0 || activeBiomes.length > 0 || activeStations.length > 0 || activeFactories.length > 0 || activeVendors.length > 0 || onlyTameable || activeFactions.length > 0 || activeDealsDamage.length > 0 || activeWeakTo.length > 0 || sortBy !== "name-asc";

  // Group items by type (default) or by biome (when biome-grouped)
  const groupedItems = useMemo(() => {
    if (sortBy === "biome-grouped") {
      // Group by earliest biome in progression order
      const byBiome = new Map<string, ValheimItem[]>();
      for (const item of items) {
        // Pick the earliest biome (lowest tier) for grouping
        let biome = "Unknown";
        if (item.biomes.length > 0) {
          let minTier = Infinity;
          for (const b of item.biomes) {
            const idx = BIOME_ORDER.indexOf(b as any);
            const tier = idx >= 0 ? idx : BIOME_ORDER.length;
            if (tier < minTier) { minTier = tier; biome = b; }
          }
        }
        const list = byBiome.get(biome) || [];
        list.push(item);
        byBiome.set(biome, list);
      }
      const groups: { key: string; label: string; icon?: typeof Package; colorClass?: string; items: ValheimItem[] }[] = [];
      for (const biome of [...BIOME_ORDER]) {
        const list = byBiome.get(biome);
        if (list && list.length > 0) {
          groups.push({ key: biome, label: biome, colorClass: BIOME_HEADER_COLORS[biome], items: list });
        }
      }
      // Items with no recognized biome
      const unknown = byBiome.get("Unknown");
      if (unknown && unknown.length > 0) {
        groups.push({ key: "Unknown", label: "Unknown Biome", colorClass: BIOME_HEADER_COLORS["Unknown"], items: unknown });
      }
      return groups;
    }

    // Default: group by item type
    const groups: { key: string; label: string; icon?: typeof Package; colorClass?: string; items: ValheimItem[] }[] = [];
    const byType = new Map<string, ValheimItem[]>();
    for (const item of items) {
      const list = byType.get(item.type) || [];
      list.push(item);
      byType.set(item.type, list);
    }
    for (const type of TYPE_ORDER) {
      const list = byType.get(type);
      if (list && list.length > 0) {
        groups.push({ key: type, label: TYPE_GROUP_LABELS[type] || `${type}s`, icon: TYPE_ICONS[type] || Package, items: list });
      }
    }
    return groups;
  }, [items, sortBy]);

  // Export helpers
  const doExport = async (format: "csv" | "json" | "txt") => {
    setExportOpen(false);
    const ext = format;
    const filters = format === "csv"
      ? [{ name: "CSV", extensions: ["csv"] }]
      : format === "json"
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "Text", extensions: ["txt"] }];
    const path = await save({ defaultPath: `valheim-data.${ext}`, filters });
    if (!path) return;

    let content: string;
    if (format === "json") {
      content = JSON.stringify(items.map(exportItem), null, 2);
    } else if (format === "csv") {
      content = exportCsv(items);
    } else {
      content = exportTxt(items);
    }
    await saveTextFile(path, content);
  };

  const activeFilterCount = activeTypes.length + activeSubcategories.length + activeBiomes.length + activeStations.length + activeFactories.length + activeVendors.length + (onlyTameable ? 1 : 0) + activeFactions.length + activeDealsDamage.length + activeWeakTo.length;

  // Browser-style back — if user landed here from another page (e.g. PlayerData
  // clicking an inventory item), honour the stored returnPath. Otherwise just
  // clear the selected detail to drop back to the list.
  const returnPath = useValheimDataStore((s) => s.returnPath);
  const setReturnPath = useValheimDataStore((s) => s.setReturnPath);
  const backFromDetail = (clearer: () => void) => () => {
    if (returnPath) {
      const path = returnPath;
      setReturnPath(null);
      clearer();
      navigate(path);
    } else {
      clearer();
    }
  };

  // Station detail view
  if (selectedStation) {
    return <StationDetailView station={selectedStation} onBack={backFromDetail(() => setSelectedStation(null))} />;
  }

  // Factory (processing station) detail view
  if (selectedFactory) {
    return <ProcessingStationDetailView stationName={selectedFactory} onBack={backFromDetail(() => setSelectedFactory(null))} />;
  }

  // Vendor detail view
  if (selectedVendor) {
    return <VendorDetailView vendorName={selectedVendor} onBack={backFromDetail(() => setSelectedVendor(null))} />;
  }

  // Item detail view
  if (selectedItem) {
    return <DetailView item={selectedItem} onBack={backFromDetail(() => setSelectedItem(null))} />;
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
      {/* Header: Title + Search + Buttons in one row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="shrink-0">
          <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide leading-tight">Valheim Data</h1>
          <p className="text-zinc-500 text-xs">
            {totalMatching.toLocaleString()} item{totalMatching !== 1 ? "s" : ""}
            {hasActiveFilters ? " matching" : " in database"}
          </p>
        </div>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search items, creatures, biomes, materials..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-10 py-2 rounded-lg glass border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/25 transition-all"
          />
          {searchInput && (
            <button
              title="Clear search"
              onClick={() => {
                setSearchInput("");
                setQuery("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sort Dropdown */}
        <div className="relative" ref={sortRef}>
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-2 px-3 h-[36px] rounded-lg glass border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
            <ChevronDown className={cn("w-3 h-3 transition-transform", sortOpen && "rotate-180")} />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] glass rounded-lg border border-zinc-800 shadow-xl py-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setSortBy(opt.value); setSortOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs transition-colors",
                    sortBy === opt.value
                      ? "text-brand-400 bg-brand-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Export Dropdown */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            title="Export data"
            className="flex items-center gap-2 px-3 h-[36px] rounded-lg glass border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export
            <ChevronDown className={cn("w-3 h-3 transition-transform", exportOpen && "rotate-180")} />
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] glass rounded-lg border border-zinc-800 shadow-xl py-1">
              {(["csv", "json", "txt"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => doExport(fmt)}
                  className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex items-center rounded-lg glass border border-zinc-800 overflow-hidden h-[36px]">
          <button
            title="Grid view"
            onClick={() => setViewMode("grid")}
            className={cn(
              "flex items-center justify-center w-[34px] h-full transition-colors",
              viewMode === "grid"
                ? "bg-brand-500/15 text-brand-400"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-zinc-800" />
          <button
            title="Table view"
            onClick={() => setViewMode("table")}
            className={cn(
              "flex items-center justify-center w-[34px] h-full transition-colors",
              viewMode === "table"
                ? "bg-brand-500/15 text-brand-400"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <Table2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cart Button */}
        <button
          onClick={() => navigate("/cart")}
          className={cn(
            "relative flex items-center gap-2 px-3 h-[36px] rounded-lg glass border text-xs transition-colors whitespace-nowrap",
            cartItems.length > 0
              ? "border-brand-500/30 text-brand-400 hover:text-brand-300"
              : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
          )}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          Cart
          {cartItems.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {cartItems.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Main content: Sidebar + Items ── */}
      <div className="flex flex-1 min-h-0 gap-3">
        {/* Filter Sidebar */}
        <div className="w-56 shrink-0 glass rounded-xl border border-zinc-800/50 flex flex-col overflow-hidden">
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/50">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-300">Filters</span>
              {activeFilterCount > 0 && (
                <span className="min-w-[18px] h-[18px] rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                  {activeFilterCount}
                </span>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setSearchInput("");
                  setQuery("");
                  setActiveType("");
                  setActiveSubcategory("");
                  setActiveBiome("");
                  setActiveStation("");
                  setActiveFactory("");
                  setActiveVendor("");
                  setOnlyTameable(false);
                  useValheimDataStore.setState({ activeFactions: [], activeDealsDamage: [], activeWeakTo: [] });
                  setStationMaterialsMode(false);
                  setSortBy("name-asc");
                }}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Scrollable filter groups */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* Item Type */}
            <FilterAccordion title="Item Type" defaultOpen>
              {TYPE_ORDER.map((type) => {
                const count = typeCounts[type] || 0;
                if (count === 0 && query) return null;
                const Icon = TYPE_ICONS[type];
                return (
                  <FilterCheckbox
                    key={type}
                    checked={activeTypes.includes(type)}
                    onChange={() => toggleType(type)}
                    count={count}
                    icon={<Icon className="w-3 h-3" />}
                  >
                    {type === "BuildPiece" ? "Build Piece" : type}
                  </FilterCheckbox>
                );
              })}
            </FilterAccordion>

            {/* Special — only when viewing creatures or no type filter */}
            {(activeTypes.length === 0 || activeTypes.includes("Creature")) && (
              <FilterAccordion title="Special" defaultOpen>
                <FilterCheckbox
                  checked={onlyTameable}
                  onChange={toggleOnlyTameable}
                  count={VALHEIM_ITEMS.filter((i) => i.tameable).length}
                  labelClassName="text-emerald-400"
                >
                  Tameable
                </FilterCheckbox>
              </FilterAccordion>
            )}

            {/* Subcategory — only shown when types are selected and subcategories exist */}
            {activeTypes.length > 0 && subcategoryEntries.length > 1 && (
              <FilterAccordion title="Subcategory" defaultOpen>
                {subcategoryEntries.map(([sub, count]) => (
                  <FilterCheckbox
                    key={sub}
                    checked={activeSubcategories.includes(sub)}
                    onChange={() => toggleSubcategory(sub)}
                    count={count}
                  >
                    {sub}
                  </FilterCheckbox>
                ))}
              </FilterAccordion>
            )}

            {/* Biome */}
            <FilterAccordion title="Biome" defaultOpen>
              {BIOME_ORDER.map((biome) => {
                const count = biomeCounts[biome] || 0;
                if (count === 0 && (query || activeTypes.length > 0 || activeStations.length > 0)) return null;
                return (
                  <FilterCheckbox
                    key={biome}
                    checked={activeBiomes.includes(biome)}
                    onChange={() => toggleBiome(biome)}
                    count={count}
                    labelClassName={BIOME_COLORS[biome]}
                  >
                    {biome}
                  </FilterCheckbox>
                );
              })}
            </FilterAccordion>

            {/* ── Creature-only filters — shown when Creature type is active, or no type is filtered ── */}
            {(activeTypes.length === 0 || activeTypes.includes("Creature")) && (
              <>
                <FilterAccordion title="Faction" defaultOpen={activeTypes.includes("Creature")}>
                  {FACTION_LIST.map((f) => {
                    const count = VALHEIM_ITEMS.filter((i) => i.type === "Creature" && i.faction === f).length;
                    return (
                      <FilterCheckbox
                        key={f}
                        checked={activeFactions.includes(f)}
                        onChange={() => toggleFaction(f)}
                        count={count}
                      >
                        {f}
                      </FilterCheckbox>
                    );
                  })}
                </FilterAccordion>

                <FilterAccordion title="Deals Damage" defaultOpen={false}>
                  {DAMAGE_TYPES.map((d) => {
                    const count = VALHEIM_ITEMS.filter((i) => i.dealsDamage?.includes(d)).length;
                    if (count === 0) return null;
                    return (
                      <FilterCheckbox
                        key={d}
                        checked={activeDealsDamage.includes(d)}
                        onChange={() => toggleDealsDamage(d)}
                        count={count}
                      >
                        {d}
                      </FilterCheckbox>
                    );
                  })}
                </FilterAccordion>

                <FilterAccordion title="Weak To" defaultOpen={false}>
                  {DAMAGE_TYPES.map((d) => {
                    const count = VALHEIM_ITEMS.filter((i) => i.weakTo?.includes(d)).length;
                    if (count === 0) return null;
                    return (
                      <FilterCheckbox
                        key={d}
                        checked={activeWeakTo.includes(d)}
                        onChange={() => toggleWeakTo(d)}
                        count={count}
                        labelClassName="text-emerald-400"
                      >
                        {d}
                      </FilterCheckbox>
                    );
                  })}
                </FilterAccordion>
              </>
            )}

            {/* Station — hidden when no matching stations */}
            {STATION_LIST.some((s) => (stationCounts[s] || 0) > 0 || activeStations.includes(s)) && (
            <FilterAccordion title="Station" defaultOpen>
              {activeStations.length > 0 && (
                <div className="flex items-center rounded-md bg-zinc-800/40 border border-zinc-700/30 overflow-hidden mb-1.5 mx-1">
                  <button
                    onClick={() => setStationMaterialsMode(false)}
                    className={cn(
                      "flex-1 flex items-center justify-center py-1 text-[10px] font-medium transition-colors",
                      !stationMaterialsMode
                        ? "bg-brand-500/15 text-brand-400"
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    Items
                  </button>
                  <div className="w-px h-3 bg-zinc-700/50" />
                  <button
                    onClick={() => setStationMaterialsMode("craft")}
                    className={cn(
                      "flex-1 flex items-center justify-center py-1 text-[10px] font-medium transition-colors",
                      stationMaterialsMode === "craft"
                        ? "bg-amber-500/15 text-amber-400"
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    Craft Mats
                  </button>
                  <div className="w-px h-3 bg-zinc-700/50" />
                  <button
                    onClick={() => setStationMaterialsMode("build")}
                    className={cn(
                      "flex-1 flex items-center justify-center py-1 text-[10px] font-medium transition-colors",
                      stationMaterialsMode === "build"
                        ? "bg-amber-500/15 text-amber-400"
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    Build Mats
                  </button>
                </div>
              )}
              {STATION_LIST.map((station) => {
                const count = stationCounts[station] || 0;
                if (count === 0 && (query || activeTypes.length > 0 || activeBiomes.length > 0)) return null;
                return (
                  <div key={station} className="flex items-center gap-0">
                    <FilterCheckbox
                      checked={activeStations.includes(station)}
                      onChange={() => toggleStation(station)}
                      count={count}
                      className="flex-1"
                    >
                      {station}
                    </FilterCheckbox>
                    <button
                      title={`View ${station} page`}
                      onClick={() => setSelectedStation(station)}
                      className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </FilterAccordion>
            )}

            {/* Vendor — hidden when no matching vendor items */}
            {VENDOR_LIST.some((v) => (vendorCounts[v] || 0) > 0 || activeVendors.includes(v)) && (
            <FilterAccordion title="Vendor" defaultOpen>
              {VENDOR_LIST.map((vendor) => {
                const count = vendorCounts[vendor] || 0;
                if (count === 0 && !activeVendors.includes(vendor) && (query || activeTypes.length > 0 || activeBiomes.length > 0)) return null;
                return (
                  <div key={vendor} className="flex items-center gap-0">
                    <FilterCheckbox
                      checked={activeVendors.includes(vendor)}
                      onChange={() => toggleVendor(vendor)}
                      count={count}
                      icon={<VendorIcon name={vendor} size={14} />}
                      className="flex-1"
                    >
                      {vendor}
                    </FilterCheckbox>
                    <button
                      title={`View ${vendor} page`}
                      onClick={() => setSelectedVendor(vendor)}
                      className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </FilterAccordion>
            )}

            {/* Factory — hidden when no matching processing stations */}
            {PROCESSING_STATION_LIST.some((f) => (factoryCounts[f] || 0) > 0 || activeFactories.includes(f)) && (
            <FilterAccordion title="Factory" defaultOpen>
              {PROCESSING_STATION_LIST.map((factory) => {
                const count = factoryCounts[factory] || 0;
                if (count === 0 && !activeFactories.includes(factory) && (query || activeTypes.length > 0 || activeBiomes.length > 0)) return null;
                const iconId = PROCESSING_STATION_ICONS[factory];
                return (
                  <div key={factory} className="flex items-center gap-0">
                    <FilterCheckbox
                      checked={activeFactories.includes(factory)}
                      onChange={() => toggleFactory(factory)}
                      count={count}
                      icon={iconId ? <img src={`/icons/${iconId}.png`} alt="" className="w-3.5 h-3.5 object-contain" /> : undefined}
                      className="flex-1"
                    >
                      {factory}
                    </FilterCheckbox>
                    <button
                      title={`View ${factory} page`}
                      onClick={() => setSelectedFactory(factory)}
                      className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </FilterAccordion>
            )}
          </div>
        </div>

        {/* Item Grid / Table — grouped by type */}
        <div ref={scrollContainerRef} className="flex-1 min-w-0 overflow-y-auto">
          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {query && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-800/50 text-[11px] text-zinc-300">
                  &ldquo;{query}&rdquo;
                  <button title="Clear search" onClick={() => { setSearchInput(""); setQuery(""); }}>
                    <X className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
                  </button>
                </span>
              )}
              {activeTypes.map((t) => (
                <span key={t} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-[11px] text-brand-400">
                  {t}
                  <button title="Clear type filter" onClick={() => toggleType(t)}>
                    <X className="w-3 h-3 text-brand-400/50 hover:text-brand-400" />
                  </button>
                </span>
              ))}
              {activeSubcategories.map((s) => (
                <span key={s} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-[11px] text-brand-300">
                  {s}
                  <button title="Clear subcategory" onClick={() => toggleSubcategory(s)}>
                    <X className="w-3 h-3 text-brand-300/50 hover:text-brand-300" />
                  </button>
                </span>
              ))}
              {activeBiomes.map((b) => (
                <span key={b} className={cn("flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-800/50 text-[11px]", BIOME_COLORS[b] || "text-zinc-300")}>
                  {b}
                  <button title="Clear biome" onClick={() => toggleBiome(b)}>
                    <X className="w-3 h-3 opacity-50 hover:opacity-100" />
                  </button>
                </span>
              ))}
              {onlyTameable && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-[11px] text-emerald-400 border border-emerald-500/20">
                  Tameable
                  <button title="Clear Tameable filter" onClick={() => setOnlyTameable(false)}>
                    <X className="w-3 h-3 text-emerald-400/50 hover:text-emerald-400" />
                  </button>
                </span>
              )}
              {activeFactions.map((f) => (
                <span key={f} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/10 text-[11px] text-purple-300 border border-purple-500/20">
                  Faction: {f}
                  <button title="Clear faction" onClick={() => toggleFaction(f)}>
                    <X className="w-3 h-3 text-purple-300/50 hover:text-purple-300" />
                  </button>
                </span>
              ))}
              {activeDealsDamage.map((d) => (
                <span key={d} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 text-[11px] text-red-300 border border-red-500/20">
                  Deals: {d}
                  <button title="Clear damage filter" onClick={() => toggleDealsDamage(d)}>
                    <X className="w-3 h-3 text-red-300/50 hover:text-red-300" />
                  </button>
                </span>
              ))}
              {activeWeakTo.map((d) => (
                <span key={d} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-[11px] text-emerald-300 border border-emerald-500/20">
                  Weak to: {d}
                  <button title="Clear weak-to filter" onClick={() => toggleWeakTo(d)}>
                    <X className="w-3 h-3 text-emerald-300/50 hover:text-emerald-300" />
                  </button>
                </span>
              ))}
              {activeStations.map((s) => (
                <span key={s} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-[11px] text-amber-400">
                  {s}
                  <button title="Clear station" onClick={() => toggleStation(s)}>
                    <X className="w-3 h-3 text-amber-400/50 hover:text-amber-400" />
                  </button>
                </span>
              ))}
              {stationMaterialsMode && activeStations.length > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-[11px] text-amber-300 border border-amber-500/20">
                  {stationMaterialsMode === "craft" ? "Craft Materials" : "Build Materials"}
                  <button title="Switch back to items" onClick={() => setStationMaterialsMode(false)}>
                    <X className="w-3 h-3 text-amber-300/50 hover:text-amber-300" />
                  </button>
                </span>
              )}
              {activeVendors.map((v) => (
                <span key={v} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-[11px] text-emerald-400">
                  {v}
                  <button title="Clear vendor" onClick={() => toggleVendor(v)}>
                    <X className="w-3 h-3 text-emerald-400/50 hover:text-emerald-400" />
                  </button>
                </span>
              ))}
              {activeFactories.map((f) => (
                <span key={f} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-500/10 text-[11px] text-orange-400">
                  {f}
                  <button title="Clear factory" onClick={() => toggleFactory(f)}>
                    <X className="w-3 h-3 text-orange-400/50 hover:text-orange-400" />
                  </button>
                </span>
              ))}
              {sortBy !== "name-asc" && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-800/50 text-[11px] text-zinc-400">
                  Sort: {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
                  <button title="Reset sort" onClick={() => setSortBy("name-asc")}>
                    <X className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
                  </button>
                </span>
              )}
            </div>
          )}

          {stationMaterialsMode && activeStations.length > 0 ? (
            <StationMaterialsView materials={stationMaterials} stations={activeStations} mode={stationMaterialsMode} onItemClick={selectItem} />
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-500">No items found</p>
            </div>
          ) : viewMode === "table" ? (
            <ItemTable items={items} tableSortKey={tableSortKey} tableSortDir={tableSortDir} onSort={setTableSort} onSelect={selectItem} />
          ) : (
            <div className="space-y-6">
              {groupedItems.map(({ key, label, icon: GIcon, colorClass, items: groupItems }) => (
                <div key={key}>
                  {/* Group header */}
                  {groupedItems.length > 1 && (
                    <div className="flex items-center gap-2 mb-2 sticky top-0 z-10 bg-[#0c0e14]/90 backdrop-blur-sm py-1.5">
                      {GIcon ? (
                        <GIcon className="w-4 h-4 text-zinc-500" />
                      ) : (
                        <span className={cn("w-2.5 h-2.5 rounded-full inline-block", colorClass?.replace("text-", "bg-") || "bg-zinc-500")} />
                      )}
                      <span className={cn("text-sm font-semibold", colorClass || "text-zinc-300")}>
                        {label}
                      </span>
                      <span className="text-[11px] text-zinc-600">{groupItems.length}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {groupItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => selectItem(item)}
                        className="relative glass rounded-xl p-3.5 border border-zinc-800/50 hover:border-zinc-700/50 cursor-pointer transition-all duration-200 group"
                      >
                        <CopyButton
                          item={item}
                          size={12}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          title={`Copy "${item.name}"`}
                        />
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg bg-zinc-800/80 flex items-center justify-center shrink-0 overflow-hidden">
                            <ItemIcon id={item.id} type={item.type} size={36} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-zinc-200 text-sm truncate group-hover:text-brand-400 transition-colors">
                              {item.name}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.subcategory && (
                                <span className="text-[10px] text-zinc-500">{item.subcategory}</span>
                              )}
                            </div>
                            {item.biomes.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {item.biomes.map((b) => (
                                  <span
                                    key={b}
                                    className={cn(
                                      "text-[10px] font-medium",
                                      BIOME_COLORS[b] || "text-zinc-500"
                                    )}
                                  >
                                    {b}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Table View ─────────────────────────────────────────────

const TABLE_COLUMNS: { key: TableSortKey; label: string; className: string }[] = [
  { key: "name", label: "Name", className: "flex-[2] min-w-[180px]" },
  { key: "type", label: "Type", className: "w-[90px]" },
  { key: "subcategory", label: "Sub", className: "w-[100px]" },
  { key: "biome", label: "Biome", className: "flex-1 min-w-[120px]" },
  { key: "from", label: "From", className: "w-[130px]" },
  { key: "weight", label: "Wt", className: "w-[50px] text-right" },
  { key: "stack", label: "Stack", className: "w-[50px] text-right" },
];

function tableSortValue(item: ValheimItem, key: TableSortKey): string | number {
  switch (key) {
    case "name": return item.name.toLowerCase();
    case "type": return item.type;
    case "subcategory": return item.subcategory;
    case "biome": {
      const b = item.biomes[0] || "";
      const idx = BIOME_ORDER.indexOf(b as any);
      return idx >= 0 ? idx : BIOME_ORDER.length;
    }
    case "from": return getItemSource(item);
    case "weight": return item.weight;
    case "stack": return item.stack;
  }
}

function ItemTable({
  items,
  tableSortKey,
  tableSortDir,
  onSort,
  onSelect,
}: {
  items: ValheimItem[];
  tableSortKey: TableSortKey;
  tableSortDir: "asc" | "desc";
  onSort: (key: TableSortKey) => void;
  onSelect: (item: ValheimItem) => void;
}) {
  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const va = tableSortValue(a, tableSortKey);
      const vb = tableSortValue(b, tableSortKey);
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return tableSortDir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [items, tableSortKey, tableSortDir]);

  return (
    <div className="rounded-xl border border-zinc-800/50">
      {/* Header */}
      <div className="flex items-center gap-0 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/50 sticky top-0 z-10 rounded-t-xl">
        {/* Icon spacer */}
        <div className="w-[44px] shrink-0" />
        {TABLE_COLUMNS.map((col) => (
          <button
            key={col.key}
            onClick={() => onSort(col.key)}
            className={cn(
              "flex items-center gap-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors select-none",
              col.className,
              tableSortKey === col.key ? "text-brand-400" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {col.label}
            {tableSortKey === col.key ? (
              <ChevronUp className={cn("w-3 h-3 transition-transform", tableSortDir === "desc" && "rotate-180")} />
            ) : (
              <ChevronsUpDown className="w-3 h-3 opacity-40" />
            )}
          </button>
        ))}
      </div>
      {/* Rows */}
      <div>
        {sorted.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelect(item)}
            className="flex items-center gap-0 px-0 py-1.5 border-b border-zinc-800/30 hover:bg-zinc-800/30 cursor-pointer transition-colors group"
          >
            {/* Icon */}
            <div className="w-[44px] shrink-0 flex items-center justify-center">
              <div className="w-7 h-7 rounded bg-zinc-800/60 flex items-center justify-center overflow-hidden">
                <ItemIcon id={item.id} type={item.type} size={28} />
              </div>
            </div>
            {/* Name */}
            <div className={cn("px-2 flex items-center gap-1 text-sm text-zinc-200 group-hover:text-brand-400 transition-colors font-medium", TABLE_COLUMNS[0].className)}>
              <span className="truncate flex-1">{item.name}</span>
              <CopyButton
                item={item}
                size={12}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                title={`Copy "${item.name}"`}
              />
            </div>
            {/* Type */}
            <div className={cn("px-2 text-[11px] text-zinc-500", TABLE_COLUMNS[1].className)}>
              {item.type === "BuildPiece" ? "Build" : item.type}
            </div>
            {/* Subcategory */}
            <div className={cn("px-2 text-[11px] text-zinc-600 truncate", TABLE_COLUMNS[2].className)}>
              {item.subcategory !== item.type ? item.subcategory : ""}
            </div>
            {/* Biome */}
            <div className={cn("px-2 flex flex-wrap gap-1", TABLE_COLUMNS[3].className)}>
              {item.biomes.map((b) => (
                <span key={b} className={cn("text-[10px] font-medium", BIOME_COLORS[b] || "text-zinc-500")}>{b}</span>
              ))}
            </div>
            {/* From */}
            <div className={cn("px-2 text-[11px] text-zinc-500 truncate", TABLE_COLUMNS[4].className)} title={getItemSource(item)}>
              {getItemSource(item) || "—"}
            </div>
            {/* Weight */}
            <div className={cn("px-2 text-[11px] text-zinc-500 tabular-nums", TABLE_COLUMNS[5].className)}>
              {item.weight > 0 ? item.weight : "—"}
            </div>
            {/* Stack */}
            <div className={cn("px-2 text-[11px] text-zinc-500 tabular-nums", TABLE_COLUMNS[6].className)}>
              {item.stack > 1 ? item.stack : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Detail View ────────────────────────────────────────────

function DetailView({ item, onBack }: { item: ValheimItem; onBack: () => void }) {
  const { setSelectedItem, setActiveType, setActiveSubcategory, setActiveBiome, setSelectedStation, setSelectedFactory, setSelectedVendor, cartItems, addToCart, removeFromCart, setOnlyTameable } = useValheimDataStore();
  const character = usePlayerDataStore((s) => s.character);
  const [statsLevel, setStatsLevel] = useState(1);
  const [cartLevel, setCartLevel] = useState(item.maxQuality || 1);
  const usedIn = getUsedIn(item.id);
  const droppedBy = getDroppedBy(item.id);
  const armorSet = getArmorSet(item);
  const vendorSell = getVendorForItem(item.id);
  const vendorBuy = getVendorBuyPrice(item.id);
  const showLevelTabs = hasPerLevelStats(item);
  const relatedItems = getRelatedItems(item);
  const wikiUrl = getWikiUrl(item);

  // Build set of known prefab IDs from player's discoveries
  const knownPrefabs = useMemo(() => {
    if (!character) return new Set<string>();
    const set = new Set<string>();
    for (const token of [...character.known_materials, ...character.known_recipes]) {
      if (itemMap.has(token)) {
        set.add(token);
      } else {
        const resolved = tokenMap.get(token.toLowerCase());
        if (resolved) set.add(resolved.id);
      }
    }
    return set;
  }, [character]);

  const handleNavigate = (id: string) => {
    const target = getItemById(id);
    if (target) {
      setStatsLevel(1);
      setSelectedItem(target);
    }
  };

  const navigateToType = (type: string) => {
    setActiveType(type as ItemType);
    setSelectedItem(null);
  };
  const navigateToSubcategory = (type: string, subcategory: string) => {
    setActiveType(type as ItemType);
    setActiveSubcategory(subcategory);
    setSelectedItem(null);
  };
  const navigateToBiome = (biome: string) => {
    setActiveBiome(biome);
    setSelectedItem(null);
  };
  const navigateToStation = (station: string) => {
    setSelectedItem(null);
    setSelectedStation(station);
  };

  // Filter out "Set" and "Max Quality" from the stat grid — shown elsewhere
  const displayStats = item.stats.filter((s) => s.label !== "Set" && s.label !== "Max Quality");

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300 max-w-5xl mx-auto w-full">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-4 transition-colors w-fit shrink-0"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to list
      </button>

      {/* ── Header Card (static) ── */}
      <div className="glass rounded-xl p-6 border border-zinc-800/50 mb-4 shrink-0">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-xl bg-zinc-800/80 flex items-center justify-center shrink-0 overflow-hidden">
            <ItemIcon id={item.id} type={item.type} size={56} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide leading-none">{item.name}</h1>
              <CopyButton item={item} size={16} title={`Copy "${item.name}"`} />
              <TypeBadge
                type={item.type}
                subcategory={item.subcategory}
                onClick={() => navigateToType(item.type)}
                onSubcategoryClick={() => navigateToSubcategory(item.type, item.subcategory)}
              />
              {item.maxQuality > 1 && (
                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {item.type === "Creature" ? "★ 0–2 Star" : `★ Max Lv ${item.maxQuality}`}
                </span>
              )}
              {item.tameable && (
                <button
                  type="button"
                  title="Filter to all tameable creatures"
                  onClick={() => {
                    setSelectedItem(null);
                    setOnlyTameable(true);
                    setActiveType("Creature");
                  }}
                  className="px-2.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                >
                  Tameable
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{item.id}</p>
            {item.description && (
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{item.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                {item.biomes.map((b) => (
                  <BiomeBadge key={b} biome={b} onClick={() => navigateToBiome(b)} />
                ))}
                {(() => {
                  const extraSources = item.source.filter((s) => !item.biomes.includes(s));
                  return extraSources.length > 0 && (
                    <span className="text-[10px] text-zinc-500">
                      {extraSources.join(" · ")}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {wikiUrl && (
              <a
                href={wikiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Wiki
              </a>
            )}
            {item.recipe.length > 0 && (
              <div className="flex items-center gap-2">
                {!cartItems.some((c) => c.id === item.id) && item.maxQuality > 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Lv</span>
                    <button
                      title="Decrease level"
                      onClick={() => setCartLevel(Math.max(1, cartLevel - 1))}
                      className="w-5 h-5 rounded flex items-center justify-center glass border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-5 text-center text-xs font-mono text-zinc-300">{cartLevel}</span>
                    <button
                      title="Increase level"
                      onClick={() => setCartLevel(Math.min(item.maxQuality, cartLevel + 1))}
                      className="w-5 h-5 rounded flex items-center justify-center glass border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {(() => {
                  const inCart = cartItems.some((c) => c.id === item.id);
                  return inCart ? (
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass border border-zinc-800 text-[11px] text-red-400 hover:text-red-300 hover:border-red-500/30 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => addToCart(item.id, cartLevel)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-500/15 border border-brand-500/30 text-[11px] font-medium text-brand-400 hover:bg-brand-500/25 transition-colors"
                    >
                      <ShoppingCart className="w-3 h-3" />
                      Cart
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable Content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {/* ── Two-Column Layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Column */}
          <div className="space-y-4">
            {/* Crafting Station */}
            {item.station && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Crafting Station</h2>
                <button
                  onClick={() => navigateToStation(item.station!)}
                  className="flex items-center gap-3 w-full hover:bg-zinc-800/30 rounded-lg p-1 -m-1 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center overflow-hidden">
                    <StationIcon station={item.station!} size={32} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-400 hover:underline">{item.station}</p>
                    {item.stationLevel > 0 && (
                      <p className="text-[10px] text-zinc-500">Level {item.stationLevel} required</p>
                    )}
                  </div>
                </button>
              </div>
            )}

            {/* Vendors */}
            {(vendorSell || vendorBuy) && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                  <Store className="w-4 h-4 text-emerald-400" />
                  Vendors
                </h2>
                <div className="space-y-3">
                  {vendorSell && (
                    <div>
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => { setSelectedItem(null); setSelectedVendor(vendorSell.vendor.name); }}
                          className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                        >
                          <VendorIcon name={vendorSell.vendor.name} size={32} />
                          <div>
                            <p className="text-sm font-medium text-brand-400 hover:underline">{vendorSell.vendor.name}</p>
                            <p className="text-[10px] text-zinc-500">{vendorSell.vendor.location}</p>
                          </div>
                        </button>
                        <BiomeBadge biome={vendorSell.vendor.biome} onClick={() => navigateToBiome(vendorSell.vendor.biome)} />
                      </div>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-800/30">
                        <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-xs text-zinc-300">
                          Buy for {vendorSell.entry.price > 0
                            ? `${vendorSell.entry.price} ${vendorSell.entry.currency}`
                            : vendorSell.entry.currency}
                        </span>
                      </div>
                      {vendorSell.entry.requirement && (
                        <div className="flex items-center gap-2 mt-1">
                          <Lock className="w-3.5 h-3.5 text-red-400" />
                          <span className="text-[11px] text-red-400/80">{vendorSell.entry.requirement}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {vendorBuy && (
                    <div className={vendorSell ? "pt-3 border-t border-zinc-800/30" : ""}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs text-zinc-300">Sell to {vendorBuy.vendor.name}</span>
                        </div>
                        <span className="text-sm font-bold text-amber-400">{vendorBuy.sellPrice} Coins</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Creature Info (wiki-style Details table) */}
            {item.type === "Creature" && (item.faction || item.biomes.length > 0 || item.tameable !== undefined) && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Details</h2>
                <div className="space-y-0">
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                    <span className="text-xs text-zinc-500">Internal ID</span>
                    <span className="text-xs text-zinc-200 font-mono">{item.id}</span>
                  </div>
                  {item.faction && (
                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                      <span className="text-xs text-zinc-500">Faction</span>
                      <DetailChip
                        label={item.faction}
                        tone="purple"
                        title={`Filter to all ${item.faction} creatures`}
                        onClick={() => {
                          setSelectedItem(null);
                          useValheimDataStore.setState({ activeFactions: [item.faction!], activeTypes: ["Creature"] });
                        }}
                      />
                    </div>
                  )}
                  {item.biomes.length > 0 && (
                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                      <span className="text-xs text-zinc-500">Main biome</span>
                      <BiomeBadge biome={item.biomes[0]} onClick={() => navigateToBiome(item.biomes[0])} />
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                    <span className="text-xs text-zinc-500">Tameable</span>
                    {item.tameable ? (
                      <DetailChip
                        label="Yes"
                        tone="emerald"
                        title="Filter to all tameable creatures"
                        onClick={() => { setSelectedItem(null); setOnlyTameable(true); setActiveType("Creature"); }}
                      />
                    ) : (
                      <DetailChip label="No" tone="zinc" />
                    )}
                  </div>
                  {item.subcategory === "Boss" && (
                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                      <span className="text-xs text-zinc-500">Boss</span>
                      <DetailChip label="Yes" tone="amber" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Stats with level tabs */}
            {displayStats.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-zinc-200">Stats</h2>
                  {showLevelTabs && (
                    <div className="flex gap-1">
                      {Array.from({ length: item.maxQuality }, (_, i) => i + 1).map((lv) => {
                        const isCreature = item.type === "Creature";
                        const label = isCreature
                          ? lv === 1 ? "0★ Base" : lv === 2 ? "1★" : "2★"
                          : `Lv ${lv}`;
                        return (
                          <button
                            key={lv}
                            onClick={() => setStatsLevel(lv)}
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                              statsLevel === lv
                                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                                : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="space-y-0">
                  {displayStats.map((stat, i) => {
                    // Attack Types row ("Swing attack Types", value "Blunt 60, Slash 30") →
                    // render each damage type as a badge that links to Deals Damage filter.
                    const isTypesRow = item.type === "Creature" && /\bTypes$/.test(stat.label);
                    if (isTypesRow) {
                      const parts = stat.value.split(",").map((s) => s.trim()).filter(Boolean);
                      return (
                        <div key={i} className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-800/30 last:border-0">
                          <span className="text-xs text-zinc-500 pt-0.5">{stat.label}</span>
                          <div className="flex flex-wrap gap-1 justify-end">
                            {parts.map((p, j) => {
                              const m = p.match(/^([A-Za-z]+)\s+(\d+(?:\.\d+)?)$/);
                              if (!m) return <DetailChip key={j} label={p} tone="zinc" />;
                              const [, dmgName, dmgValue] = m;
                              return (
                                <DetailChip
                                  key={j}
                                  label={`${dmgName} ${dmgValue}`}
                                  tone="red"
                                  title={`Filter to creatures that deal ${dmgName}`}
                                  onClick={() => {
                                    setSelectedItem(null);
                                    useValheimDataStore.setState({
                                      activeDealsDamage: [dmgName],
                                      activeTypes: ["Creature"],
                                    });
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-zinc-800/30 last:border-0">
                        <span className="text-xs text-zinc-500">{stat.label}</span>
                        <span className="text-xs text-zinc-200 font-medium">
                          {showLevelTabs ? statAtLevel(stat.value, statsLevel) : stat.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Resistances (creatures) */}
            {item.type === "Creature" && (item.immuneTo?.length || item.resistantTo?.length || item.weakTo?.length || item.neutralTo?.length || item.staggerLimit) && (() => {
              // Applies the Weak-To filter to a given damage type and returns to the list.
              const filterWeakTo = (dmg: string) => {
                setSelectedItem(null);
                useValheimDataStore.setState({
                  activeWeakTo: [dmg],
                  activeTypes: ["Creature"],
                });
              };
              return (
                <div className="glass rounded-xl p-5 border border-zinc-800/50">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-3">Resistances</h2>
                  <div className="space-y-0">
                    {item.immuneTo && item.immuneTo.length > 0 && (
                      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-800/30">
                        <span className="text-xs text-zinc-500 shrink-0 pt-0.5">Immune to</span>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {item.immuneTo.map((d) => (
                            <DetailChip key={d} label={d} tone="red" />
                          ))}
                        </div>
                      </div>
                    )}
                    {item.resistantTo && item.resistantTo.length > 0 && (
                      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-800/30">
                        <span className="text-xs text-zinc-500 shrink-0 pt-0.5">Resistant to</span>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {item.resistantTo.map((d) => (
                            <DetailChip key={d} label={d} tone="orange" />
                          ))}
                        </div>
                      </div>
                    )}
                    {item.weakTo && item.weakTo.length > 0 && (
                      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-800/30">
                        <span className="text-xs text-zinc-500 shrink-0 pt-0.5">Weak to</span>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {item.weakTo.map((d) => (
                            <DetailChip
                              key={d}
                              label={d}
                              tone="emerald"
                              title={`Filter to creatures weak to ${d}`}
                              onClick={() => filterWeakTo(d)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {item.neutralTo && item.neutralTo.length > 0 && (
                      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-800/30">
                        <span className="text-xs text-zinc-500 shrink-0 pt-0.5">Neutral to</span>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {item.neutralTo.map((d) => (
                            <DetailChip key={d} label={d} tone="zinc" />
                          ))}
                        </div>
                      </div>
                    )}
                    {item.staggerLimit && (
                      <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30 last:border-0">
                        <span className="text-xs text-zinc-500">Stagger limit</span>
                        <DetailChip label={item.staggerLimit} tone="zinc" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Armor Set */}
            {armorSet && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                  {armorSet.setName} <span className="text-zinc-500 font-normal">({armorSet.setSize}pc set)</span>
                </h2>
                <div className="space-y-1">
                  {armorSet.pieces.map((piece) => (
                    <button
                      key={piece.id}
                      onClick={() => handleNavigate(piece.id)}
                      className={cn(
                        "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg transition-colors text-left",
                        piece.id === item.id
                          ? "bg-brand-500/10 border border-brand-500/20"
                          : "hover:bg-zinc-800/50"
                      )}
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={piece.id} type={piece.type} size={24} />
                      </div>
                      <span className={cn(
                        "text-xs flex-1",
                        piece.id === item.id ? "text-brand-400 font-semibold" : "text-brand-400 hover:underline"
                      )}>
                        {piece.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Properties */}
            {(item.weight > 0 || item.stack > 1 || item.value > 0) && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Properties</h2>
                <div className="space-y-0">
                  {item.weight > 0 && (
                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                      <span className="text-xs text-zinc-500">Weight</span>
                      <span className="text-xs text-zinc-200 font-medium">{item.weight}</span>
                    </div>
                  )}
                  {item.stack > 1 && (
                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                      <span className="text-xs text-zinc-500">Stack</span>
                      <span className="text-xs text-zinc-200 font-medium">{item.stack}</span>
                    </div>
                  )}
                  {item.value > 0 && (
                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/30">
                      <span className="text-xs text-zinc-500">Value</span>
                      <span className="text-xs text-amber-400 font-medium">{item.value}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Drops + Tames With moved to right column for creatures */}

            {/* Dropped By / World Sources */}
            {(item.worldSources?.length > 0 || droppedBy.length > 0) && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                  Dropped By ({(item.worldSources?.length || 0) + droppedBy.length})
                </h2>
                <div className="grid grid-cols-1 gap-1">
                  {/* World sources (trees, rocks, destructibles) */}
                  {item.worldSources?.map((ws) => (
                    <div
                      key={ws.source}
                      className="px-3 py-2 rounded-lg"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                          {ws.type === "Tree" ? <TreePine className="w-4 h-4 text-green-400" /> :
                           ws.type === "Rock" ? <Pickaxe className="w-4 h-4 text-stone-400" /> :
                           ws.type === "Pickup" ? <Hand className="w-4 h-4 text-sky-400" /> :
                           ws.type === "Crafting" ? <Hammer className="w-4 h-4 text-amber-400" /> :
                           ws.type === "Chest" ? <Archive className="w-4 h-4 text-yellow-400" /> :
                           ws.type === "Spawner" ? <Skull className="w-4 h-4 text-red-400" /> :
                           <Boxes className="w-4 h-4 text-orange-400" />}
                        </div>
                        <span className="text-xs text-zinc-200">
                          {ws.source}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1.5 ml-[34px]">
                        {ws.biomes.map((b) => (
                          <BiomeBadge key={b} biome={b} onClick={() => navigateToBiome(b)} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* Separator between world sources and creatures */}
                  {item.worldSources?.length > 0 && droppedBy.length > 0 && (
                    <div className="border-t border-zinc-800/30 my-1" />
                  )}
                  {/* Creature drops */}
                  {droppedBy.map((creature) => (
                    <button
                      key={creature.id}
                      onClick={() => handleNavigate(creature.id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={creature.id} type={creature.type} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline truncate flex-1">
                        {creature.name}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">{creature.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Tames With (tameable creatures) — shown first in right col so it's visible above the fold */}
            {item.tameFoods && item.tameFoods.length > 0 && (
              <div className="glass rounded-xl p-5 border border-emerald-500/20 bg-emerald-500/[0.02]">
                <h2 className="text-sm font-semibold text-emerald-400 mb-1 flex items-center gap-2">
                  Tames With
                  <span className="text-[10px] font-normal text-zinc-500">
                    ({item.tameFoods.length} {item.tameFoods.length === 1 ? "food" : "foods"})
                  </span>
                </h2>
                <p className="text-[10px] text-zinc-500 mb-3">
                  Drop one of these within 1m. Avoid scaring the creature — red "!" resets progress.
                </p>
                <div className="space-y-1">
                  {item.tameFoods.map((foodId) => {
                    const food = getItemById(foodId);
                    if (!food) return null;
                    return (
                      <button
                        key={foodId}
                        onClick={() => handleNavigate(foodId)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                      >
                        <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                          <ItemIcon id={foodId} type={food.type} size={24} />
                        </div>
                        <span className="text-xs text-brand-400 hover:underline flex-1">{food.name}</span>
                        {food.biomes?.[0] && (
                          <BiomeBadge biome={food.biomes[0]} onClick={() => navigateToBiome(food.biomes[0])} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Drops (creatures) */}
            {item.drops.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Drops</h2>
                <div className="space-y-1">
                  {item.drops.map((drop) => (
                    <button
                      key={drop.id}
                      onClick={() => handleNavigate(drop.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={drop.id} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline flex-1">{drop.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-zinc-500">
                          {drop.min === drop.max ? `x${drop.min}` : `x${drop.min}-${drop.max}`}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono w-12 text-right">
                          {Math.round(drop.chance * 100)}%
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Processed In (processing station / factory) */}
            {(() => {
              const ps = getProcessingStationForOutput(item.id);
              if (!ps) return null;
              return (
                <div className="glass rounded-xl p-5 border border-zinc-800/50">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                    <Factory className="w-4 h-4 text-orange-400" />
                    Processed In
                  </h2>
                  <button
                    onClick={() => { setSelectedItem(null); setSelectedFactory(ps.station.name); }}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded bg-orange-500/10 flex items-center justify-center shrink-0 overflow-hidden">
                      <img src={`/icons/${ps.station.prefab}.png`} alt="" className="w-7 h-7 object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-brand-400 hover:underline font-medium">{ps.station.name}</span>
                      <span className="text-[10px] text-zinc-500 block">{ps.station.biome}</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 mt-2 px-3 pt-2 border-t border-zinc-800/30">
                    <button onClick={() => handleNavigate(ps.conversion.inputId)} className="flex items-center gap-1.5">
                      <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                        <ItemIcon id={ps.conversion.inputId} size={20} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline">{ps.conversion.inputName}</span>
                      {(ps.conversion.inputAmount ?? 1) > 1 && (
                        <span className="text-[10px] text-zinc-500 font-mono">x{ps.conversion.inputAmount}</span>
                      )}
                    </button>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <span className="text-xs text-zinc-200 font-medium">{item.name}</span>
                  </div>
                </div>
              );
            })()}

            {/* Recipe */}
            {item.recipe.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                  Recipe
                  {item.station && (
                    <button
                      onClick={() => navigateToStation(item.station!)}
                      className="text-[10px] text-zinc-500 font-normal ml-2 hover:text-brand-400 transition-colors"
                    >
                      at {item.station}{item.stationLevel > 0 ? ` Lv ${item.stationLevel}` : ""}
                    </button>
                  )}
                </h2>
                <div className="space-y-1">
                  {item.recipe.map((ing) => (
                    <button
                      key={ing.id}
                      onClick={() => handleNavigate(ing.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={ing.id} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline flex-1">{ing.name}</span>
                      {knownPrefabs.size > 0 && (
                        knownPrefabs.has(ing.id)
                          ? <Eye className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                          : <EyeOff className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      )}
                      <span className="text-xs text-zinc-400 font-mono">x{ing.amount}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Upgrade Costs */}
            {item.upgradeCosts.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Upgrade Costs</h2>
                <div className="space-y-3">
                  {item.upgradeCosts.map((uc) => (
                    <div key={uc.level}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-zinc-300">Level {uc.level}</span>
                        {uc.stationLevel > 0 && (
                          <span className="text-[10px] text-zinc-600">
                            {item.station} Lv {uc.stationLevel}
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5 pl-3 border-l-2 border-zinc-800">
                        {uc.resources.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => handleNavigate(r.id)}
                            className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                              <ItemIcon id={r.id} size={20} />
                            </div>
                            <span className="text-[11px] text-brand-400 hover:underline flex-1">{r.name}</span>
                            {knownPrefabs.size > 0 && (
                              knownPrefabs.has(r.id)
                                ? <Eye className="w-3 h-3 text-brand-400 shrink-0" />
                                : <EyeOff className="w-3 h-3 text-zinc-600 shrink-0" />
                            )}
                            <span className="text-[11px] text-zinc-500 font-mono">x{r.amount}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total Costs (recipe + all upgrades combined) */}
            {item.recipe.length > 0 && item.upgradeCosts.length > 0 && (() => {
              const totals = new Map<string, { id: string; name: string; amount: number }>();
              for (const ing of item.recipe) {
                const prev = totals.get(ing.id);
                totals.set(ing.id, { id: ing.id, name: ing.name, amount: (prev?.amount || 0) + ing.amount });
              }
              for (const uc of item.upgradeCosts) {
                for (const r of uc.resources) {
                  const prev = totals.get(r.id);
                  totals.set(r.id, { id: r.id, name: r.name, amount: (prev?.amount || 0) + r.amount });
                }
              }
              const entries = [...totals.values()];
              return (
                <div className="glass rounded-xl p-5 border border-zinc-800/50">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                    Total Costs
                    <span className="text-[10px] text-zinc-500 font-normal ml-2">Lv 1 → {item.upgradeCosts.length + 1}</span>
                  </h2>
                  <div className="space-y-1">
                    {entries.map((mat) => (
                      <button
                        key={mat.id}
                        onClick={() => handleNavigate(mat.id)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                      >
                        <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                          <ItemIcon id={mat.id} size={24} />
                        </div>
                        <span className="text-xs text-brand-400 hover:underline flex-1">{mat.name}</span>
                        {knownPrefabs.size > 0 && (
                          knownPrefabs.has(mat.id)
                            ? <Eye className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                            : <EyeOff className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                        )}
                        <span className="text-xs text-zinc-400 font-mono">x{mat.amount}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Related Items (wiki group) */}
            {relatedItems.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-zinc-200">
                    Related ({relatedItems.length})
                  </h2>
                  {item.wikiGroup && (
                    <span className="text-[10px] text-zinc-500">{item.wikiGroup}</span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {relatedItems.map((related) => (
                    <button
                      key={related.id}
                      onClick={() => handleNavigate(related.id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={related.id} type={related.type} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline truncate flex-1">
                        {related.name}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">{related.subcategory}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Used In */}
            {usedIn.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                  Used In ({usedIn.length})
                </h2>
                <div className="grid grid-cols-1 gap-1">
                  {usedIn.map((recipe) => (
                    <button
                      key={recipe.id}
                      onClick={() => handleNavigate(recipe.id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={recipe.id} type={recipe.type} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline truncate flex-1">
                        {recipe.name}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">{recipe.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Station Materials View ─────────────────────────────────
function StationMaterialsView({ materials, stations, mode, onItemClick }: {
  materials: { id: string; name: string; amount: number }[];
  stations: string[];
  mode: "craft" | "build";
  onItemClick: (item: ValheimItem) => void;
}) {
  const totalCraftable = useMemo(() => {
    let count = 0;
    for (const s of stations) {
      for (const item of getStationItems(s)) {
        if (mode === "craft" && item.type !== "BuildPiece") count++;
        if (mode === "build" && item.type === "BuildPiece") count++;
      }
    }
    return count;
  }, [stations, mode]);
  const modeLabel = mode === "craft" ? "Crafting Materials" : "Building Materials";
  const modeDesc = mode === "craft" ? "craft" : "build";

  return (
    <div className="space-y-3">
      {/* Summary header */}
      <div className="glass rounded-xl p-4 border border-amber-500/20">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">
              {modeLabel}
              <span className="text-zinc-500 font-normal ml-2">
                ({materials.length} unique)
              </span>
            </h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              All ingredients needed to {modeDesc} {totalCraftable} items at{" "}
              {stations.join(", ")}
            </p>
          </div>
        </div>
      </div>

      {/* Materials list */}
      <div className="glass rounded-xl border border-zinc-800/50 overflow-hidden">
        <div className="divide-y divide-zinc-800/30">
          {materials.map((mat) => {
            const matItem = getItemById(mat.id);
            const biome = matItem?.biomes[0];
            return (
              <div
                key={mat.id}
                onClick={() => matItem && onItemClick(matItem)}
                className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-800/20 transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 shrink-0">
                  <ItemIcon id={mat.id} size={24} />
                </div>
                <span className="text-sm text-brand-400 hover:underline flex-1 truncate">
                  {mat.name}
                </span>
                {biome && (
                  <span className={cn("text-[10px] font-medium shrink-0", BIOME_COLORS[biome] || "text-zinc-400")}>
                    {biome}
                  </span>
                )}
                <span className="text-sm text-zinc-400 font-mono shrink-0 w-16 text-right">
                  x{mat.amount.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Station Detail View ────────────────────────────────────

function StationDetailView({ station, onBack }: { station: string; onBack: () => void }) {
  const { setSelectedItem, setSelectedStation } = useValheimDataStore();
  const itemsByLevel = getStationItemsByLevel(station);
  const allItems = getStationItems(station);
  const upgrades = getStationUpgrades(station);
  const levels = [...itemsByLevel.keys()].sort((a, b) => a - b);
  const maxLevel = upgrades.length > 0 ? upgrades.length + 1 : levels.length;

  // Find the station's own build piece item (for its recipe)
  const stationPrefab = STATION_ICONS[station];
  const stationItem = stationPrefab ? getItemById(stationPrefab) : undefined;
  // Also try matching by name if prefab lookup fails
  const stationBuildPiece = stationItem || VALHEIM_ITEMS.find((i) => i.name === station && i.type === "BuildPiece");

  const handleNavigate = (id: string) => {
    const target = getItemById(id);
    if (target) {
      setSelectedStation(null);
      setSelectedItem(target);
    }
  };

  // Group items by type within each level
  const typeOrder = ["Weapon", "Armor", "Tool", "Food", "Potion", "Ammo", "Material", "Misc"];

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300 max-w-5xl mx-auto w-full">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-4 transition-colors w-fit"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to list
      </button>

      {/* Header — pinned above scroll */}
      <div className="glass rounded-xl p-6 border border-zinc-800/50 mb-4 shrink-0">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 overflow-hidden">
            <StationIcon station={station} size={48} />
          </div>
          <div>
            <h1 className="font-norse font-bold text-3xl text-zinc-100 tracking-wide">{station}</h1>
            <CopyTextButton text={station} />
            <p className="text-sm text-zinc-400 mt-1">
              {allItems.length} item{allItems.length !== 1 ? "s" : ""} craftable
              {maxLevel > 1 && <> · Max level {maxLevel}</>}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {/* Build Recipe + Station Upgrades — 2 column layout */}
        {(stationBuildPiece?.recipe.length || upgrades.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {stationBuildPiece && stationBuildPiece.recipe.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Build Recipe</h2>
                <div className="space-y-1">
                  {stationBuildPiece.recipe.map((ing) => (
                    <button
                      key={ing.id}
                      onClick={() => handleNavigate(ing.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={ing.id} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline flex-1">{ing.name}</span>
                      <span className="text-xs text-zinc-400 font-mono">x{ing.amount}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {upgrades.length > 0 && (
              <div className="glass rounded-xl p-5 border border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                  Station Upgrades
                  <span className="text-zinc-500 font-normal ml-2 text-xs">
                    Lv 1 → Lv {maxLevel}
                  </span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {upgrades.map((item, i) => (
                    <button
                      key={item.id}
                      onClick={() => handleNavigate(item.id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/20 shrink-0">
                        Lv {i + 2}
                      </span>
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={item.id} type={item.type} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline truncate flex-1">
                        {item.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Items by level */}
        {levels.map((level) => {
          const levelItems = itemsByLevel.get(level) || [];
          // Group by type
          const grouped: Record<string, ValheimItem[]> = {};
          for (const item of levelItems) {
            const t = item.type;
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(item);
          }
          const sortedTypes = typeOrder.filter((t) => grouped[t]);

          return (
            <div key={level} className="glass rounded-xl p-5 border border-zinc-800/50">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/20">
                  Lv {level}
                </span>
                <span className="text-zinc-500 font-normal text-xs">{levelItems.length} items</span>
              </h2>
              <div className="space-y-3">
                {sortedTypes.map((type) => (
                  <div key={type}>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">{type}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {grouped[type].sort((a, b) => a.name.localeCompare(b.name)).map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleNavigate(item.id)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                        >
                          <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                            <ItemIcon id={item.id} type={item.type} size={24} />
                          </div>
                          <span className="text-xs text-brand-400 hover:underline truncate flex-1">
                            {item.name}
                          </span>
                          <div className="flex gap-1">
                            {item.biomes.slice(0, 2).map((b) => (
                              <span key={b} className={cn("text-[9px]", BIOME_COLORS[b] || "text-zinc-500")}>
                                {b}
                              </span>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Processing Station (Factory) Detail View ────────────────

function ProcessingStationDetailView({ stationName, onBack }: { stationName: string; onBack: () => void }) {
  const { setSelectedItem, setSelectedFactory } = useValheimDataStore();
  const station = PROCESSING_STATIONS[stationName];
  if (!station) return null;

  // Get the build piece for this station
  const buildPiece = getItemById(station.prefab);

  const handleNavigate = (id: string) => {
    const target = getItemById(id);
    if (target) {
      setSelectedFactory(null);
      setSelectedItem(target);
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300 max-w-5xl mx-auto w-full">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-4 transition-colors w-fit"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to list
      </button>

      {/* Header */}
      <div className="glass rounded-xl p-6 border border-zinc-800/50 mb-4 shrink-0">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0 overflow-hidden">
            <img src={`/icons/${station.prefab}.png`} alt={station.name} className="w-12 h-12 object-contain" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-norse font-bold text-3xl text-zinc-100 tracking-wide">{station.name}</h1>
              <CopyTextButton text={station.name} />
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                Factory
              </span>
              <BiomeBadge biome={station.biome} />
            </div>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{station.description}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2">
              {buildPiece?.station && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Requires:</span>
                  <span className="text-xs text-zinc-300">{buildPiece.station}</span>
                </div>
              )}
              {station.fuel && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Fuel:</span>
                  <button onClick={() => station.fuelId && handleNavigate(station.fuelId)} className="flex items-center gap-1.5 hover:text-brand-400 transition-colors">
                    {station.fuelId && (
                      <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                        <ItemIcon id={station.fuelId} size={20} />
                      </div>
                    )}
                    <span className="text-xs text-brand-400 hover:underline">{station.fuel}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {/* Build Recipe */}
        {buildPiece && buildPiece.recipe.length > 0 && (
          <div className="glass rounded-xl p-5 border border-zinc-800/50">
            <h2 className="text-sm font-semibold text-zinc-200 mb-3">
              Build Recipe
              {buildPiece.station && (
                <span className="text-[10px] text-zinc-500 font-normal ml-2">
                  at {buildPiece.station}
                </span>
              )}
            </h2>
            <div className="space-y-1">
              {buildPiece.recipe.map((ing) => (
                <button
                  key={ing.id}
                  onClick={() => handleNavigate(ing.id)}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                >
                  <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                    <ItemIcon id={ing.id} size={24} />
                  </div>
                  <span className="text-xs text-brand-400 hover:underline flex-1">{ing.name}</span>
                  <span className="text-xs text-zinc-400 font-mono">x{ing.amount}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversions / Accepts Ammo */}
        {station.conversions.length > 0 && (() => {
          const isConsumerOnly = station.conversions.every((c) => c.inputId === c.outputId);
          return (
            <div className="glass rounded-xl p-5 border border-zinc-800/50">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                {isConsumerOnly ? "Accepts Ammo" : "Conversions"}
                <span className="text-zinc-500 font-normal ml-2 text-xs">
                  {station.conversions.length} {isConsumerOnly ? "type" : "recipe"}{station.conversions.length !== 1 ? "s" : ""}
                </span>
              </h2>
              <div className="space-y-1">
                {station.conversions.map((conv) => (
                  <div key={`${conv.inputId}-${conv.outputId}`} className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-zinc-800/30 transition-colors">
                    {/* Input */}
                    <button
                      onClick={() => handleNavigate(conv.inputId)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <div className="w-7 h-7 rounded bg-zinc-800/60 flex items-center justify-center shrink-0 overflow-hidden">
                        <ItemIcon id={conv.inputId} size={28} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs text-brand-400 hover:underline block truncate">{conv.inputName}</span>
                        {(conv.inputAmount ?? 1) > 1 && (
                          <span className="text-[10px] text-zinc-500 font-mono">x{conv.inputAmount}</span>
                        )}
                      </div>
                    </button>

                    {/* Arrow + Output (only for real conversions) */}
                    {conv.inputId !== conv.outputId && (
                      <>
                        <ArrowRight className="w-4 h-4 text-zinc-600 shrink-0" />
                        <button
                          onClick={() => handleNavigate(conv.outputId)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <div className="w-7 h-7 rounded bg-zinc-800/60 flex items-center justify-center shrink-0 overflow-hidden">
                            <ItemIcon id={conv.outputId} size={28} />
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs text-brand-400 hover:underline block truncate">{conv.outputName}</span>
                            {(conv.outputAmount ?? 1) > 1 && (
                              <span className="text-[10px] text-zinc-500 font-mono">x{conv.outputAmount}</span>
                            )}
                          </div>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Vendor Detail View ─────────────────────────────────────

function VendorDetailView({ vendorName, onBack }: { vendorName: string; onBack: () => void }) {
  const { setSelectedItem, setSelectedVendor } = useValheimDataStore();
  const vendor = VENDORS[vendorName];

  const handleNavigate = (id: string) => {
    const target = getItemById(id);
    if (target) {
      setSelectedVendor(null);
      setSelectedItem(target);
    }
  };

  if (!vendor) return null;

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300 max-w-5xl mx-auto w-full">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-4 transition-colors w-fit"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to list
      </button>

      {/* Header — pinned above scroll */}
      <div className="glass rounded-xl p-6 border border-zinc-800/50 mb-4 shrink-0">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 overflow-hidden">
            <VendorIcon name={vendor.name} size={56} className="rounded-xl" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-norse font-bold text-3xl text-zinc-100 tracking-wide">{vendor.name}</h1>
              <CopyTextButton text={vendor.name} />
              <BiomeBadge biome={vendor.biome} />
            </div>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{vendor.description}</p>
            <p className="text-[10px] text-zinc-500 mt-2">{vendor.location}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sells */}
          {vendor.sells.length > 0 && (
            <div className="glass rounded-xl p-5 border border-zinc-800/50">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-400" />
                Sells ({vendor.sells.length})
              </h2>
              <div className="space-y-1">
                {vendor.sells.map((entry) => {
                  const item = getItemById(entry.id);
                  return (
                    <button
                      key={entry.id}
                      onClick={() => handleNavigate(entry.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={entry.id} type={item?.type} size={24} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-brand-400 hover:underline truncate block">
                          {item?.name || entry.id}
                        </span>
                        {entry.requirement && (
                          <span className="flex items-center gap-1 mt-0.5">
                            <Lock className="w-2.5 h-2.5 text-red-400" />
                            <span className="text-[9px] text-red-400/70">{entry.requirement}</span>
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-amber-400 font-medium shrink-0">
                        {entry.price > 0 ? `${entry.price} coins` : entry.currency}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Buys */}
          {vendor.buys.length > 0 && (
            <div className="glass rounded-xl p-5 border border-zinc-800/50">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-amber-400" />
                Buys ({vendor.buys.length})
              </h2>
              <div className="space-y-1">
                {vendor.buys.map((entry) => {
                  const item = getItemById(entry.id);
                  return (
                    <button
                      key={entry.id}
                      onClick={() => handleNavigate(entry.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <ItemIcon id={entry.id} type={item?.type} size={24} />
                      </div>
                      <span className="text-xs text-brand-400 hover:underline flex-1">
                        {item?.name || entry.id}
                      </span>
                      <span className="text-[10px] text-amber-400 font-medium">
                        {entry.sellPrice} coins
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* No buys message */}
          {vendor.buys.length === 0 && vendor.sells.length > 0 && (
            <div className="glass rounded-xl p-5 border border-zinc-800/50 flex items-center justify-center">
              <p className="text-xs text-zinc-500">This vendor does not buy items</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cart Panel ─────────────────────────────────────────────

// ── Export Helpers ──────────────────────────────────────────

function exportItem(item: ValheimItem) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    subcategory: item.subcategory,
    description: item.description,
    biomes: item.biomes,
    source: item.source,
    station: item.station || "",
    stationLevel: item.stationLevel,
    maxQuality: item.maxQuality,
    stack: item.stack,
    weight: item.weight,
    value: item.value,
    recipe: item.recipe.map((r) => `${r.name} x${r.amount}`).join(", "),
    stats: item.stats.map((s) => `${s.label}: ${s.value}`).join(", "),
    wikiUrl: item.wikiUrl,
  };
}

const CSV_COLUMNS = [
  "id", "name", "type", "subcategory", "description", "biomes", "source",
  "station", "stationLevel", "maxQuality", "stack", "weight", "value",
  "recipe", "stats", "wikiUrl",
] as const;

function csvEscape(val: unknown): string {
  const s = Array.isArray(val) ? val.join("; ") : String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportCsv(items: ValheimItem[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = items.map((item) => {
    const flat = exportItem(item);
    return CSV_COLUMNS.map((col) => csvEscape(flat[col])).join(",");
  });
  return [header, ...rows].join("\n");
}

function exportTxt(items: ValheimItem[]): string {
  const lines: string[] = [];
  lines.push(`Valheim Data Export — ${items.length} items`);
  lines.push("=".repeat(60));
  lines.push("");

  let currentType = "";
  for (const item of items) {
    if (item.type !== currentType) {
      currentType = item.type;
      lines.push("");
      lines.push(`── ${TYPE_GROUP_LABELS[currentType as ItemType] || `${currentType}s`} ──`);
      lines.push("");
    }
    lines.push(`${item.name} (${item.id})`);
    lines.push(`  Type: ${item.type}${item.subcategory ? ` / ${item.subcategory}` : ""}`);
    if (item.biomes.length > 0) lines.push(`  Biomes: ${item.biomes.join(", ")}`);
    if (item.station) lines.push(`  Station: ${item.station}${item.stationLevel > 1 ? ` (lvl ${item.stationLevel})` : ""}`);
    if (item.recipe.length > 0) lines.push(`  Recipe: ${item.recipe.map((r) => `${r.name} x${r.amount}`).join(", ")}`);
    if (item.stats.length > 0) lines.push(`  Stats: ${item.stats.map((s) => `${s.label}: ${s.value}`).join(", ")}`);
    if (item.wikiUrl) lines.push(`  Wiki: ${item.wikiUrl}`);
    lines.push("");
  }
  return lines.join("\n");
}
