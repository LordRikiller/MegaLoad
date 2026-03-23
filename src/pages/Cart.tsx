// @ts-nocheck
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShoppingCart,
  ChevronLeft,
  Minus,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  useValheimDataStore,
  getItemById,
  getCartMaterials,
  BIOME_ORDER,
  type CartEntry,
} from "../stores/valheimDataStore";
import type { ValheimItem, ItemType } from "../data/valheim-items";

// ── Biome styling (mirrors ValheimData) ──

const BIOME_COLORS: Record<string, string> = {
  Meadows: "text-green-400",
  "Black Forest": "text-emerald-400",
  Swamp: "text-lime-500",
  Mountain: "text-sky-300",
  Plains: "text-yellow-400",
  Mistlands: "text-purple-400",
  Ocean: "text-blue-400",
  Ashlands: "text-orange-400",
  "Deep North": "text-cyan-300",
};

const BIOME_BG_COLORS: Record<string, string> = {
  Meadows: "bg-green-500/10 border-green-500/20",
  "Black Forest": "bg-emerald-500/10 border-emerald-500/20",
  Swamp: "bg-lime-500/10 border-lime-500/20",
  Mountain: "bg-sky-400/10 border-sky-400/20",
  Plains: "bg-yellow-500/10 border-yellow-500/20",
  Mistlands: "bg-purple-500/10 border-purple-500/20",
  Ocean: "bg-blue-500/10 border-blue-500/20",
  Ashlands: "bg-orange-500/10 border-orange-500/20",
  "Deep North": "bg-cyan-400/10 border-cyan-400/20",
};

// ── Helpers ──

function getMinBiome(item: ValheimItem): string | null {
  if (!item.biomes || item.biomes.length === 0) return null;
  let minIdx = BIOME_ORDER.length;
  let minBiome: string | null = null;
  for (const b of item.biomes) {
    const idx = (BIOME_ORDER as readonly string[]).indexOf(b);
    if (idx >= 0 && idx < minIdx) {
      minIdx = idx;
      minBiome = b;
    }
  }
  return minBiome;
}

const TYPE_ICONS: Record<string, string> = {
  Weapon: "⚔️",
  Armor: "🛡️",
  Food: "🍖",
  Potion: "🧪",
  Material: "💎",
  Tool: "🔧",
  Ammo: "🎯",
  BuildPiece: "🏗️",
  WorldObject: "🗺️",
  Misc: "📦",
};

