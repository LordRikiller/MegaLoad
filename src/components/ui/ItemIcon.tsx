import { useState } from "react";
import {
  Package,
  Sword,
  Shield,
  Shirt,
  Utensils,
  FlaskConical,
  Wrench,
  Crosshair,
  Landmark,
  Skull,
  MapPin,
  HelpCircle,
  Gem,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { getItemById, getCreatureIconId } from "../../stores/valheimDataStore";
import type { ItemType } from "../../data/valheim-items";

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

/** Renders a game icon with Lucide fallback. For creatures, falls back to the trophy icon before the lucide glyph. */
export function ItemIcon({
  id,
  type,
  size = 36,
  className = "",
}: {
  id: string;
  type?: ItemType;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const Icon = TYPE_ICONS[type || "Misc"] || Package;

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
    return (
      <Icon
        className={cn("text-zinc-400", className)}
        style={{ width: size * 0.5, height: size * 0.5 }}
      />
    );
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
