import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, Plus, Search, Trash2, Copy, Edit3, Copy as Duplicate } from "lucide-react";
import { cn } from "../lib/utils";
import { useMegaListStore } from "../stores/megaListStore";
import { getItemById } from "../stores/valheimDataStore";
import { copyText } from "../lib/clipboard";
import { DeleteListConfirm } from "../components/megalist/DeleteListConfirm";
import type { MegaList as MegaListType } from "../types/megaList";

function listNameToClipboardText(list: MegaListType): string {
  // Unchecked names, one per line — per decision: names-only plain text.
  return list.items
    .filter((it) => !it.checked)
    .map((it) => getItemById(it.itemId)?.name ?? it.itemId)
    .join("\n");
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function MegaList() {
  const navigate = useNavigate();
  const lists = useMegaListStore((s) => s.lists);
  const createList = useMegaListStore((s) => s.createList);
  const renameList = useMegaListStore((s) => s.renameList);
  const deleteList = useMegaListStore((s) => s.deleteList);
  const duplicateList = useMegaListStore((s) => s.duplicateList);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = lists.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return sorted;
    return sorted.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, query]);

  const create = () => {
    const id = createList("Untitled list");
    navigate(`/megalist/${id}`);
  };

  const confirmDelete = () => {
    if (pendingDelete) {
      deleteList(pendingDelete);
      setPendingDelete(null);
    }
  };

  const pendingDeleteList = pendingDelete ? lists.find((l) => l.id === pendingDelete) : null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-brand-400" />
            MegaList
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Named checklists of Valheim items — for labelling chests, tracking cauldron mats, planning trips.
          </p>
        </div>
        <button
          onClick={create}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500/15 border border-brand-500/30 text-brand-400 hover:bg-brand-500/25 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New list
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="glass rounded-xl border border-zinc-800 p-10 text-center">
          <ListChecks className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm mb-1">No lists yet.</p>
          <p className="text-zinc-500 text-xs">
            Filter items in <span className="text-zinc-400">Valheim Data</span>, then use{" "}
            <span className="text-zinc-400">Export → Add to list</span>, or create a blank one above.
          </p>
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lists…"
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/40"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((list) => {
              const total = list.items.length;
              const checked = list.items.filter((it) => it.checked).length;
              const snapshot = list.filterSnapshot;
              const isEditing = editing === list.id;
              return (
                <div
                  key={list.id}
                  className="glass rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors overflow-hidden flex flex-col"
                >
                  <button
                    onClick={() => !isEditing && navigate(`/megalist/${list.id}`)}
                    className="flex-1 text-left p-4"
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                          if (editValue.trim()) renameList(list.id, editValue);
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-full bg-zinc-900/60 border border-brand-500/40 rounded-md px-2 py-1 text-sm text-zinc-100 focus:outline-none"
                      />
                    ) : (
                      <h3 className="text-sm font-semibold text-zinc-100 truncate">{list.name}</h3>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="text-zinc-300 font-semibold">{checked}</span>
                      <span>/ {total} ticked</span>
                      <span className="text-zinc-700">•</span>
                      <span>{relativeTime(list.updatedAt)}</span>
                    </div>
                    {snapshot && (snapshot.biomes?.length || snapshot.types?.length || snapshot.stations?.length) && (
                      <p className="mt-2 text-[10px] text-zinc-500 truncate">
                        From:{" "}
                        {[
                          ...(snapshot.types ?? []),
                          ...(snapshot.biomes ?? []),
                          ...(snapshot.stations ?? []),
                        ].slice(0, 4).join(", ")}
                      </p>
                    )}
                  </button>
                  <div className="flex items-center gap-1 px-2 py-1.5 border-t border-zinc-800/70 bg-zinc-900/30">
                    <button
                      title="Rename"
                      onClick={() => {
                        setEditing(list.id);
                        setEditValue(list.name);
                      }}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="Duplicate"
                      onClick={() => duplicateList(list.id)}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                    >
                      <Duplicate className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="Copy unchecked item names"
                      onClick={() => copyText(listNameToClipboardText(list))}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex-1" />
                    <button
                      title="Delete list"
                      onClick={() => setPendingDelete(list.id)}
                      className={cn(
                        "p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors",
                      )}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <DeleteListConfirm
        open={pendingDelete !== null}
        listName={pendingDeleteList?.name ?? ""}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
