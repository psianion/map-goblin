import type { ComponentType } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';
import { create } from 'zustand';

/**
 * The right column's sheets: Room key, Handout, Token type, Character, Party, Log, Shortcuts.
 * One open at a time. A sheet component renders its own `SheetFrame` and gets the props it
 * was opened with; closing goes through `closeSheet`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SheetDef<P = any> {
  id: string;
  Component: ComponentType<P>;
  /** Roles that may open it; every role when absent. */
  roles?: readonly Role[];
}

const sheets = new Map<string, SheetDef>();

/** Register a sheet; the same id again replaces it. */
export function registerSheet<P>(def: SheetDef<P>): void {
  sheets.set(def.id, def as SheetDef);
}

export function sheetDef(id: string): SheetDef | undefined {
  return sheets.get(id);
}

export interface OpenSheet {
  id: string;
  props: Record<string, unknown>;
}

const useSheetStore = create<{ open: OpenSheet | null }>()(() => ({ open: null }));

/** Open a sheet, replacing whichever was open. */
export function openSheet(id: string, props: Record<string, unknown> = {}): void {
  useSheetStore.setState({ open: { id, props } });
}

/** Open, or close when this sheet is the one already up (a tab button's click). */
export function toggleSheet(id: string, props: Record<string, unknown> = {}): void {
  const open = useSheetStore.getState().open;
  if (open?.id === id) closeSheet();
  else openSheet(id, props);
}

export function closeSheet(): void {
  useSheetStore.setState({ open: null });
}

/** The open sheet, live. */
export function useSheet(): OpenSheet | null {
  return useSheetStore((s) => s.open);
}

/** The open sheet, for non-React callers (the Esc ladder). */
export const openSheetNow = (): OpenSheet | null => useSheetStore.getState().open;
