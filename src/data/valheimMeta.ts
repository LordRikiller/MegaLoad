// ── Live Valheim meta ────────────────────────────────────────
// Filters (facets), rollup rules and factory tables that used to be hard-coded
// in each app's store. convert-dump.cjs generates them beside the items and
// publish-data.cjs pushes them to /data/valheim-meta.json, so a new filter or a
// corrected factory reaches MegaLoad and MegaApp without an app release.
// valheim-meta.ts is the bundled offline fallback.
//
// Shared verbatim with MegaApp (src/data/valheimMeta.ts) — keep them identical.

import { BUNDLED_VALHEIM_META } from "./valheim-meta";

/** Highest meta schema this build understands. A remote payload with a higher
 *  schema is ignored (bundled/cached meta stays) until the app is updated. */
export const META_SCHEMA = 1;

export interface FacetValue {
  value: string;
  label: string;
  color?: string; // hex — rendered as text colour in both apps
  hint?: string;
}

/** A filter group. Matches items whose `field` (string or string[]) holds any
 *  selected value; separate facets combine with AND. */
export interface Facet {
  id: string;
  title: string;
  field: string;
  values: FacetValue[];
}

export interface MetaConversion {
  inputId: string;
  inputName: string;
  outputId: string;
  outputName: string;
  inputAmount?: number;
  outputAmount?: number;
}

export interface MetaProcessingStation {
  name: string;
  prefab: string;
  description: string;
  biome: string;
  icon?: string;
  fuels?: Array<{ name: string; id: string }>;
  conversions: MetaConversion[];
}

export interface ValheimMeta {
  schema: number;
  generated?: string;
  facets: Facet[];
  rollup: {
    oneOfRecipes: string[]; // "any one of N" recipes (Raw Fish) — stop the raw expansion
    excludeTags: string[];  // tagged items stay out of rollups unless their facet value is on
  };
  processingStations: MetaProcessingStation[];
}

let current: ValheimMeta = BUNDLED_VALHEIM_META;

export function getValheimMeta(): ValheimMeta {
  return current;
}

/** Shape + schema check. Anything off and we keep what we have. */
export function isUsableMeta(m: unknown): m is ValheimMeta {
  if (!m || typeof m !== "object") return false;
  const x = m as Partial<ValheimMeta>;
  return typeof x.schema === "number"
    && x.schema <= META_SCHEMA
    && Array.isArray(x.facets)
    && !!x.rollup && Array.isArray(x.rollup.oneOfRecipes) && Array.isArray(x.rollup.excludeTags)
    && Array.isArray(x.processingStations);
}

/** Swap in a fetched meta. Returns false (and changes nothing) if unusable. */
export function replaceValheimMeta(m: unknown): boolean {
  if (!isUsableMeta(m)) return false;
  current = m;
  return true;
}

/** An item's values for a facet field, as a list (string fields → [value]). */
export function facetValuesOf(item: object, field: string): string[] {
  const v = (item as Record<string, unknown>)[field];
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}
