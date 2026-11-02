// The DM's crossing picker on the map: which raised edge or opening a right-click landed on.
import { create } from 'zustand';
import type { CrossingTarget } from './crossings';

interface CrossingMenuState {
  target: CrossingTarget | null;
  open: (target: CrossingTarget | null) => void;
}

export const useCrossingMenu = create<CrossingMenuState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
}));
