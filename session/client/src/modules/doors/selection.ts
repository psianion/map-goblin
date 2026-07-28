import { create } from 'zustand';

/**
 * Which door the panel is talking about. Shared between the Pixi layer (outside React) and
 * the panel, the same way `useTokenInteraction` is — zustand is already here.
 */
interface DoorSelection {
  selectedId: string | null;
  select: (id: string | null) => void;
}

export const useDoorSelection = create<DoorSelection>()((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
}));
