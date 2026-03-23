import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Download, Loader2, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppUpdateStore } from "../../stores/appUpdateStore";
import { useValheimDataStore } from "../../stores/valheimDataStore";

const appWindow = getCurrentWindow();

export function Titlebar() {
  const {
    status,
    currentVersion,
    newVersion,
    downloadProgress,
    error,
    installAndRelaunch,
  } = useAppUpdateStore();

  return (
    <div
      data-tauri-drag-region
      className="h-10 flex items-center justify-between bg-zinc-950 border-b border-zinc-800/50 select-none shrink-0 z-50"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 px-4">
        <img src="/megaload-icon.png" alt="MegaLoad" className="w-6 h-6 rounded" draggable={false} />
        <span className="text-sm font-semibold text-zinc-300 tracking-wide">
          MegaLoad
        </span>
        <span className="text-[10px] text-zinc-600 ml-1">v{currentVersion}</span>

        {/* App update indicator */}
        {status === "checking" && (
          <Loader2 className="w-3 h-3 text-zinc-500 animate-spin ml-1" />
        )}

        {status === "update-available" && (
          <button
            onClick={installAndRelaunch}
            className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 transition-colors"
          >
            <Download className="w-3 h-3" />
            Update to v{newVersion}
          </button>
        )}

        {status === "downloading" && (
          <div className="flex items-center gap-1.5 ml-2 text-[10px] text-brand-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Updating... {downloadProgress}%</span>
          </div>
        )}

        {status === "ready" && (
          <span className="ml-2 text-[10px] text-emerald-400">
            Restarting...
          </span>
        )}

        {status === "error" && error && (
          <span className="ml-2 text-[10px] text-red-400 truncate max-w-[200px]" title={error}>
            Update failed
          </span>
        )}
      </div>

      <div className="flex h-full items-center">
        <CartIndicator />
        <button
          onClick={() => appWindow.minimize()}
          className="h-full px-4 hover:bg-zinc-800 transition-colors duration-150"
        >
          <Minus className="w-3.5 h-3.5 text-zinc-400" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="h-full px-4 hover:bg-zinc-800 transition-colors duration-150"
        >
          <Square className="w-3 h-3 text-zinc-400" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="h-full px-4 hover:bg-red-600 transition-colors duration-150"
        >
          <X className="w-3.5 h-3.5 text-zinc-400" />
        </button>
      </div>
    </div>
  );
}

function CartIndicator() {
  const { cartItems } = useValheimDataStore();
  const navigate = useNavigate();
  if (cartItems.length === 0) return null;
  return (
    <button
      onClick={() => navigate("/cart")}
      className="relative h-full px-3 hover:bg-zinc-800 transition-colors duration-150"
      title="Shopping Cart"
    >
      <ShoppingCart className="w-3.5 h-3.5 text-zinc-400" />
      <span className="absolute -top-0 right-1 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
        {cartItems.length}
      </span>
    </button>
  );
}
