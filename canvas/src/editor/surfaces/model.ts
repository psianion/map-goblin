// Pure helpers the surfaces share: how a number reads, which verbs apply now.

import { useStore } from '@/store/store';
import type { CardFieldDef, SettingMeta, Verb } from '@/editor/registry';

/** How a number reads beside its label: 0..1 with unit % as a percentage, else value and unit. */
export function formatValue(meta: SettingMeta<unknown>, v: number): string {
  const unit = meta.range?.unit;
  if (unit === '%') return `${Math.round((meta.range?.max ?? 1) <= 1 ? v * 100 : v)}%`;
  // Degrees sit on the number ("60°", "45°/s"); every other unit after a space ("40 ft", "6 rpm").
  if (unit?.startsWith('°')) return `${v}${unit}`;
  return unit ? `${v} ${unit}` : String(v);
}

/** What a field over several objects that differ reads in place of a value. */
export const MIXED = 'Mixed';

/** Whether every one of `objects` reads the same value for `field` (compared as data). */
export function sharedValue(field: CardFieldDef, objects: readonly unknown[]): { value: unknown; mixed: boolean } {
  const read = field.read as (o: unknown) => unknown;
  const value = read(objects[0]);
  const key = JSON.stringify(value ?? null);
  return { value, mixed: objects.some((o, i) => i > 0 && JSON.stringify(read(o) ?? null) !== key) };
}

/** The verbs that apply now, danger last. */
export function liveVerbs(verbs: readonly Verb[]): Verb[] {
  const state = useStore.getState();
  const live = verbs.filter((v) => !v.when || v.when(state));
  return [...live.filter((v) => !v.danger), ...live.filter((v) => v.danger)];
}

/**
 * "L2 Cellars": numbered from the ground up, as the dock and the title card read it. The
 * store lists levels top first (Page Up goes to the one before).
 */
export function levelLabel(index: number, count: number, name: string): string {
  return `L${count - index} ${name || 'Unnamed'}`;
}
