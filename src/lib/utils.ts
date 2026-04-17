import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Display-name formatter: turns our single-word mod names (e.g. "MegaFishing",
// "MegaFood") into the canonical two-word form ("Mega Fishing", "Mega Food").
// Only reshapes names that start with "Mega" followed by an uppercase letter,
// so third-party mods (MistBeGone, PerfectPlacement) stay untouched.
export function formatModName(name: string): string {
  if (!name) return name;
  if (!name.startsWith("Mega")) return name;
  if (name.startsWith("Mega ")) return name;
  const rest = name.slice(4);
  if (rest.length === 0) return name;
  const first = rest[0];
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return name;
  return "Mega " + rest;
}
