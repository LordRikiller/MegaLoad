// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";
import {
  User,
  Skull,
  Hammer,
  Wrench,
  Swords,
  Shield,
  ChevronDown,
  Search,
  Eye,
  EyeOff,
  Crown,
  Heart,
  Zap,
  Flame,
  MapPin,
  Trophy,
  Package,
  Utensils,
  Target,
  Loader2,
  AlertCircle,
  Sparkles,
  TreePine,
  Crosshair,
} from "lucide-react";
import { cn } from "../lib/utils";
import { usePlayerDataStore } from "../stores/playerDataStore";
import { useValheimDataStore } from "../stores/valheimDataStore";
import {
  VALHEIM_ITEMS,
  itemMap,
  tokenMap,
  type ValheimItem,
} from "../data/valheim-items";
import type { InventoryItem, SkillData } from "../lib/tauri-api";
import { startPlayerDataWatcher, stopPlayerDataWatcher } from "../lib/tauri-api";

// ── Guardian power display names ───────────────────────────
const GUARDIAN_NAMES: Record<string, string> = {
  GP_Eikthyr: "Eikthyr",
  GP_TheElder: "The Elder",
  GP_Bonemass: "Bonemass",
  GP_Moder: "Moder",
  GP_Yagluth: "Yagluth",
  GP_Queen: "The Queen",
  GP_Fader: "Fader",
};

// ── Equipment slot definitions ─────────────────────────────
const EQUIP_SLOTS = [
  { key: "helmet", label: "Head", types: ["Armor"], subcats: ["Helmet"] },
  { key: "chest", label: "Chest", types: ["Armor"], subcats: ["Chest"] },
  { key: "legs", label: "Legs", types: ["Armor"], subcats: ["Legs"] },
  { key: "cape", label: "Cape", types: ["Armor"], subcats: ["Cape", "Shoulder"] },
  { key: "utility", label: "Utility", types: ["Armor", "Tool"], subcats: ["Utility"] },
  { key: "weapon", label: "Weapon", types: ["Weapon"], subcats: [] },
  { key: "shield", label: "Shield", types: ["Armor"], subcats: ["Shield"] },
  { key: "ammo", label: "Ammo", types: ["Ammo"], subcats: [] },
];

// ── Skill icon colors ──────────────────────────────────────
const SKILL_COLORS: Record<string, string> = {
  Swords: "text-red-400",
  Knives: "text-rose-300",
  Clubs: "text-orange-400",
  Polearms: "text-amber-400",
  Spears: "text-yellow-400",
  Blocking: "text-blue-400",
  Axes: "text-emerald-400",
  Bows: "text-lime-400",
  "Elemental Magic": "text-cyan-400",
  "Blood Magic": "text-red-500",
  Unarmed: "text-zinc-300",
  Pickaxes: "text-stone-400",
  "Wood Cutting": "text-green-500",
  Crossbows: "text-violet-400",
  Jump: "text-sky-400",
  Sneak: "text-purple-400",
  Run: "text-teal-400",
  Swim: "text-blue-300",
  Fishing: "text-cyan-300",
  Ride: "text-amber-300",
};

// ── Item Lookup Helpers ────────────────────────────────────
function getItem(prefabId: string): ValheimItem | undefined {
  return itemMap.get(prefabId);
}

function getItemName(prefabId: string): string {
  return itemMap.get(prefabId)?.name ?? prefabId;
}

// ── Biome badge colors ─────────────────────────────────────
const BIOME_COLORS: Record<string, string> = {
  Meadows: "bg-lime-500/20 text-lime-400",
  "Black Forest": "bg-teal-500/20 text-teal-400",
  Swamp: "bg-green-600/20 text-green-400",
  Mountain: "bg-slate-400/20 text-slate-300",
  Plains: "bg-yellow-500/20 text-yellow-400",
  Ocean: "bg-blue-500/20 text-blue-400",
  Mistlands: "bg-purple-500/20 text-purple-400",
  Ashlands: "bg-red-500/20 text-red-400",
  "Deep North": "bg-cyan-500/20 text-cyan-300",
};

