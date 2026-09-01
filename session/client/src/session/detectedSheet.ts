// The Beyond20 bridge stashes the latest sheet it saw here; `SheetLinkPrompt` reads it. A
// store rather than a prop or an event because the two live in unrelated trees — a module
// listener at the document level and a card mounted near the top of `GameTable` — same reason
// `shell/logFeed.ts`'s `useLogSeen` is a tiny module-scope zustand store instead of state
// either side owns.

import { create } from 'zustand';

/** Display/link data only, matched to `@dnd/mechanics/tokens`' `Token['sheet']` shape —
 *  untrusted, never re-derived from or used for anything else. */
export interface DetectedSheet {
  name: string;
  id?: string;
  url?: string;
  avatar?: string;
}

interface DetectedSheetStore {
  /** The most recently detected sheet. Latest wins — the prompt always offers whichever sheet
   *  is open on D&D Beyond right now, not the first one seen this session. Stash only: nothing
   *  here ever sends a command on its own, binding is always the player clicking "Link". */
  sheet: DetectedSheet | null;
  stash: (sheet: DetectedSheet) => void;
  /** Per-tab "Not now", keyed by `sheetKey` below — dismissing one detected sheet must not
   *  hide the prompt for a different one detected later in the same tab. */
  dismissed: Set<string>;
  dismiss: (key: string) => void;
}

export const useDetectedSheet = create<DetectedSheetStore>()((set) => ({
  sheet: null,
  stash: (sheet) => set({ sheet }),
  dismissed: new Set(),
  dismiss: (key) => set((s) => ({ dismissed: new Set(s.dismissed).add(key) })),
}));

/** The stable key a sheet is dismissed by — its own id when it has one, else its name. */
export const sheetKey = (sheet: DetectedSheet): string => sheet.id ?? sheet.name;
