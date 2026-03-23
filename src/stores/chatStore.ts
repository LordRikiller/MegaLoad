import { create } from "zustand";
import {
  chatSendMessage,
  chatGetUsage,
  chatGetDebugEnabled,
  chatSetDebugEnabled as apiSetDebug,
  chatLoadHistory,
  chatSaveHistory,
  type ChatMessage,
  type DailyUsage,
  type ChatHistoryMessage,
} from "../lib/tauri-api";
import { useModStore } from "./modStore";
import { usePlayerDataStore } from "./playerDataStore";
import { useProfileStore } from "./profileStore";
import { useAppUpdateStore } from "./appUpdateStore";
import { VALHEIM_ITEMS } from "../data/valheim-items";
import { VENDORS, PROCESSING_STATIONS } from "./valheimDataStore";

const MAX_HISTORY = 20;
const DAILY_TOKEN_LIMIT = 200_000;

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface ChatState {
  messages: DisplayMessage[];
  loading: boolean;
  error: string | null;
  usage: DailyUsage | null;
  debugEnabled: boolean;
  debugLoaded: boolean;
  historyLoaded: boolean;

  sendMessage: (userText: string) => Promise<void>;
  clearChat: () => void;
  fetchUsage: () => Promise<void>;
  fetchDebug: () => Promise<void>;
  setDebugEnabled: (enabled: boolean) => Promise<void>;
  loadHistory: () => Promise<void>;
}

function buildSystemPrompt(): string {
  const version = useAppUpdateStore.getState().currentVersion;
  const profile = useProfileStore.getState().activeProfile();
  const mods = useModStore.getState().mods;
  const player = usePlayerDataStore.getState();

  const sections: string[] = [];

  // ── Core identity ──
  sections.push(`You are MegaChat, the AI assistant built into MegaLoad v${version} — a Valheim mod manager.
You have FULL access to the Valheim item database and player character data below.
Answer questions about items, recipes, creatures, biomes, stats, crafting, character progress, and mod configuration.
Be helpful, concise, and friendly. Use markdown formatting.
When referencing items, use their exact names. When listing items, use tables or bullet points for readability.
You CAN and SHOULD look up data from the databases below to answer questions — that is your primary purpose.`);

  // ── Profile & mods ──
  if (profile) {
    sections.push(`Active profile: ${profile.name}`);
  }
  if (mods.length > 0) {
    const enabled = mods.filter((m) => m.enabled);
    sections.push(`Installed mods (${enabled.length} enabled): ${enabled.map((m) => `${m.name || m.file_name}${m.version ? ` v${m.version}` : ""}`).join(", ")}`);
  }

  // ── Player character data ──
  if (player.character) {
    sections.push(buildPlayerContext(player.character));
  }

  // ── Valheim item database (compact) ──
  sections.push(buildValheimDataContext());

  // ── Vendors ──
  sections.push(buildVendorContext());

  // ── Processing stations ──
  sections.push(buildProcessingContext());

  return sections.join("\n\n");
}

function buildPlayerContext(c: import("../lib/tauri-api").CharacterData): string {
  const lines: string[] = [`=== PLAYER CHARACTER: ${c.name} ===`];

  // Core stats
  lines.push(`HP: ${c.hp}/${c.max_hp} | Stamina: ${c.stamina} | Eitr: ${c.max_eitr}`);
  lines.push(`Kills: ${c.kills} | Deaths: ${c.deaths} | Crafts: ${c.crafts} | Builds: ${c.builds} | Boss Kills: ${c.boss_kills}`);
  if (c.guardian_power) lines.push(`Guardian Power: ${c.guardian_power}`);

  // Skills (all, sorted by level desc)
  if (c.skills.length > 0) {
    const sorted = [...c.skills].sort((a, b) => b.level - a.level);
    lines.push(`Skills: ${sorted.map((s) => `${s.name}:${Math.floor(s.level)}`).join(", ")}`);
  }

  // Known biomes
  if (c.known_biomes.length > 0) {
    lines.push(`Explored biomes: ${c.known_biomes.join(", ")}`);
  }

  // Inventory (equipped items first, then backpack)
  if (c.inventory.length > 0) {
    const equipped = c.inventory.filter((i) => i.equipped);
    const backpack = c.inventory.filter((i) => !i.equipped);
    if (equipped.length > 0) {
      lines.push(`Equipped: ${equipped.map((i) => `${i.name}${i.quality > 1 ? ` Q${i.quality}` : ""}`).join(", ")}`);
    }
    if (backpack.length > 0) {
      lines.push(`Inventory: ${backpack.map((i) => `${i.name}${i.stack > 1 ? ` x${i.stack}` : ""}${i.quality > 1 ? ` Q${i.quality}` : ""}`).join(", ")}`);
    }
  }

  // Active foods
  if (c.active_foods.length > 0) {
    lines.push(`Active foods: ${c.active_foods.map((f) => `${f.name} (HP+${f.health}, Stam+${f.stamina})`).join(", ")}`);
  }

  // Trophies
  if (c.trophies.length > 0) {
    lines.push(`Trophies (${c.trophies.length}): ${c.trophies.join(", ")}`);
  }

  // Known recipes count + materials
  if (c.known_recipes.length > 0) {
    lines.push(`Known recipes: ${c.known_recipes.length} total`);
  }
  if (c.known_materials.length > 0) {
    lines.push(`Known materials: ${c.known_materials.join(", ")}`);
  }

  // Known stations
  if (c.known_stations.length > 0) {
    lines.push(`Crafting stations: ${c.known_stations.map((s) => `${s.name} Lv${s.level}`).join(", ")}`);
  }

  return lines.join("\n");
}

