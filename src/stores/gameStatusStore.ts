import { create } from "zustand";
import type { GameStatus } from "../lib/tauri-api";

interface GameStatusState {
  status: GameStatus | null;
  setStatus: (s: GameStatus | null) => void;
}

export const useGameStatusStore = create<GameStatusState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));
