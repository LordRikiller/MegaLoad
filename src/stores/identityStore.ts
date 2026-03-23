import { create } from "zustand";
import {
  getMegaloadIdentity,
  setMegaloadIdentity,
  checkUsernameAvailable,
  checkIsAdmin,
  checkUserBanned,
  type MegaLoadIdentity,
} from "../lib/tauri-api";

interface IdentityState {
  identity: MegaLoadIdentity | null;
  isAdmin: boolean;
  isBanned: boolean;
  loading: boolean;
  error: string | null;

  loadIdentity: () => Promise<void>;
  saveIdentity: (displayName: string) => Promise<void>;
  checkAvailable: (displayName: string) => Promise<boolean>;
  loadAdminStatus: () => Promise<void>;
  loadBanStatus: () => Promise<void>;
}

export const useIdentityStore = create<IdentityState>((set) => ({
  identity: null,
  isAdmin: false,
  isBanned: false,
  loading: false,
  error: null,

  loadIdentity: async () => {
    try {
      const identity = await getMegaloadIdentity();
      set({ identity });
    } catch {
      set({ identity: null });
    }
  },

  saveIdentity: async (displayName: string) => {
    set({ loading: true, error: null });
    try {
      const identity = await setMegaloadIdentity(displayName);
      set({ identity, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  checkAvailable: async (displayName: string) => {
    try {
      return await checkUsernameAvailable(displayName);
    } catch {
      return true; // If check fails (e.g. no network), allow attempt
    }
  },

  loadAdminStatus: async () => {
    try {
      const isAdmin = await checkIsAdmin();
      set({ isAdmin });
    } catch {
      set({ isAdmin: false });
    }
  },

  loadBanStatus: async () => {
    try {
      const isBanned = await checkUserBanned();
      set({ isBanned });
    } catch {
      set({ isBanned: false });
    }
  },
}));
