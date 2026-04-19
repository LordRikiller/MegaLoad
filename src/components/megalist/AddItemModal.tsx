import { useMemo, useState } from "react";
import { X, Search, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { ItemIcon } from "../ui/ItemIcon";
import { VALHEIM_ITEMS, type ItemType } from "../../data/valheim-items";
import { useMegaListStore } from "../../stores/megaListStore";
import { useToastStore } from "../../stores/toastStore";

interface Props {
  open: boolean;
  onClose: () => void;
  listId: string;
  alreadyInList: Set<string>;
}

const TYPE_FILTERS: (ItemType | "All")[] = [
  "All", "Material", "Food", "Weapon", "Armor", "Potion", "Tool", "BuildPiece", "Creature", "Misc",
];

export function AddItemModal({ open, onClose, listId, alreadyInList }: Props) {
  const addItems = useMegaListStore((s) => s.addItems);
  const addToast = useToastStore((s) => s.addToast);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "All">("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = VALHEIM_ITEMS.filter((item) => {
      if (typeFilter !== "All" && item.type !== typeFilter) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
    });
    return out.slice(0, 200);
  }, [query, typeFilter]);

  if (!open) return null;

  const close = () => {
    setQuery("");
    setTypeFilter("All");
    setSelected(new Set());
    onClose();
  };

  const toggle = (id: string) => {
    if (alreadyInList.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commit = () => {
    if (selected.size === 0) return;
    const added = addItems(listId, Array.from(selected), "manual");
    addToast({
      type: "success",
      title: "Items added",
      message: `${added} item${added === 1 ? "" : "s"} added`,
      duration: 2000,
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={close}>
      <div
        className="glass rounded-xl border border-zinc-800 shadow-2xl w-[560px] max-w-[94vw] h-[640px] max-h-[94vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/70 shrink-0">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Add items to list</h2>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items by name or id…"
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/40"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                  typeFilter === t
                    ? "bg-brand-500/20 text-brand-400 border border-brand-500/40"
                    : "bg-zinc-900/50 text-zinc-400 border border-zinc-800 hover:text-zinc-200",
                )}
              >
                {t === "BuildPiece" ? "Build" : t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {matches.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">No matches.</p>
          ) : (
            matches.map((item) => {
              const already = alreadyInList.has(item.id);
              const picked = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  disabled={already}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left",
                    already && "opacity-40 cursor-not-allowed",
                    !already && picked && "bg-brand-500/15 border border-brand-500/30",
                    !already && !picked && "hover:bg-zinc-800/40 border border-transparent",
                  )}
                >
                  <ItemIcon id={item.id} type={item.type} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-200 truncate">{item.name}</div>
                    <div className="text-[10px] text-zinc-500 truncate">
                      {item.type}{item.subcategory && item.subcategory !== item.type ? ` · ${item.subcategory}` : ""}
                      {item.biomes.length > 0 ? ` · ${item.biomes.join(", ")}` : ""}
                    </div>
                  </div>
                  {already ? (
                    <span className="text-[10px] text-zinc-500 shrink-0">In list</span>
                  ) : (
                    <span className={cn(
                      "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                      picked ? "bg-brand-500 border-brand-400" : "border-zinc-700",
                    )}>
                      {picked && <span className="text-[10px] text-zinc-950 font-bold">✓</span>}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-between items-center px-4 py-3 border-t border-zinc-800/70 shrink-0">
          <span className="text-xs text-zinc-500">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={selected.size === 0}
              className={cn(
                "px-4 py-1.5 rounded-md text-xs font-semibold transition-colors",
                selected.size === 0
                  ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "bg-brand-500 hover:bg-brand-400 text-zinc-950",
              )}
            >
              Add {selected.size || ""} item{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
