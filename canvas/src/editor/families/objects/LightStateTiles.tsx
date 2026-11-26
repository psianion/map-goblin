// A light prop's state as its own pictures: Off, Embers (braziers) and On, each tile the prop's
// art for that state with its name under it, the picked one outlined. Mixed outlines none.

import type { LightState, LightStates } from '@dnd/core/src/shared/propLights';
import { SwatchPicker, type Swatch } from '@/editor/SwatchPicker';

const LABEL: Record<LightState, string> = { off: 'Off', embers: 'Embers', on: 'On' };

export function LightStateTiles({
  states,
  value,
  onPick,
}: {
  states: LightStates;
  value: LightState | 'mixed';
  onPick: (state: LightState) => void;
}) {
  const swatches: Swatch[] = (['off', 'embers', 'on'] as const)
    .filter((s) => states[s])
    .map((s) => ({ value: s, label: LABEL[s], art: states[s] }));
  return <SwatchPicker label="State" name="Light state" swatches={swatches} value={value} onPick={(v) => onPick(v as LightState)} />;
}
