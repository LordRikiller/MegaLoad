import { X, AlertTriangle } from "lucide-react";
import { formatModName } from "../lib/utils";
import type { StarterMod } from "../lib/tauri-api";

/**
 * A standalone mod (MiniQoL) re-implements Mega-series features, so a profile
 * holds EITHER it OR our other mods. `install_mod_update` enforces that on a
 * fresh install by deleting the other side; this is the heads-up before it does.
 */
export function standaloneConflicts(
  target: StarterMod,
  catalogue: StarterMod[],
  isInstalled: (name: string) => boolean
): string[] {
  return catalogue
    .filter((m) => m.name !== target.name && (target.standalone || m.standalone) && isInstalled(m.name))
    .map((m) => m.name);
}

interface Props {
  open: boolean;
  installing: StarterMod | null;
  removing: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function StandaloneConfirm({ open, installing, removing, onCancel, onConfirm }: Props) {
  if (!open || !installing) return null;
  const name = formatModName(installing.name);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="glass rounded-xl border border-amber-500/40 shadow-2xl w-[440px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/70">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Install {name}?</h2>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 text-sm text-zinc-300 space-y-2">
          <p>
            {installing.standalone
              ? `${name} is standalone — it replaces Mega-series features, so it can't share a profile with them. Installing it deletes:`
              : `This profile runs a standalone mod that can't share a profile with the Mega series. Installing ${name} deletes:`}
          </p>
          <ul className="text-xs text-zinc-200 font-semibold flex flex-wrap gap-1.5">
            {removing.map((m) => (
              <li key={m} className="px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30">
                {formatModName(m)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">Their configs are kept, so reinstalling later restores your settings.</p>
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
            className="px-4 py-1.5 rounded-md text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors"
          >
            Delete {removing.length} and install
          </button>
        </div>
      </div>
    </div>
  );
}