function buildValheimDataContext(): string {
  const lines: string[] = [
    `=== VALHEIM ITEM DATABASE (${VALHEIM_ITEMS.length} items) ===`,
    `Format: Name | ID | Type | SubCat | Biomes | Station(Level) | Recipe | Stats`,
  ];

  for (const item of VALHEIM_ITEMS) {
    const biomes = item.biomes.length > 0 ? item.biomes.join(",") : "—";
    const station = item.station ? `${item.station}${item.stationLevel > 1 ? `(${item.stationLevel})` : ""}` : "—";

    const recipe = item.recipe.length > 0
      ? item.recipe.map((r) => `${r.amount} ${r.name}`).join("+")
      : "—";

    const stats = item.stats.length > 0
      ? item.stats.map((s) => `${s.label}:${s.value}`).join(",")
      : "";

    // Compact single-line format
    const parts = [item.name, item.id, item.type, item.subcategory, biomes, station, recipe];
    if (stats) parts.push(stats);
    lines.push(parts.join("|"));
  }

  return lines.join("\n");
}

function buildVendorContext(): string {
  const lines: string[] = ["=== VENDORS ==="];
  for (const vendor of Object.values(VENDORS)) {
    lines.push(`${vendor.name} (${vendor.biome}, ${vendor.location}):`);
    lines.push(`  Sells: ${vendor.sells.map((s) => {
      const item = VALHEIM_ITEMS.find((i) => i.id === s.id);
      const name = item?.name || s.id;
      return `${name} ${s.price}c${s.requirement ? ` [${s.requirement}]` : ""}`;
    }).join(", ")}`);
    if (vendor.buys.length > 0) {
      lines.push(`  Buys: ${vendor.buys.map((b) => {
        const item = VALHEIM_ITEMS.find((i) => i.id === b.id);
        return `${item?.name || b.id} ${b.sellPrice}c`;
      }).join(", ")}`);
    }
  }
  return lines.join("\n");
}

function buildProcessingContext(): string {
  const lines: string[] = ["=== PROCESSING STATIONS ==="];
  for (const ps of Object.values(PROCESSING_STATIONS)) {
    const fuel = ps.fuel ? ` (Fuel: ${ps.fuel})` : "";
    lines.push(`${ps.name}${fuel} [${ps.biome}]: ${ps.description}`);
    if (ps.conversions.length > 0) {
      lines.push(`  Conversions: ${ps.conversions.map((c) => `${c.inputName} → ${c.outputName}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  error: null,
  usage: null,
  debugEnabled: false,
  debugLoaded: false,
  historyLoaded: false,

  sendMessage: async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed || get().loading) return;

    const userMsg: DisplayMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      loading: true,
      error: null,
    }));

    try {
      // Build API messages from history (last N)
      const allMsgs = [...get().messages];
      const recent = allMsgs.slice(-MAX_HISTORY);
      const apiMessages: ChatMessage[] = recent.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const systemContext = buildSystemPrompt();
      const response = await chatSendMessage(apiMessages, systemContext);

      const assistantMsg: DisplayMessage = {
        id: makeId(),
        role: "assistant",
        content: response.text,
        timestamp: new Date().toISOString(),
        inputTokens: response.input_tokens,
        outputTokens: response.output_tokens,
      };

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        loading: false,
        usage: response.daily_usage,
      }));

      // Sync chat history to server (best effort, don't block)
      const allMessages = get().messages;
      const historyMessages: ChatHistoryMessage[] = allMessages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        input_tokens: m.inputTokens,
        output_tokens: m.outputTokens,
      }));
      chatSaveHistory(historyMessages).catch(() => {});
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  clearChat: () => {
    set({ messages: [], error: null });
    // Clear server history too (save empty)
    chatSaveHistory([]).catch(() => {});
  },

  fetchUsage: async () => {
    try {
      const usage = await chatGetUsage();
      set({ usage });
    } catch {
      // silent
    }
  },

  fetchDebug: async () => {
    try {
      const enabled = await chatGetDebugEnabled();
      set({ debugEnabled: enabled, debugLoaded: true });
    } catch {
      set({ debugLoaded: true });
    }
  },

  setDebugEnabled: async (enabled: boolean) => {
    await apiSetDebug(enabled);
    set({ debugEnabled: enabled });
  },

  loadHistory: async () => {
    if (get().historyLoaded) return;
    try {
      const history = await chatLoadHistory();
      if (history.messages.length > 0) {
        const messages: DisplayMessage[] = history.messages.map((m) => ({
          id: makeId(),
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: m.timestamp,
          inputTokens: m.input_tokens,
          outputTokens: m.output_tokens,
        }));
        set({ messages, historyLoaded: true });
      } else {
        set({ historyLoaded: true });
      }
    } catch {
      set({ historyLoaded: true });
    }
  },
}));

export { DAILY_TOKEN_LIMIT };