// ── Item Icon Component ────────────────────────────────────
function ItemIcon({ id, size = 32, className = "" }: { id: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Package className={cn("text-zinc-500", className)} style={{ width: size * 0.6, height: size * 0.6 }} />;
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

// ── Main Page ──────────────────────────────────────────────
export function PlayerData() {
  const navigate = useNavigate();
  const setSelectedItem = useValheimDataStore((s) => s.setSelectedItem);
  const {
    characters,
    selectedPath,
    character,
    loading,
    error,
    fetchCharacters,
    selectCharacter,
    refreshSelected,
  } = usePlayerDataStore();

  const goToItem = (prefabId: string) => {
    const item = itemMap.get(prefabId);
    if (item) {
      setSelectedItem(item);
      navigate("/valheim-data");
    }
  };

  const [showDropdown, setShowDropdown] = useState(false);
  const [knowledgeTab, setKnowledgeTab] = useState<"discovered" | "all">("discovered");
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeFilter, setKnowledgeFilter] = useState<string>("all");
  const [knowledgeTypeFilter, setKnowledgeTypeFilter] = useState<string>("all");

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  // File watcher: live-update when .fch files change (game saves, cloud sync, etc.)
  useEffect(() => {
    startPlayerDataWatcher().catch(() => {});

    const unlistenPromise = listen("player-data-changed", () => {
      refreshSelected();
    });

    return () => {
      stopPlayerDataWatcher().catch(() => {});
      unlistenPromise.then((fn) => fn());
    };
  }, [refreshSelected]);

  // Auto-select first character
  useEffect(() => {
    if (characters.length > 0 && !selectedPath) {
      selectCharacter(characters[0].path);
    }
  }, [characters, selectedPath, selectCharacter]);

  const selectedName = characters.find((c) => c.path === selectedPath)?.name ?? "Select Character";

  // ── Knowledge data ─────────────────────────────────────
  const knowledgeData = useMemo(() => {
    if (!character) return { discovered: [], undiscovered: [], all: [] };

    // Build a set of known prefab IDs by resolving tokens to prefabs
    const knownPrefabs = new Set<string>();
    for (const token of [...character.known_materials, ...character.known_recipes]) {
      // Try direct prefab match first (trophies use prefab names)
      if (itemMap.has(token)) {
        knownPrefabs.add(token);
      } else {
        // Resolve $item_xxx / $piece_xxx token to prefab via tokenMap
        const item = tokenMap.get(token.toLowerCase());
        if (item) knownPrefabs.add(item.id);
      }
    }

    // Filter to items that are discoverable (not creatures)
    const discoverableItems = VALHEIM_ITEMS.filter(
      (i) => i.type !== "Creature"
    );

    const discovered = discoverableItems.filter((i) => knownPrefabs.has(i.id));
    const undiscovered = discoverableItems.filter((i) => !knownPrefabs.has(i.id));

    return { discovered, undiscovered, all: discoverableItems };
  }, [character]);

  const filteredKnowledge = useMemo(() => {
    const items = knowledgeTab === "discovered" ? knowledgeData.discovered : knowledgeData.all;
    let filtered = items;

    if (knowledgeFilter !== "all") {
      filtered = filtered.filter((i) => i.biomes.includes(knowledgeFilter));
    }

    if (knowledgeTypeFilter !== "all") {
      filtered = filtered.filter((i) => i.type === knowledgeTypeFilter);
    }

    if (knowledgeSearch) {
      const q = knowledgeSearch.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          i.subcategory.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [knowledgeTab, knowledgeData, knowledgeSearch, knowledgeFilter, knowledgeTypeFilter]);

  const knownPrefabSet = useMemo(() => {
    if (!character) return new Set<string>();
    const set = new Set<string>();
    for (const token of [...character.known_materials, ...character.known_recipes]) {
      if (itemMap.has(token)) {
        set.add(token);
      } else {
        const item = tokenMap.get(token.toLowerCase());
        if (item) set.add(item.id);
      }
    }
    return set;
  }, [character]);

  // ── Equipped items ─────────────────────────────────────
  const equippedItems = useMemo(() => {
    if (!character) return [];
    return character.inventory.filter((i) => i.equipped && i.name);
  }, [character]);

  const getEquippedForSlot = (slot: typeof EQUIP_SLOTS[number]): InventoryItem | undefined => {
    return equippedItems.find((inv) => {
      const item = getItem(inv.name);
      if (!item) return false;
      if (!slot.types.includes(item.type)) return false;
      if (slot.subcats.length > 0) {
        return slot.subcats.some((sc) =>
          item.subcategory.toLowerCase().includes(sc.toLowerCase())
        );
      }
      return true;
    });
  };

  // ── Inventory Grid ─────────────────────────────────────
  const inventoryGrid = useMemo(() => {
    if (!character) return [];
    // Build a 8-column grid from inventory items
    const items = character.inventory.filter((i) => i.name);
    // Find max row
    const maxRow = Math.max(0, ...items.map((i) => i.grid_y));
    const grid: (InventoryItem | null)[][] = [];
    for (let row = 0; row <= maxRow; row++) {
      const rowItems: (InventoryItem | null)[] = [];
      for (let col = 0; col < 8; col++) {
        const item = items.find((i) => i.grid_x === col && i.grid_y === row);
        rowItems.push(item ?? null);
      }
      grid.push(rowItems);
    }
    return grid;
  }, [character]);

  // ── Loading / Error States ─────────────────────────────
  if (loading && !character) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (error && !character) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-red-400">
        <AlertCircle className="w-6 h-6" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Header + Character Selector ─────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">Player Data</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Character stats, skills, inventory & knowledge
          </p>
        </div>

        {/* Character Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-3 px-4 py-2.5 glass rounded-xl hover:border-brand-500/30 transition-all min-w-[200px]"
          >
            <User className="w-4.5 h-4.5 text-brand-400" />
            <span className="font-medium text-zinc-200">{selectedName}</span>
            <ChevronDown className={cn("w-4 h-4 text-zinc-500 ml-auto transition-transform", showDropdown && "rotate-180")} />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-full mt-2 w-72 glass rounded-xl border border-zinc-700/50 shadow-2xl z-50 overflow-hidden">
              {characters.map((c) => (
                <button
                  key={c.path}
                  onClick={() => {
                    selectCharacter(c.path);
                    setShowDropdown(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/60 transition-colors",
                    c.path === selectedPath && "bg-brand-500/10 border-l-2 border-brand-400"
                  )}
                >
                  <User className="w-4 h-4 text-zinc-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-200 truncate">{c.name}</div>
                    <div className="text-xs text-zinc-500">
                      {(c.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {character && (
        <>
          {/* ── Stats Row ──────────────────────────────────── */}
          <div className="grid grid-cols-7 gap-3 stagger-children">
            <StatCard icon={Skull} label="Deaths" value={character.deaths} color="text-red-400" bg="bg-red-500/10" />
            <StatCard icon={Swords} label="Kills" value={character.kills.toLocaleString()} color="text-orange-400" bg="bg-orange-500/10" />
            <StatCard icon={Crown} label="Forsaken" value={character.boss_kills} color="text-purple-400" bg="bg-purple-500/10" />
            <StatCard icon={Wrench} label="Crafts" value={character.crafts.toLocaleString()} color="text-brand-400" bg="bg-brand-500/10" />
            <StatCard icon={Hammer} label="Builds" value={character.builds.toLocaleString()} color="text-blue-400" bg="bg-blue-500/10" />
            <StatCard icon={Trophy} label="Trophies" value={character.trophies.length} color="text-yellow-400" bg="bg-yellow-500/10" />
            <StatCard icon={MapPin} label="Worlds" value={character.world_count} color="text-emerald-400" bg="bg-emerald-500/10" />
          </div>

          {/* ── Main 3-Column Layout ──────────────────────── */}
          <div className="grid grid-cols-12 gap-4">
            {/* LEFT: Equipment Paper Doll */}
            <div className="col-span-3 space-y-3">
              <EquipmentPanel
                equippedItems={equippedItems}
                getEquippedForSlot={getEquippedForSlot}
                character={character}
                onItemClick={goToItem}
              />

              {/* Active Foods */}
              {character.active_foods.length > 0 && (
                <div className="glass rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Utensils className="w-3.5 h-3.5" /> Active Foods
                  </h3>
                  <div className="space-y-2">
                    {character.active_foods.map((food, i) => (
                      <div
                        key={i}
                        className={cn("flex items-center gap-2", itemMap.has(food.name) && "cursor-pointer hover:bg-zinc-800/40 rounded-lg px-1 -mx-1")}
                        onClick={() => goToItem(food.name)}
                      >
                        <ItemIcon id={food.name} size={24} />
                        <span className="text-sm text-zinc-300 truncate">{getItemName(food.name)}</span>
                        <div className="flex gap-2 ml-auto text-xs">
                          {food.health > 0 && <span className="text-red-400">♥{Math.round(food.health)}</span>}
                          {food.stamina > 0 && <span className="text-yellow-400">⚡{Math.round(food.stamina)}</span>}
                          {food.time > 0 && <span className="text-zinc-400">{Math.round(food.time)}s</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Known Biomes */}
              <div className="glass rounded-xl p-4">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5" /> Biomes Discovered
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {character.known_biomes.map((biome) => (
                    <span
                      key={biome}
                      className={cn(
                        "px-2 py-0.5 rounded-md text-xs font-medium",
                        BIOME_COLORS[biome] ?? "bg-zinc-700/50 text-zinc-400"
                      )}
                    >
                      {biome}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* CENTER: Inventory Grid */}
            <div className="col-span-5">
              <div className="glass rounded-xl p-4">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Package className="w-3.5 h-3.5" /> Inventory
                  <span className="text-zinc-600 ml-auto font-normal normal-case">
                    {character.inventory.filter((i) => i.name).length} items
                  </span>
                </h3>
                <div className="space-y-0.5">
                  {inventoryGrid.map((row, rowIdx) => (
                    <div key={rowIdx} className="flex gap-0.5">
                      {row.map((item, colIdx) => (
                        <InventorySlot
                          key={`${rowIdx}-${colIdx}`}
                          item={item}
                          isHotbar={rowIdx === 0}
                          onItemClick={goToItem}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT: Skills */}
            <div className="col-span-4">
              <div className="glass rounded-xl p-4">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" /> Skills
                </h3>
                <div className="space-y-2">
                  {character.skills
                    .filter((s) => s.level > 0)
                    .map((skill) => (
                      <SkillBar key={skill.id} skill={skill} />
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Knowledge / Discovery Panel ────────────────── */}
          <div className="glass rounded-xl p-5">
            {/* Title Row */}
            <h3 className="text-lg font-semibold text-zinc-200 flex items-center gap-2 mb-3">
              <Eye className="w-5 h-5 text-brand-400" /> Knowledge
            </h3>

            {/* Controls Row */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                {/* Tab Toggle */}
                <div className="flex bg-zinc-800/60 rounded-lg p-0.5">
                  <button
                    onClick={() => setKnowledgeTab("discovered")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      knowledgeTab === "discovered"
                        ? "bg-brand-500/20 text-brand-400"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    Discovered ({knowledgeData.discovered.length})
                  </button>
                  <button
                    onClick={() => setKnowledgeTab("all")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      knowledgeTab === "all"
                        ? "bg-brand-500/20 text-brand-400"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    All Items ({knowledgeData.all.length})
                  </button>
                </div>

                {/* Discovery Progress */}
                <div className="flex items-center gap-2">
                  <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-400 rounded-full transition-all duration-500"
                      style={{
                        width: `${knowledgeData.all.length ? (knowledgeData.discovered.length / knowledgeData.all.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500">
                    {knowledgeData.all.length
                      ? Math.round((knowledgeData.discovered.length / knowledgeData.all.length) * 100)
                      : 0}
                    %
                  </span>
                </div>
              </div>

              {/* Search + Filter */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    value={knowledgeSearch}
                    onChange={(e) => setKnowledgeSearch(e.target.value)}
                    placeholder="Search items..."
                    className="w-48 pl-9 pr-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50"
                  />
                </div>

                <select
                  value={knowledgeFilter}
                  onChange={(e) => setKnowledgeFilter(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-brand-500/50"
                >
                  <option value="all">All Biomes</option>
                  {["Meadows", "Black Forest", "Swamp", "Mountain", "Plains", "Ocean", "Mistlands", "Ashlands", "Deep North"].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>

                <select
                  value={knowledgeTypeFilter}
                  onChange={(e) => setKnowledgeTypeFilter(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-brand-500/50"
                >
                  <option value="all">All Types</option>
                  {["Material", "Weapon", "Armor", "Food", "Potion", "Tool", "Ammo", "BuildPiece", "WorldObject", "Misc"].map((t) => (
                    <option key={t} value={t}>{t === "BuildPiece" ? "Build Piece" : t === "WorldObject" ? "World Object" : t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Knowledge Item List */}
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur z-10">
                  <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="py-2 px-2 w-10"></th>
                    <th className="py-2 px-2">Item</th>
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2">Biome</th>
                    <th className="py-2 px-2">Source</th>
                    {knowledgeTab === "all" && <th className="py-2 px-2 w-16 text-center">Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredKnowledge.slice(0, 200).map((item) => {
                    const isKnown = knownPrefabSet.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        onClick={() => goToItem(item.id)}
                        className={cn(
                          "border-t border-zinc-800/30 hover:bg-zinc-800/30 transition-colors cursor-pointer",
                          knowledgeTab === "all" && !isKnown && "opacity-50"
                        )}
                      >
                        <td className="py-1.5 px-2">
                          <ItemIcon id={item.id} size={28} />
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="text-sm text-zinc-200 font-medium">{item.name}</span>
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="text-xs text-zinc-400">{item.subcategory || item.type}</span>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex flex-wrap gap-1">
                            {item.biomes.slice(0, 2).map((b) => (
                              <span
                                key={b}
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                  BIOME_COLORS[b] ?? "bg-zinc-700/50 text-zinc-400"
                                )}
                              >
                                {b}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-xs text-zinc-400">
                          {item.source.slice(0, 2).join(", ")}
                          {item.station && (
                            <span className="text-zinc-500"> • {item.station}</span>
                          )}
                        </td>
                        {knowledgeTab === "all" && (
                          <td className="py-1.5 px-2 text-center">
                            {isKnown ? (
                              <Eye className="w-4 h-4 text-brand-400 mx-auto" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-zinc-600 mx-auto" />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredKnowledge.length > 200 && (
                <div className="text-center text-xs text-zinc-500 py-3">
                  Showing 200 of {filteredKnowledge.length} items — use search to narrow
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Stat Card Component ────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: typeof Skull;
  label: string;
  value: string | number;
  color: string;
  bg: string;
}) {
  return (
    <div className="glass rounded-xl p-4 hover:border-zinc-700/50 transition-all duration-300">
      <div className="flex items-center gap-2.5 mb-2">
        <div className={cn("p-1.5 rounded-lg", bg)}>
          <Icon className={cn("w-4 h-4", color)} />
        </div>
        <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-xl font-bold", color)}>{value}</p>
    </div>
  );
}

// ── Equipment Panel ────────────────────────────────────────
function EquipmentPanel({
  equippedItems,
  getEquippedForSlot,
  character,
  onItemClick,
}: {
  equippedItems: InventoryItem[];
  getEquippedForSlot: (slot: typeof EQUIP_SLOTS[number]) => InventoryItem | undefined;
  character: any;
  onItemClick: (prefabId: string) => void;
}) {
  const guardianName = GUARDIAN_NAMES[character.guardian_power] ?? character.guardian_power ?? "None";

  return (
    <div className="glass rounded-xl p-4">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5" /> Equipment
      </h3>

      {/* Character Info */}
      <div className="text-center mb-4">
        <div className="w-20 h-20 mx-auto rounded-full bg-zinc-800/80 border-2 border-brand-500/30 flex items-center justify-center mb-2 relative overflow-hidden">
          <User className="w-10 h-10 text-brand-400/60" />
          {/* Glow effect */}
          <div className="absolute inset-0 bg-gradient-to-t from-brand-500/10 to-transparent" />
        </div>
        <div className="text-lg font-bold text-zinc-100">{character.name}</div>
        <div className="text-xs text-zinc-500">
          {character.model === 0 ? "Male" : "Female"} • {character.beard && character.beard !== "No beard" ? character.beard.replace("Beard", "Beard ") : ""} {character.hair ? character.hair.replace("Hair", "Hair ") : ""}
        </div>
      </div>

      {/* Vital bars */}
      <div className="space-y-2 mb-4">
        <VitalBar label="HP" current={character.hp} max={character.max_hp} color="bg-red-500" icon={Heart} iconColor="text-red-400" />
        <VitalBar label="Stamina" current={character.stamina} max={character.stamina} color="bg-yellow-500" icon={Zap} iconColor="text-yellow-400" />
        {character.max_eitr > 0 && (
          <VitalBar label="Eitr" current={character.max_eitr} max={character.max_eitr} color="bg-cyan-500" icon={Flame} iconColor="text-cyan-400" />
        )}
      </div>

      {/* Guardian Power */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 mb-4">
        <Crown className="w-4 h-4 text-purple-400" />
        <span className="text-xs text-zinc-400">Forsaken Power</span>
        <span className="text-sm font-medium text-purple-300 ml-auto">{guardianName || "None"}</span>
      </div>

      {/* Equipment Slots */}
      <div className="grid grid-cols-2 gap-1.5">
        {EQUIP_SLOTS.map((slot) => {
          const inv = getEquippedForSlot(slot);
          const item = inv ? getItem(inv.name) : undefined;
          return (
            <div
              key={slot.key}
              onClick={() => inv && onItemClick(inv.name)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors",
                inv
                  ? "border-brand-500/20 bg-brand-500/5 cursor-pointer hover:border-brand-500/40"
                  : "border-zinc-800/50 bg-zinc-900/40"
              )}
            >
              {inv ? (
                <ItemIcon id={inv.name} size={24} />
              ) : (
                <div className="w-6 h-6 rounded bg-zinc-800/60 flex items-center justify-center">
                  <div className="w-3 h-3 border border-zinc-700 rounded-sm" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-zinc-500 uppercase">{slot.label}</div>
                <div className="text-xs text-zinc-300 truncate">
                  {item ? item.name : "—"}
                </div>
              </div>
              {inv && inv.quality > 1 && (
                <span className="text-[10px] text-brand-400 font-medium">★{inv.quality}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Vital Bar ──────────────────────────────────────────────
function VitalBar({
  label,
  current,
  max,
  color,
  icon: Icon,
  iconColor,
}: {
  label: string;
  current: number;
  max: number;
  color: string;
  icon: typeof Heart;
  iconColor: string;
}) {
  const pct = max > 0 ? (current / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />
      <div className="flex-1">
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="text-[11px] text-zinc-400 w-14 text-right shrink-0">
        {Math.round(current)}/{Math.round(max)}
      </span>
    </div>
  );
}

// ── Inventory Slot ─────────────────────────────────────────
function InventorySlot({ item, isHotbar, onItemClick }: { item: InventoryItem | null; isHotbar: boolean; onItemClick: (prefabId: string) => void }) {
  const valheimItem = item ? getItem(item.name) : undefined;

  return (
    <div
      onClick={() => item && onItemClick(item.name)}
      className={cn(
        "w-[52px] h-[52px] rounded-lg flex items-center justify-center relative group transition-colors",
        isHotbar
          ? "bg-zinc-800/80 border border-zinc-700/60"
          : "bg-zinc-900/60 border border-zinc-800/40",
        item?.equipped && "ring-1 ring-brand-400/50 bg-brand-500/5",
        item && "cursor-pointer hover:border-brand-500/30"
      )}
      title={
        item
          ? `${valheimItem?.name ?? item.name}${item.stack > 1 ? ` x${item.stack}` : ""}${item.quality > 1 ? ` ★${item.quality}` : ""}${item.equipped ? " [Equipped]" : ""}`
          : ""
      }
    >
      {item && (
        <>
          <ItemIcon id={item.name} size={36} />
          {item.stack > 1 && (
            <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-zinc-200 leading-none drop-shadow-md">
              {item.stack}
            </span>
          )}
          {item.quality > 1 && (
            <span className="absolute top-0 right-0.5 text-[9px] font-bold text-brand-400 leading-none">
              ★{item.quality}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ── Skill Bar ──────────────────────────────────────────────
function SkillBar({ skill }: { skill: SkillData }) {
  const pct = Math.min(100, skill.level);
  const color = SKILL_COLORS[skill.name] ?? "text-zinc-300";

  return (
    <div className="flex items-center gap-3">
      <span className={cn("text-sm font-medium w-28 truncate", color)}>{skill.name}</span>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-500/80 to-brand-400 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-bold text-zinc-300 w-10 text-right">{Math.floor(skill.level)}</span>
    </div>
  );
}
