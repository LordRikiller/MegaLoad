import { create } from "zustand";
import type {
  MegaList,
  MegaListItem,
  MegaListBlob,
  MegaListFilterSnapshot,
} from "../types/megaList";
import {
  syncPushMegaLists,
  syncReconcileMegaLists,
} from "../lib/tauri-api";
import { useSyncStore } from "./syncStore";
import { debugLog, debugWarn } from "../lib/debug";

const STORAGE_KEY = "megaload_megalist_blob";
const PUSH_DEBOUNCE_MS = 2000;
const EPOCH = new Date(0).toISOString();

function loadDeviceId(): string {
  const key = "megaload_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `device-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function loadBlob(deviceId: string): MegaListBlob {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MegaListBlob;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.lists)) {
        return parsed;
      }
    }
  } catch (e) {
    debugWarn("MegaList: failed to parse stored blob", e);
  }
  return { version: 1, device_id: deviceId, updated_at: EPOCH, lists: [] };
}

function saveBlob(blob: MegaListBlob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch (e) {
    debugWarn("MegaList: failed to persist blob", e);
  }
}

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

let _pushTimer: ReturnType<typeof setTimeout> | null = null;

interface MegaListState {
  lists: MegaList[];
  updatedAt: string;
  deviceId: string;
  loaded: boolean;

  // Initial load (call once on app mount)
  init: () => void;
  // Remote reconcile — pull if remote newer, else schedule push.
  reconcile: () => Promise<void>;
  // Direct push — respects sync enabled; safe to call blind.
  pushNow: () => Promise<void>;
  // Debounced push — coalesces bursts of edits.
  schedulePush: () => void;

  // List CRUD
  createList: (name: string, items?: MegaListItem[], filterSnapshot?: MegaListFilterSnapshot) => string;
  renameList: (listId: string, name: string) => void;
  deleteList: (listId: string) => void;
  duplicateList: (listId: string) => string | null;

  // Item CRUD (within a list)
  addItems: (listId: string, itemIds: string[], source: MegaListItem["source"]) => number;
  removeItem: (listId: string, itemId: string) => void;
  toggleItem: (listId: string, itemId: string) => void;
  setChecked: (listId: string, itemIds: string[], checked: boolean) => void;
}

function buildBlob(state: MegaListState, deviceId: string): MegaListBlob {
  return {
    version: 1,
    device_id: deviceId,
    updated_at: state.updatedAt,
    lists: state.lists,
  };
}

function commit(
  set: (partial: Partial<MegaListState>) => void,
  get: () => MegaListState,
  mutator: (lists: MegaList[]) => MegaList[],
) {
  const next = mutator(get().lists);
  const updatedAt = nowIso();
  set({ lists: next, updatedAt });
  saveBlob(buildBlob({ ...get(), lists: next, updatedAt } as MegaListState, get().deviceId));
  get().schedulePush();
}

