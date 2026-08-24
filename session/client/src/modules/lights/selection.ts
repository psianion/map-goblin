import { create } from 'zustand';

/**
 * Which light the on-map popover is talking about — same shape as `useDoorSelection`
 * (`doors/selection.ts`), and for the same reason: the Pixi-side click handler
 * (`LightEditor.ts`) and the React-side popover (`LightPopover.tsx`) need one shared answer
 * to "what's selected" without either owning the other.
 */
interface LightSelection {
  selectedId: string | null;
  select: (id: string | null) => void;
}

export const useLightSelection = create<LightSelection>()((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
}));
