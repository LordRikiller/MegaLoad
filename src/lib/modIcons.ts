import {
  Package,
  Shovel,
  Anchor,
  Utensils,
  Crosshair,
  Sparkles,
  Boxes,
  Fish,
  Factory,
  Gamepad2,
  Hammer,
  Bone,
  Sprout,
  type LucideIcon,
} from "lucide-react";

// Lookup by lowercased mod name (folder/file stem). Falls back to Package
// for unknown mods (community installs etc).
export const MOD_ICONS: Record<string, LucideIcon> = {
  megahoe: Shovel,
  megamegingjord: Anchor,
  megafood: Utensils,
  megashot: Crosshair,
  megaqol: Sparkles,
  megastuff: Boxes,
  megafishing: Fish,
  megafactory: Factory,
  megatrainer: Gamepad2,
  megabuilder: Hammer,
  megaskeletons: Bone,
  megafarming: Sprout,
};

export function iconForMod(folder: string | null | undefined, fileName: string): LucideIcon {
  const stem = (folder || fileName.replace(/\.dll$/i, "")).toLowerCase();
  return MOD_ICONS[stem] ?? Package;
}

export function iconForModName(name: string): LucideIcon {
  return MOD_ICONS[name.toLowerCase()] ?? Package;
}
