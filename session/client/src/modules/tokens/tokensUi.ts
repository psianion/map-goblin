// M3 — UI-only state and style atoms shared across the Tokens popover's pieces
// (`TokenPanel.tsx`, `TokenLibraryPanel.tsx`) and, for the atoms, `TokenMenu.tsx` too.
//
// Kept out of the component files on purpose (same reason `drag.ts` and the Doors module's
// `selection.ts` are their own files rather than living inside a panel): a file that mixes
// component exports with hook/object/function exports breaks Fast Refresh's ability to
// hot-reload just the component (`react-refresh/only-export-components`), and it also
// sidesteps the import cycle a "base module" pattern would otherwise risk between the two
// panel files, which both need these.

import { create } from 'zustand'
import type { Disposition } from '@dnd/mechanics/tokens'

type TokensTab = 'map' | 'library'

interface TokensUi {
  tab: TokensTab
  setTab: (tab: TokensTab) => void
  mapFilter: string
  setMapFilter: (value: string) => void
  /** Whether the selected row's full detail block is open once the list has passed the
   *  collapse threshold; below it the full block always shows. Reset on every new selection
   *  (see the effect in `TokenPanel.tsx`'s `OnMapTab`) so picking a different row never
   *  inherits it open. */
  detailExpanded: boolean
  setDetailExpanded: (value: boolean) => void
}

// ponytail: module-level zustand, same shape as `useTokenInteraction` — the tab and the
// footer are two components, not one (see `Popover.tsx`'s `PanelDef.footer` slot), so this
// cannot be a `useState` either owns.
export const useTokensUi = create<TokensUi>()((set) => ({
  tab: 'map',
  setTab: (tab) => set({ tab }),
  mapFilter: '',
  setMapFilter: (mapFilter) => set({ mapFilter }),
  detailExpanded: false,
  setDetailExpanded: (detailExpanded) => set({ detailExpanded }),
}))

/**
 * The Library tab's own UI: which def (if any) has its form open, and the filter text past
 * the ledger's threshold. A store rather than local state because the tab's footer (a
 * sibling `PanelDef.footer` component, not a child) needs the same "open a blank form"
 * action `TokenPanel.tsx`'s footer wires to its "New token" button.
 */
interface TokenLibraryUi {
  filter: string
  setFilter: (value: string) => void
  /** 'new' for a blank def, a real id to edit one, null when the form is closed. */
  editingId: string | null
  openNew: () => void
  openEdit: (id: string) => void
  close: () => void
}

export const useTokenLibraryUi = create<TokenLibraryUi>()((set) => ({
  filter: '',
  setFilter: (filter) => set({ filter }),
  editingId: null,
  openNew: () => set({ editingId: 'new' }),
  openEdit: (id) => set({ editingId: id }),
  close: () => set({ editingId: null }),
}))

/** M3 no-scroll ledger — Tokens · On map. */
export const MAP_ROW_CAP = 20
export const MAP_FILTER_AT = 21
export const MAP_DETAIL_COLLAPSE_AT = 13

/** M3 no-scroll ledger — Tokens · Library. */
export const LIBRARY_ROW_CAP = 16
export const LIBRARY_FILTER_AT = 17

export const DOT_CLASS: Record<Disposition, string> = {
  friendly: 'bg-info',
  hostile: 'bg-danger',
  neutral: 'bg-text-muted',
}

export const buttonClass =
  'h-7 shrink-0 rounded border border-border-default bg-surface-2 px-2.5 text-xs text-text-primary transition-colors duration-150 ease-settle hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40'
export const ghostButtonClass =
  'h-7 shrink-0 rounded border border-transparent bg-transparent px-2.5 text-xs text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40'
export const ghostDangerButtonClass =
  'h-7 shrink-0 rounded border border-transparent bg-transparent px-2.5 text-xs text-danger transition-colors duration-150 ease-settle hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40'
export const armedButtonClass =
  'h-7 shrink-0 rounded border border-accent-active bg-surface-3 px-2.5 text-xs text-accent-active transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none'
export const quietButtonClass =
  'shrink-0 rounded-chip border border-border-default px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none'
export const filterInputClass =
  'h-7 shrink-0 rounded border border-border-default bg-surface-0 px-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none'
