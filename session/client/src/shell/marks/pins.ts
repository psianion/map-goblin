import { create } from 'zustand';

/** A pin on the map (4.3 `pins`: persisted per scene once the module lands; this seat only until then). */
export interface Pin {
  id: string;
  x: number;
  y: number;
  text: string;
  dmOnly: boolean;
}

interface PinsStore {
  pins: Pin[];
  add: (pin: Pin) => void;
  update: (id: string, patch: Partial<Omit<Pin, 'id'>>) => void;
  remove: (id: string) => void;
}

export const useLocalPins = create<PinsStore>()((set, get) => ({
  pins: [],
  add: (pin) => set({ pins: [...get().pins, pin] }),
  update: (id, patch) => set({ pins: get().pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
  remove: (id) => set({ pins: get().pins.filter((p) => p.id !== id) }),
}));
