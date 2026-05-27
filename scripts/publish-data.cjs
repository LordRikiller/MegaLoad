/**
 * Publish src/data/valheim-items.ts to MegaWorker so live MegaLoad/MegaApp
 * clients pick it up on their next 15-min poll (no installer rebuild required).
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
 *   2. JSON.parses it (any syntax drift fails loud here, never reaches the Worker).
 *   3. HMAC-admin-signs a PUT to https://mega-api.lordrik.workers.dev/data/valheim-items.json.
 *   4. Worker validates, stamps a new version (YYYY-MM-DD-NNN), stores in KV.
 *   5. Prints the new version + size so you can confirm before users see it.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const WORKER_URL = process.env.MEGA_WORKER_URL || "https://mega-api.lordrik.workers.dev";
const ENDPOINT = "/data/valheim-items.json";
const ADMIN_KEY_PATH = path.join(os.homedir(), ".megaload", "megabugs-admin.key");
const DATA_FILE = path.join(__dirname, "..", "src", "data", "valheim-items.ts");

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
  const sizeKB = (body.length / 1024).toFixed(1);
  console.log(`Parsed ${items.length} items → ${sizeKB} KB payload`);

  if (dryRun) {
    console.log("Dry run — skipping upload.");
    return;
  }

  if (!fs.existsSync(ADMIN_KEY_PATH)) {
    throw new Error(`Admin key not found at ${ADMIN_KEY_PATH} — can't sign`);
  }
  const adminKey = fs.readFileSync(ADMIN_KEY_PATH, "utf-8").trim();
  if (!adminKey) throw new Error("Admin key file is empty");

  const tsHeader = Math.floor(Date.now() / 1000).toString();
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const stringToSign = `PUT\n${ENDPOINT}\n${tsHeader}\n${bodyHash}`;
  const sig = crypto.createHmac("sha256", adminKey).update(stringToSign).digest("hex");

  console.log(`PUT ${WORKER_URL}${ENDPOINT}`);
  const resp = await fetch(`${WORKER_URL}${ENDPOINT}`, {
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
    console.error(`Worker rejected (${resp.status}): ${text}`);
    process.exit(1);
  }

  const result = JSON.parse(text);
  console.log("Published:");
  console.log(`  version    : ${result.version}`);
  console.log(`  etag       : ${result.etag.slice(0, 16)}…`);
  console.log(`  size       : ${result.size} bytes`);
  console.log(`  items      : ${result.items}`);
  console.log(`  updated_at : ${result.updated_at}`);
  console.log("");
  console.log(`Live at: ${WORKER_URL}${ENDPOINT}`);
  console.log("Clients on a remote-data-aware build pick this up within ~15 min.");
}

main().catch((e) => {
  console.error("Publish failed:", e.message || e);
  process.exit(1);
});
