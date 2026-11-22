// "As players see it": the DM's own tab drawing the fog the way a player's does — the cloud
// solid, the scrim on, and tokens under fog hidden. Local to this tab; nothing reaches the wire.

import { create } from 'zustand';

interface AsPlayersStore {
  on: boolean;
  set: (on: boolean) => void;
}

export const useAsPlayers = create<AsPlayersStore>()((set) => ({
  on: false,
  set: (on) => set({ on }),
}));

export const toggleAsPlayers = (): void => useAsPlayers.getState().set(!useAsPlayers.getState().on);
