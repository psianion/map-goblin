import { create } from 'zustand';

/**
 * Which door the panel is talking about. Shared between the Pixi layer (outside React) and
 * the panel, the same way `useTokenInteraction` is — zustand is already here.
 */
interface DoorSelection {
  selectedId: string | null;
  select: (id: string | null) => void;
  /**
   * The popover's own filter text (M3: the ceiling's filter field). Lives here, not as
   * `DoorPanel` component state, so the on-map menu can read it too — it is how `DoorMenu`
   * tells whether the panel is already showing the selected door's chip, or whether a
   * densified/filtered popover has scrolled it out of view and the menu owes its own.
   */
  filter: string;
  setFilter: (filter: string) => void;
}

export const useDoorSelection = create<DoorSelection>()((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
  filter: '',
  setFilter: (filter) => set({ filter }),
}));