export const useMegaListStore = create<MegaListState>((set, get) => ({
  lists: [],
  updatedAt: EPOCH,
  deviceId: "",
  loaded: false,

  init: () => {
    if (get().loaded) return;
    const deviceId = loadDeviceId();
    const blob = loadBlob(deviceId);
    set({
      lists: blob.lists,
      updatedAt: blob.updated_at,
      deviceId,
      loaded: true,
    });
    debugLog(`MegaList: init — ${blob.lists.length} lists, updated_at ${blob.updated_at}`);
  },

  reconcile: async () => {
    if (!get().loaded) get().init();
    const syncEnabled = useSyncStore.getState().enabled;
    if (!syncEnabled) {
      debugLog("MegaList reconcile: cloud sync disabled — skip");
      return;
    }
    const local = buildBlob(get(), get().deviceId);
    try {
      const [winningJson, remoteWasNewer] = await syncReconcileMegaLists(JSON.stringify(local));
      if (remoteWasNewer) {
        const winning = JSON.parse(winningJson) as MegaListBlob;
        set({ lists: winning.lists, updatedAt: winning.updated_at });
        saveBlob(winning);
        debugLog(`MegaList reconcile: remote won (${winning.lists.length} lists)`);
      } else {
        // Local won — make sure remote gets it
        void get().pushNow();
      }
    } catch (e) {
      debugWarn("MegaList reconcile failed", e);
    }
  },

  pushNow: async () => {
    const syncEnabled = useSyncStore.getState().enabled;
    if (!syncEnabled) return;
    const blob = buildBlob(get(), get().deviceId);
    try {
      const pushed = await syncPushMegaLists(JSON.stringify(blob));
      debugLog(`MegaList push: ${pushed ? "uploaded" : "skipped (remote newer)"}`);
    } catch (e) {
      debugWarn("MegaList push failed", e);
    }
  },

  schedulePush: () => {
    const syncEnabled = useSyncStore.getState().enabled;
    const autoSync = useSyncStore.getState().autoSync;
    if (!syncEnabled || !autoSync) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      _pushTimer = null;
      void get().pushNow();
    }, PUSH_DEBOUNCE_MS);
  },

  // ── Lists ────────────────────────────────────────────────────────────────
  createList: (name, items = [], filterSnapshot) => {
    const id = uuid();
    const now = nowIso();
    const list: MegaList = {
      id,
      name: name.trim() || "Untitled list",
      createdAt: now,
      updatedAt: now,
      filterSnapshot,
      items,
    };
    commit(set, get, (lists) => [...lists, list]);
    debugLog(`MegaList: created list "${list.name}" (${items.length} items)`);
    return id;
  },

  renameList: (listId, name) => {
    commit(set, get, (lists) =>
      lists.map((l) =>
        l.id === listId ? { ...l, name: name.trim() || l.name, updatedAt: nowIso() } : l,
      ),
    );
  },

  deleteList: (listId) => {
    commit(set, get, (lists) => lists.filter((l) => l.id !== listId));
    debugLog(`MegaList: deleted list ${listId}`);
  },

  duplicateList: (listId) => {
    const src = get().lists.find((l) => l.id === listId);
    if (!src) return null;
    const id = uuid();
    const now = nowIso();
    const copy: MegaList = {
      ...src,
      id,
      name: `${src.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      items: src.items.map((it) => ({ ...it })),
    };
    commit(set, get, (lists) => [...lists, copy]);
    return id;
  },

  // ── Items ────────────────────────────────────────────────────────────────
  addItems: (listId, itemIds, source) => {
    let added = 0;
    commit(set, get, (lists) =>
      lists.map((l) => {
        if (l.id !== listId) return l;
        const existing = new Set(l.items.map((it) => it.itemId));
        const now = nowIso();
        const newItems = itemIds
          .filter((id) => !existing.has(id))
          .map<MegaListItem>((id) => ({ itemId: id, checked: false, addedAt: now, source }));
        added = newItems.length;
        if (added === 0) return l;
        return { ...l, items: [...l.items, ...newItems], updatedAt: now };
      }),
    );
    return added;
  },

  removeItem: (listId, itemId) => {
    commit(set, get, (lists) =>
      lists.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.filter((it) => it.itemId !== itemId), updatedAt: nowIso() }
          : l,
      ),
    );
  },

  toggleItem: (listId, itemId) => {
    commit(set, get, (lists) =>
      lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((it) =>
                it.itemId === itemId ? { ...it, checked: !it.checked } : it,
              ),
              updatedAt: nowIso(),
            }
          : l,
      ),
    );
  },

  setChecked: (listId, itemIds, checked) => {
    const set_ = new Set(itemIds);
    commit(set, get, (lists) =>
      lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((it) =>
                set_.has(it.itemId) ? { ...it, checked } : it,
              ),
              updatedAt: nowIso(),
            }
          : l,
      ),
    );
  },
}));
