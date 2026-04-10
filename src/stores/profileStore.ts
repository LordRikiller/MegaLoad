import { create } from "zustand";
import {
  getProfiles,
  createProfile as apiCreateProfile,
  createProfileLinked as apiCreateProfileLinked,
  deleteProfile as apiDeleteProfile,
  setActiveProfile as apiSetActive,
  renameProfile as apiRename,
  type Profile,
  type ProfileStore as ApiProfileStore,
} from "../lib/tauri-api";
import { useSyncStore } from "./syncStore";

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  loading: boolean;
  error: string | null;
  fetchProfiles: () => Promise<void>;
  createProfile: (name: string) => Promise<Profile>;
  createProfileLinked: (name: string, bepinexPath: string) => Promise<Profile>;
  deleteProfile: (id: string) => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  renameProfile: (id: string, newName: string) => Promise<void>;
  activeProfile: () => Profile | undefined;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  loading: false,
  error: null,

  fetchProfiles: async () => {
    set({ loading: true, error: null });
    try {
      const store: ApiProfileStore = await getProfiles();
      set({
        profiles: store.profiles,
        activeProfileId: store.active_profile,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createProfile: async (name: string) => {
    const profile = await apiCreateProfile(name);
    await get().fetchProfiles();
    useSyncStore.getState().triggerAutoSync();
    return profile;
  },

  createProfileLinked: async (name: string, bepinexPath: string) => {
    const profile = await apiCreateProfileLinked(name, bepinexPath);
    await get().fetchProfiles();
    useSyncStore.getState().triggerAutoSync();
    return profile;
  },

  deleteProfile: async (id: string) => {
    await apiDeleteProfile(id);
    await get().fetchProfiles();
    useSyncStore.getState().triggerAutoSync();
  },

  setActiveProfile: async (id: string) => {
    await apiSetActive(id);
    set({ activeProfileId: id });
    useSyncStore.getState().triggerAutoSync();
  },

  renameProfile: async (id: string, newName: string) => {
    await apiRename(id, newName);
    await get().fetchProfiles();
    useSyncStore.getState().triggerAutoSync();
  },

  activeProfile: () => {
    const { profiles, activeProfileId } = get();
    return profiles.find((p) => p.id === activeProfileId);
  },
}));
