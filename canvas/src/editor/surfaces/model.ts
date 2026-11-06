// Pure helpers the surfaces share: how a number reads, which verbs apply now.

import { useStore } from '@/store/store';
import type { SettingMeta, Verb } from '@/editor/registry';

/** How a number reads beside its label: 0..1 with unit % as a percentage, else value and unit. */
export function formatValue(meta: SettingMeta<unknown>, v: number): string {
  const unit = meta.range?.unit;
  if (unit === '%') return `${Math.round((meta.range?.max ?? 1) <= 1 ? v * 100 : v)}%`;
  return unit ? `${v} ${unit}` : String(v);
}

/** The verbs that apply now, danger last. */
export function liveVerbs(verbs: readonly Verb[]): Verb[] {
  const state = useStore.getState();
  const live = verbs.filter((v) => !v.when || v.when(state));
  return [...live.filter((v) => !v.danger), ...live.filter((v) => v.danger)];
}
