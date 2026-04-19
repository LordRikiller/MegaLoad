import { useState } from "react";
import { X, ListChecks, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { useMegaListStore } from "../../stores/megaListStore";
import type { MegaListFilterSnapshot } from "../../types/megaList";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../../stores/toastStore";

interface Props {
  open: boolean;
  onClose: () => void;
  itemIds: string[];
  filterSnapshot: Omit<MegaListFilterSnapshot, "exportedAt">;
}

/** Modal for "Export to list" — choose new/existing list, add filtered items. */
export function ExportToListModal({ open, onClose, itemIds, filterSnapshot }: Props) {
  const navigate = useNavigate();
  const lists = useMegaListStore((s) => s.lists);
  const createList = useMegaListStore((s) => s.createList);
  const addItems = useMegaListStore((s) => s.addItems);
  const addToast = useToastStore((s) => s.addToast);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [selectedListId, setSelectedListId] = useState<string>("");

  if (!open) return null;

  const close = () => {
    setName("");
    setSelectedListId("");
    setMode("new");
    onClose();
  };

  const commit = () => {
    if (itemIds.length === 0) {
      addToast({ type: "warning", title: "Nothing to export", message: "No items match the current filters.", duration: 2500 });
      return;
    }

    if (mode === "new") {
      const finalName = name.trim() || `List ${new Date().toLocaleString()}`;
      const snapshot: MegaListFilterSnapshot = { ...filterSnapshot, exportedAt: new Date().toISOString() };
      const items = itemIds.map((id) => ({
        itemId: id,
        checked: false,
        addedAt: snapshot.exportedAt,
        source: "export" as const,
      }));
      const id = createList(finalName, items, snapshot);
      addToast({ type: "success", title: "List created", message: `"${finalName}" — ${items.length} items`, duration: 2500 });
      close();
      navigate(`/megalist/${id}`);
    } else {
      if (!selectedListId) return;
      const added = addItems(selectedListId, itemIds, "export");
      const target = lists.find((l) => l.id === selectedListId);
      addToast({
        type: "success",
        title: "Added to list",
        message: `"${target?.name ?? ""}" — ${added} new item${added === 1 ? "" : "s"} (${itemIds.length - added} already present)`,
        duration: 2500,
      });
      close();
      navigate(`/megalist/${selectedListId}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={close}>
      <div
        className="glass rounded-xl border border-zinc-800 shadow-2xl w-[460px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/70">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Add to MegaList</h2>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-zinc-500">
            {itemIds.length} item{itemIds.length === 1 ? "" : "s"} from the current filter
            {filterSnapshot.biomes && filterSnapshot.biomes.length > 0 ? ` · ${filterSnapshot.biomes.join(", ")}` : ""}
          </p>

          <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-lg">
            <button
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === "new" ? "bg-brand-500/20 text-brand-400" : "text-zinc-500 hover:text-zinc-200",
              )}
              onClick={() => setMode("new")}
            >
              <Plus className="w-3 h-3" />
              New list
            </button>
            <button
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === "existing" ? "bg-brand-500/20 text-brand-400" : "text-zinc-500 hover:text-zinc-200",
              )}
              onClick={() => setMode("existing")}
              disabled={lists.length === 0}
              title={lists.length === 0 ? "No existing lists yet" : undefined}
            >
              <ListChecks className="w-3 h-3" />
              Existing list
            </button>
          </div>

          {mode === "new" ? (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-zinc-500">List name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. Cauldron mats`}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/40"
              />
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-1">
              {lists.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">No lists yet — create a new one.</p>
              ) : (
                lists
                  .slice()
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setSelectedListId(l.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors",
                        selectedListId === l.id
                          ? "bg-brand-500/20 text-brand-200 border border-brand-500/40"
                          : "bg-zinc-900/40 text-zinc-300 border border-zinc-800 hover:border-zinc-700",
                      )}
                    >
                      <span className="font-medium truncate">{l.name}</span>
                      <span className="text-zinc-500 shrink-0 ml-2">{l.items.length}</span>
                    </button>
                  ))
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800/70">
          <button
            onClick={close}
            className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={mode === "existing" && !selectedListId}
            className={cn(
              "px-4 py-1.5 rounded-md text-xs font-semibold transition-colors",
              mode === "existing" && !selectedListId
                ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                : "bg-brand-500 hover:bg-brand-400 text-zinc-950",
            )}
          >
            {mode === "new" ? "Create list" : "Add to list"}
          </button>
        </div>
      </div>
    </div>
  );
}