function ItemIcon({ id, type, size = 36 }: { id: string; type?: ItemType; size?: number }) {
  const iconPath = `/icons/${id}.png`;
  return (
    <img
      src={iconPath}
      alt={id}
      className="object-contain"
      style={{ width: size, height: size }}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

// ── Cart Page ──

export function Cart() {
  const navigate = useNavigate();
  const {
    cartItems,
    removeFromCart,
    updateCartLevel,
    clearCart,
    setSelectedItem,
  } = useValheimDataStore();

  const materials = useMemo(() => getCartMaterials(cartItems), [cartItems]);

  // Get the highest biome tier across all cart items for the summary
  const highestBiome = useMemo(() => {
    let maxIdx = -1;
    let maxBiome: string | null = null;
    for (const entry of cartItems) {
      const item = getItemById(entry.id);
      if (!item) continue;
      const biome = getMinBiome(item);
      if (!biome) continue;
      const idx = (BIOME_ORDER as readonly string[]).indexOf(biome);
      if (idx > maxIdx) {
        maxIdx = idx;
        maxBiome = biome;
      }
    }
    return maxBiome;
  }, [cartItems]);

  const navigateToItem = (id: string) => {
    const item = getItemById(id);
    if (item) {
      setSelectedItem(item);
      navigate("/valheim-data");
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/valheim-data")}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to data
            </button>
          </div>
          <h1 className="text-3xl font-bold text-zinc-100 mt-2 flex items-center gap-3">
            <ShoppingCart className="w-7 h-7 text-brand-400" />
            Shopping Cart
            {cartItems.length > 0 && (
              <span className="text-lg font-normal text-zinc-500">({cartItems.length} item{cartItems.length !== 1 ? "s" : ""})</span>
            )}
          </h1>
          {highestBiome && (
            <p className="text-sm text-zinc-500 mt-1">
              Requires up to{" "}
              <span className={cn("font-semibold", BIOME_COLORS[highestBiome])}>
                {highestBiome}
              </span>{" "}
              progression
            </p>
          )}
        </div>
        {cartItems.length > 0 && (
          <button
            onClick={clearCart}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-red-500/20 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All
          </button>
        )}
      </div>

      {/* Empty state */}
      {cartItems.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <ShoppingCart className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
            <p className="text-zinc-500 text-lg">Your cart is empty</p>
            <p className="text-zinc-600 text-sm mt-1">Add craftable items from the Valheim Data page</p>
            <button
              onClick={() => navigate("/valheim-data")}
              className="mt-4 px-4 py-2 rounded-lg bg-brand-500/15 border border-brand-500/30 text-sm font-medium text-brand-400 hover:bg-brand-500/25 transition-colors"
            >
              Browse Items
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Cart Items */}
            <div className="glass rounded-xl border border-zinc-800/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200">Items</h2>
              </div>
              <div className="divide-y divide-zinc-800/30">
                {cartItems.map((entry) => {
                  const item = getItemById(entry.id);
                  if (!item) return null;
                  const biome = getMinBiome(item);
                  return (
                    <div key={entry.id} className="flex items-center gap-3 px-5 py-3 group hover:bg-zinc-800/20 transition-colors">
                      <button
                        onClick={() => navigateToItem(entry.id)}
                        className="w-8 h-8 shrink-0 flex items-center justify-center"
                      >
                        <ItemIcon id={entry.id} type={item.type} size={32} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => navigateToItem(entry.id)}
                          className="text-sm text-brand-400 hover:underline truncate block text-left"
                        >
                          {item.name}
                        </button>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-zinc-600">{item.type}{item.subcategory ? ` · ${item.subcategory}` : ""}</span>
                          {biome && (
                            <span className={cn(
                              "text-[10px] font-medium px-1.5 py-0 rounded border",
                              BIOME_BG_COLORS[biome] || "bg-zinc-800/60 border-zinc-700/30",
                              BIOME_COLORS[biome] || "text-zinc-400"
                            )}>
                              {biome}
                            </span>
                          )}
                        </div>
                      </div>
                      {item.maxQuality > 1 && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            title="Decrease level"
                            onClick={() => updateCartLevel(entry.id, Math.max(1, entry.targetLevel - 1))}
                            className="w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-[11px] font-mono text-zinc-400 w-8 text-center">Lv {entry.targetLevel}</span>
                          <button
                            title="Increase level"
                            onClick={() => updateCartLevel(entry.id, Math.min(item.maxQuality, entry.targetLevel + 1))}
                            className="w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => removeFromCart(entry.id)}
                        className="w-5 h-5 shrink-0 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove from cart"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Total Materials */}
            <div className="glass rounded-xl border border-zinc-800/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800/50">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Total Materials
                  <span className="text-zinc-500 font-normal ml-2">({materials.length})</span>
                </h2>
              </div>
              <div className="divide-y divide-zinc-800/30">
                {materials.map((mat) => {
                  const matItem = getItemById(mat.id);
                  const biome = matItem ? getMinBiome(matItem) : null;
                  return (
                    <div key={mat.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-800/20 transition-colors">
                      <button
                        onClick={() => navigateToItem(mat.id)}
                        className="w-6 h-6 shrink-0 flex items-center justify-center"
                      >
                        <ItemIcon id={mat.id} size={24} />
                      </button>
                      <button
                        onClick={() => navigateToItem(mat.id)}
                        className="text-sm text-brand-400 hover:underline flex-1 truncate text-left"
                      >
                        {mat.name}
                      </button>
                      {biome && (
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0 rounded border shrink-0",
                          BIOME_BG_COLORS[biome] || "bg-zinc-800/60 border-zinc-700/30",
                          BIOME_COLORS[biome] || "text-zinc-400"
                        )}>
                          {biome}
                        </span>
                      )}
                      <span className="text-sm text-zinc-400 font-mono shrink-0 w-12 text-right">x{mat.amount}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
