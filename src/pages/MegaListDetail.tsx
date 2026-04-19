import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Plus,
  Copy,
  Trash2,
  Edit3,
  CheckSquare,
  Square,
  AlertTriangle,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useMegaListStore } from "../stores/megaListStore";
import { getItemById } from "../stores/valheimDataStore";
import { ItemIcon } from "../components/ui/ItemIcon";
import { copyText } from "../lib/clipboard";
import { AddItemModal } from "../components/megalist/AddItemModal";
import { DeleteListConfirm } from "../components/megalist/DeleteListConfirm";
import { BIOME_COLORS, BIOME_BG_COLORS } from "./ValheimData";

type SortMode = "name-asc" | "name-desc" | "biome-grouped";

const BIOME_ORDER = [
  "Meadows", "Black Forest", "Swamp", "Mountain", "Plains", "Mistlands", "Ashlands", "Deep North", "Ocean",
];
const BIOME_TIER = Object.fromEntries(BIOME_ORDER.map((b, i) => [b, i]));

function BiomeChip({ biome, onClick, active }: { biome: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 rounded text-[10px] font-semibold border transition-all",
        onClick ? "cursor-pointer hover:brightness-125" : "cursor-default",
        BIOME_BG_COLORS[biome] || "bg-zinc-800/60 border-zinc-700/30",
        BIOME_COLORS[biome] || "text-zinc-400",
        active ? "ring-1 ring-brand-400" : "",
      )}
    >
      {biome}
    </button>
  );
}

