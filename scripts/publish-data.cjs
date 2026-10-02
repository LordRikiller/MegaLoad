/**
 * Publish src/data/valheim-items.ts AND src/data/valheim-meta.ts to MegaWorker
 * so live MegaLoad/MegaApp clients pick both up on their next 15-min poll (no
 * installer rebuild required). The meta carries the filters (facets), rollup
 * rules and factory tables, so those go live the same way the items do.
 *
 * Usage:
 *   node scripts/publish-data.cjs
 *   node scripts/publish-data.cjs --dry-run    # parse + summarise, no upload
 *
 * Requires:
 *   ~/.megaload/megabugs-admin.key  — admin HMAC base (already on Milord's machine)
 *
 * What it does:
 *   1. Reads src/data/valheim-items.ts, extracts the VALHEIM_ITEMS array literal.
 *   2. Reads src/data/valheim-meta.ts, extracts the BUNDLED_VALHEIM_META object.
 *   3. JSON.parses both (any syntax drift fails loud here, never reaches the Worker).
 *   4. HMAC-admin-signs a PUT of each to https://mega-api.lordrik.workers.dev/data/.
 *   5. Worker validates, stamps a new version (YYYY-MM-DD-NNN), stores in KV.
 *   6. Prints the new versions + sizes so you can confirm before users see them.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const WORKER_URL = process.env.MEGA_WORKER_URL || "https://mega-api.lordrik.workers.dev";
const ENDPOINT = "/data/valheim-items.json";
const META_ENDPOINT = "/data/valheim-meta.json";
const ADMIN_KEY_PATH = path.join(os.homedir(), ".megaload", "megabugs-admin.key");
const DATA_FILE = path.join(__dirname, "..", "src", "data", "valheim-items.ts");
const META_FILE = path.join(__dirname, "..", "src", "data", "valheim-meta.ts");

const dryRun = process.argv.includes("--dry-run");

function extractItemsArray(tsSource) {
  // The generated file ends with `export const VALHEIM_ITEMS: ValheimItem[] = [...];`.
  // Skip past the `=` so we don't match the `[]` in the `ValheimItem[]` type annotation.
  const open = tsSource.indexOf("export const VALHEIM_ITEMS");
  if (open < 0) throw new Error("VALHEIM_ITEMS export not found");
  const eq = tsSource.indexOf("=", open);
  if (eq < 0) throw new Error("Assignment = not found after VALHEIM_ITEMS");
  const bracketOpen = tsSource.indexOf("[", eq);
  if (bracketOpen < 0) throw new Error("Opening [ not found after VALHEIM_ITEMS =");
  // Find the matching closing `];` by scanning forward — bracket depth aware so a
  // stray `]` inside a string literal doesn't trip us. Cheap state machine.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = bracketOpen; i < tsSource.length; i++) {
    const c = tsSource[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return tsSource.slice(bracketOpen, i + 1);
    }
  }
  throw new Error("Unbalanced brackets — couldn't find end of VALHEIM_ITEMS array");
}

function extractMeta(tsSource) {
  // `export const BUNDLED_VALHEIM_META: ValheimMeta = { ... };` — a pure JSON body.
  const open = tsSource.indexOf("export const BUNDLED_VALHEIM_META");
  if (open < 0) throw new Error("BUNDLED_VALHEIM_META export not found");
  const brace = tsSource.indexOf("{", tsSource.indexOf("=", open));
  const end = tsSource.lastIndexOf("}");
  if (brace < 0 || end < brace) throw new Error("Couldn't find the meta object literal");
  const meta = JSON.parse(tsSource.slice(brace, end + 1));
  if (typeof meta.schema !== "number") throw new Error("Meta has no numeric schema");
  return meta;
}

async function put(endpoint, body, adminKey) {
  const tsHeader = Math.floor(Date.now() / 1000).toString();
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const stringToSign = `PUT\n${endpoint}\n${tsHeader}\n${bodyHash}`;
  const sig = crypto.createHmac("sha256", adminKey).update(stringToSign).digest("hex");

  console.log(`PUT ${WORKER_URL}${endpoint}`);
  const resp = await fetch(`${WORKER_URL}${endpoint}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-MegaLoad-Timestamp": tsHeader,
      "X-MegaLoad-Admin-Sig": sig,
    },
    body,
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error(`Worker rejected ${endpoint} (${resp.status}): ${text}`);
    process.exit(1);
  }
  return JSON.parse(text);
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) throw new Error(`Missing ${DATA_FILE}`);
  const ts = fs.readFileSync(DATA_FILE, "utf-8");
  const arrayLiteral = extractItemsArray(ts);

  // Parse to validate + re-serialise without TS comments / @ts-nocheck noise.
  let items;
  try {
    items = JSON.parse(arrayLiteral);
  } catch (e) {
    throw new Error(`Array literal isn't valid JSON: ${e.message}`);
  }
  if (!Array.isArray(items)) throw new Error("Parsed value is not an array");

  const body = JSON.stringify(items);
  console.log(`Parsed ${items.length} items → ${(body.length / 1024).toFixed(1)} KB payload`);

  if (!fs.existsSync(META_FILE)) throw new Error(`Missing ${META_FILE} — re-run convert-dump.cjs`);
  const meta = extractMeta(fs.readFileSync(META_FILE, "utf-8"));
  const metaBody = JSON.stringify(meta);
  console.log(`Parsed meta schema ${meta.schema}: ${meta.facets.length} facets, ${meta.processingStations.length} processing stations → ${(metaBody.length / 1024).toFixed(1)} KB`);

  if (dryRun) {
    console.log("Dry run — skipping upload.");
    return;
  }

  if (!fs.existsSync(ADMIN_KEY_PATH)) {
    throw new Error(`Admin key not found at ${ADMIN_KEY_PATH} — can't sign`);
  }
  const adminKey = fs.readFileSync(ADMIN_KEY_PATH, "utf-8").trim();
  if (!adminKey) throw new Error("Admin key file is empty");

  const result = await put(ENDPOINT, body, adminKey);
  const metaResult = await put(META_ENDPOINT, metaBody, adminKey);

  console.log("Published:");
  console.log(`  version    : ${result.version}`);
  console.log(`  etag       : ${result.etag.slice(0, 16)}…`);
  console.log(`  size       : ${result.size} bytes`);
  console.log(`  items      : ${result.items}`);
  console.log(`  updated_at : ${result.updated_at}`);
  console.log(`  meta       : ${metaResult.version} (${metaResult.size} bytes)`);
  console.log("");
  console.log(`Live at: ${WORKER_URL}${ENDPOINT}`);
  console.log(`         ${WORKER_URL}${META_ENDPOINT}`);
  console.log("Clients on a remote-data-aware build pick this up within ~15 min.");
}

main().catch((e) => {
  console.error("Publish failed:", e.message || e);
  process.exit(1);
});
