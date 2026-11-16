// A colour for each time of day, as the Sky sheet and the export dialog read and write it. A
// time with a tint of its own (`MapSettings.timeTints`) is drawn in that; one without uses the
// map's Colour (`ambientLight`). One command per pick, a drag in the picker folding into one step.

import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { SetTimeTintCommand } from '@/store/commands';
import type { MapSettings, TimeOfDay } from '@/store/types';
import { runEdit } from '@/editor/families/design/cardWrites';

/** The four times, in the order the tiles show them. */
export const TINT_TIMES: { time: TimeOfDay; label: string }[] = [
  { time: 'dawn', label: 'Dawn' },
  { time: 'day', label: 'Day' },
  { time: 'dusk', label: 'Dusk' },
  { time: 'night', label: 'Night' },
];

type TintMap = Pick<MapSettings, 'ambientLight' | 'timeTints'>;

/** One time's tint: its own (null when it has none) and the one it is drawn in. */
export interface TimeTint {
  time: TimeOfDay;
  label: string;
  own: string | null;
  shown: string;
}

export function timeTintOf(map: TintMap, time: TimeOfDay): TimeTint {
  const own = map.timeTints?.[time] ?? null;
  return { time, label: TINT_TIMES.find((t) => t.time === time)?.label ?? time, own, shown: own ?? map.ambientLight };
}

/** Every time's tint, Dawn to Night. */
export function timeTints(map: TintMap): TimeTint[] {
  return TINT_TIMES.map((t) => timeTintOf(map, t.time));
}

/** The colour each time's tile is multiplied by: the tint the time is drawn in. */
export function tileTints(map: TintMap): Record<TimeOfDay, string> {
  return Object.fromEntries(timeTints(map).map((t) => [t.time, t.shown])) as Record<TimeOfDay, string>;
}

/** `tileTints` of the open map, kept while its tints stay the same. */
export function useTileTints(): Record<TimeOfDay, string> {
  const ambientLight = useStore((s) => s.mapSettings.ambientLight);
  const own = useStore((s) => s.mapSettings.timeTints);
  return useMemo(() => tileTints({ ambientLight, timeTints: own }), [ambientLight, own]);
}

/** Sets one time's own tint, or with null clears it back to the map's Colour: one undo step. */
export function setTimeTint(time: TimeOfDay, color: string | null): void {
  const before = useStore.getState().mapSettings.timeTints?.[time] ?? null;
  if (before === color) return;
  runEdit('Tint', [new SetTimeTintCommand(time, before, color)], color ? `sky.tint.${time}` : undefined);
}
