import { X, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  listName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteListConfirm({ open, listName, onCancel, onConfirm }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="glass rounded-xl border border-red-500/40 shadow-2xl w-[420px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/70">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Delete list?</h2>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 text-sm text-zinc-300">
          Delete <span className="font-semibold text-zinc-100">"{listName}"</span>? This can't be undone.
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800/70">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-md text-xs font-semibold bg-red-500 hover:bg-red-400 text-zinc-950 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
