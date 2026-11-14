// A compact slider for the dock: a short track and its percentage, the column's caption
// naming it. Path's smoothness uses it.

import { Slider } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function IntensityControl({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  return (
    <span className="flex w-[132px] items-center gap-2">
      <Slider
        aria-label={def.label}
        className="flex-1"
        value={[value]}
        min={r?.min}
        max={r?.max}
        step={r?.step}
        onValueChange={(next: number | readonly number[]) => onChange(typeof next === 'number' ? next : next[0])}
      />
      <span className="w-8 text-right font-mono text-[11px] text-text tabular-nums">{percent(value)}</span>
    </span>
  );
}
