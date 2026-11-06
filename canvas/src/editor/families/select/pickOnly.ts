// Pick only: which kinds a box select grabs. The Select tool already asks the marquee
// filter (core marqueeFilter.ts) for kinds when `ui.marqueeFilter` is 'tab'; here the
// chips are that provider. No chip on (All) is the filter off. The chips last the session.

import { z } from 'zod';
import { setMarqueeKinds } from '@dnd/core/src/engine/marqueeFilter';
import type { SelectionKind } from '@dnd/core/src/store/selectionResolve';
import type { Binding, CoreStore } from '@/editor/registry/types';

/** The chips after All, in order, and the kinds each lets a box grab. */
export const PICK_CHIPS = [
  { id: 'floors', label: 'Floors', kinds: ['shape', 'plateau'] },
  { id: 'walls', label: 'Walls', kinds: ['wall'] },
  { id: 'doors', label: 'Doors', kinds: ['door'] },
  { id: 'props', label: 'Props', kinds: ['asset'] },
  { id: 'lights', label: 'Lights', kinds: ['light'] },
  { id: 'labels', label: 'Labels', kinds: ['text'] },
  { id: 'zones', label: 'Zones', kinds: ['zone'] },
] as const satisfies readonly { id: string; label: string; kinds: readonly SelectionKind[] }[];

export type PickChip = (typeof PICK_CHIPS)[number]['id'];
const CHIP_IDS = PICK_CHIPS.map((c) => c.id) as [PickChip, ...PickChip[]];

let picked: PickChip[] = [];

/** The kinds the chips on let a box grab, or null for everything. */
export function pickOnlyKinds(chips: readonly PickChip[]): SelectionKind[] | null {
  if (chips.length === 0) return null;
  return PICK_CHIPS.filter((c) => chips.includes(c.id)).flatMap((c) => [...c.kinds]);
}

function write(store: CoreStore, chips: PickChip[]): void {
  picked = chips;
  // The marquee asks this on release while the filter is on.
  setMarqueeKinds(() => pickOnlyKinds(picked));
  const filter = chips.length > 0 ? 'tab' : 'all';
  if (store.getState().ui.marqueeFilter !== filter) store.getState().setMarqueeFilter(filter);
  // The chips live here, so a change the filter does not see still re-renders the panel.
  else store.setState({});
}

const NONE: PickChip[] = [];

/** Where the chips' value lives; the setting itself is defined with the tool. */
export const pickOnlyBinding: Binding<PickChip[]> = {
  // A filter left at 'tab' by the old status bar chip, with no chips on, is everything.
  read: (s) => (s.ui.marqueeFilter === 'all' ? NONE : picked),
  write,
};

export const pickOnlySchema = z.array(z.enum(CHIP_IDS));