export function MegaListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const list = useMegaListStore((s) => s.lists.find((l) => l.id === id));
  const renameList = useMegaListStore((s) => s.renameList);
  const deleteList = useMegaListStore((s) => s.deleteList);
  const toggleItem = useMegaListStore((s) => s.toggleItem);
  const removeItem = useMegaListStore((s) => s.removeItem);
  const setChecked = useMegaListStore((s) => s.setChecked);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [sort, setSort] = useState<SortMode>("name-asc");
  const [biomeFilter, setBiomeFilter] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  if (!list) {
    return (
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate("/megalist")}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to MegaList
        </button>
        <div className="glass rounded-xl border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">List not found.</p>
        </div>
      </div>
    );
  }

  // Resolve + sort + filter
  const resolved = list.items.map((it) => ({
    ...it,
    item: getItemById(it.itemId),
  }));

  const biomesAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const r of resolved) {
      if (r.item) for (const b of r.item.biomes) set.add(b);
    }
    return Array.from(set).sort((a, b) => (BIOME_TIER[a] ?? 99) - (BIOME_TIER[b] ?? 99));
  }, [resolved]);

  const visible = useMemo(() => {
    let out = resolved.slice();
    if (biomeFilter.length > 0) {
      out = out.filter((r) => r.item && r.item.biomes.some((b) => biomeFilter.includes(b)));
    }
    if (sort === "name-asc") out.sort((a, b) => (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId));
    else if (sort === "name-desc") out.sort((a, b) => (b.item?.name ?? b.itemId).localeCompare(a.item?.name ?? a.itemId));
    else if (sort === "biome-grouped") {
      out.sort((a, b) => {
        const ta = Math.min(...(a.item?.biomes.length ? a.item.biomes.map((x) => BIOME_TIER[x] ?? 99) : [99]));
        const tb = Math.min(...(b.item?.biomes.length ? b.item.biomes.map((x) => BIOME_TIER[x] ?? 99) : [99]));
        if (ta !== tb) return ta - tb;
        return (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId);
      });
    }
    return out;
  }, [resolved, sort, biomeFilter]);

  const toggleBiome = (b: string) =>
    setBiomeFilter((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));

  const allVisibleChecked = visible.length > 0 && visible.every((r) => r.checked);
  const setVisible = (checked: boolean) => setChecked(list.id, visible.map((r) => r.itemId), checked);

  const uncheckedText = visible
    .filter((r) => !r.checked)
    .map((r) => r.item?.name ?? r.itemId)
    .join("\n");

  const total = list.items.length;
  const checkedCount = list.items.filter((it) => it.checked).length;
  const alreadyInList = new Set(list.items.map((it) => it.itemId));

  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={() => navigate("/megalist")}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to MegaList
      </button>

      <div className="glass rounded-xl border border-zinc-800 p-5 mb-4">
        <div className="flex items-start justify-between gap-3">
          {editing ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                if (editValue.trim()) renameList(list.id, editValue);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(false);
              }}
              className="flex-1 bg-zinc-900/60 border border-brand-500/40 rounded-md px-3 py-2 text-xl font-bold text-zinc-100 focus:outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setEditing(true);
                setEditValue(list.name);
              }}
              className="flex-1 text-left text-xl font-bold text-zinc-100 hover:text-brand-400 transition-colors flex items-center gap-2"
            >
              {list.name}
              <Edit3 className="w-3.5 h-3.5 text-zinc-600" />
            </button>
          )}
          <button
            onClick={() => setShowDelete(true)}
            title="Delete list"
            className="p-2 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
          <span><span className="text-zinc-300 font-semibold">{checkedCount}</span> / {total} ticked</span>
          {list.filterSnapshot && (list.filterSnapshot.biomes?.length || list.filterSnapshot.types?.length || list.filterSnapshot.stations?.length) && (
            <>
              <span className="text-zinc-700">•</span>
              <span className="truncate">
                Exported from:{" "}
                {[
                  ...(list.filterSnapshot.types ?? []),
                  ...(list.filterSnapshot.biomes ?? []),
                  ...(list.filterSnapshot.stations ?? []),
                ].join(", ")}
              </span>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-lg">
            {([
              ["name-asc", "A–Z"],
              ["name-desc", "Z–A"],
              ["biome-grouped", "Biome"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                  sort === mode
                    ? "bg-brand-500/20 text-brand-400"
                    : "text-zinc-500 hover:text-zinc-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setVisible(!allVisibleChecked)}
            disabled={visible.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors disabled:opacity-40"
            title={allVisibleChecked ? "Uncheck visible items" : "Check visible items"}
          >
            {allVisibleChecked ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            {allVisibleChecked ? "Uncheck all" : "Check all"}
          </button>
          <button
            onClick={() => copyText(uncheckedText)}
            disabled={visible.every((r) => r.checked)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors disabled:opacity-40"
            title="Copy unchecked names to clipboard"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy unchecked
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-brand-500/15 border border-brand-500/30 text-brand-400 hover:bg-brand-500/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add item
          </button>
        </div>

        {biomesAvailable.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-zinc-600 mr-1">Biome:</span>
            {biomesAvailable.map((b) => (
              <BiomeChip key={b} biome={b} active={biomeFilter.includes(b)} onClick={() => toggleBiome(b)} />
            ))}
            {biomeFilter.length > 0 && (
              <button
                onClick={() => setBiomeFilter([])}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="glass rounded-xl border border-zinc-800 overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            {total === 0 ? "No items yet — use Add item above." : "No items match the current biome filter."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {visible.map((r) => {
              const name = r.item?.name ?? `Unknown item (${r.itemId})`;
              const missing = !r.item;
              return (
                <li
                  key={r.itemId}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2",
                    r.checked && "bg-zinc-900/40",
                  )}
                >
                  <button
                    onClick={() => toggleItem(list.id, r.itemId)}
                    className={cn(
                      "w-5 h-5 rounded border shrink-0 flex items-center justify-center transition-colors",
                      r.checked
                        ? "bg-brand-500 border-brand-400"
                        : "border-zinc-700 hover:border-zinc-500",
                    )}
                  >
                    {r.checked && <span className="text-[11px] text-zinc-950 font-bold">✓</span>}
                  </button>
                  {missing ? (
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  ) : (
                    <ItemIcon id={r.itemId} type={r.item?.type} size={28} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "text-sm truncate",
                      r.checked ? "text-zinc-500 line-through" : missing ? "text-amber-300" : "text-zinc-200",
                    )}>
                      {name}
                      {r.source === "manual" && (
                        <span className="ml-2 text-[9px] text-zinc-600 uppercase tracking-wide">+ manual</span>
                      )}
                    </div>
                    {r.item && r.item.biomes.length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {r.item.biomes.map((b) => (
                          <BiomeChip key={b} biome={b} />
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => copyText(name)}
                    title="Copy name"
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeItem(list.id, r.itemId)}
                    title="Remove from list"
                    className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AddItemModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        listId={list.id}
        alreadyInList={alreadyInList}
      />
      <DeleteListConfirm
        open={showDelete}
        listName={list.name}
        onCancel={() => setShowDelete(false)}
        onConfirm={() => {
          deleteList(list.id);
          setShowDelete(false);
          navigate("/megalist");
        }}
      />
    </div>
  );
}
