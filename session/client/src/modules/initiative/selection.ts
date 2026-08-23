import { create } from 'zustand';

/**
 * Local-only state the panel body and its footer (siblings under `Popover`, not
 * parent/child) both need: which row's bookkeeping line is open, and which idle-state
 * candidates the DM has checked. Same reason `useDoorSelection` exists — zustand is
 * already here for exactly this shape of problem.
 */
interface InitiativeSelection {
  selectedKey: string | null;
  select: (key: string | null) => void;
  /** Overrides on top of "every claimed token is in, no unclaimed one is" — see `combatantCandidates`. */
  picked: Record<string, boolean>;
  togglePicked: (tokenId: string, defaultChecked: boolean) => void;
}

export const useInitiativeSelection = create<InitiativeSelection>()((set, get) => ({
  selectedKey: null,
  select: (selectedKey) => set({ selectedKey }),
  picked: {},
  togglePicked: (tokenId, defaultChecked) =>
    set({ picked: { ...get().picked, [tokenId]: !(get().picked[tokenId] ?? defaultChecked) } }),
}));
