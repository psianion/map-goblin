// The crossing chips on the map: a kind's name and note where a token went over a raised
// edge, for four seconds (plan §7). A store rather than component state because the drag
// that raises them lives outside React.

import { create } from 'zustand';
import type { Crossing } from '@dnd/core/src/shared/plateaus';
import { chipWords } from './crossings';

/** How long a chip stays up. */
export const CHIP_MS = 4000;

export interface CrossingChip {
  id: number;
  /** The plateau crossed: a second crossing of it renews the chip instead of stacking. */
  targetId: string;
  x: number;
  y: number;
  title: string;
  note: string | null;
  refused: boolean;
  until: number;
}

interface ChipState {
  chips: CrossingChip[];
  show: (crossing: Crossing, refused: boolean, now?: number) => void;
  expire: (now?: number) => void;
}

let nextId = 1;

export const useCrossingChips = create<ChipState>()((set, get) => ({
  chips: [],
  show: (c, refused, now = Date.now()) => {
    const { title, note } = chipWords(c, refused);
    const chip: CrossingChip = {
      id: nextId++,
      targetId: c.targetId,
      x: c.position[0],
      y: c.position[1],
      title,
      note,
      refused,
      until: now + CHIP_MS,
    };
    set({ chips: [...get().chips.filter((k) => k.targetId !== c.targetId), chip] });
    setTimeout(() => get().expire(), CHIP_MS + 50);
  },
  expire: (now = Date.now()) => {
    const live = get().chips.filter((k) => k.until > now);
    if (live.length !== get().chips.length) set({ chips: live });
  },
}));
