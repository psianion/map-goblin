// The Design tools' custom dock controls: a stepper that hides when it would set nothing,
// an angle stepper with its quarter turn, and a height stepper that steps over flat.

import { useStore } from '@/store/store';
import { turnDoorAngle } from '@dnd/core/src/engine/tools/DoorTool';
import { SecondaryButton, Stepper } from '@/editor/components';
import type { SettingProps } from '@/editor/registry/types';
import { wallWidthIgnored } from '@/v2/editor/assetStrip';
import { wallLookValue } from './wallLook';
import { signed, stepHeight } from './plateauModel';

const fixed2 = (v: number) => v.toFixed(2);

/** Wall width. Absent when the walls are a cave kit's rock, which has no width to set. */
export function WallWidthControl({ def, value, onChange }: SettingProps<number>) {
  // The kits arrive with the packs, after boot; re-read when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const setId = useStore((s) => wallLookValue(s, 'wallTextureSetId'));
  if (wallWidthIgnored(setId || undefined)) return null;
  const r = def.range;
  return (
    <Stepper
      label={def.label}
      value={value}
      min={r?.min}
      max={r?.max}
      step={r?.step}
      format={fixed2}
      // Steps of 0.05 drift in floating point; the value is kept to the step.
      onValueChange={(v) => onChange(Math.round(v * 100) / 100)}
    />
  );
}

/** A free-standing door's angle in 15° steps, and Turn 90° for the common case. */
export function DoorAngleControl({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Stepper
        label={def.label}
        value={value}
        min={r?.min}
        max={r?.max}
        step={r?.step}
        format={(v) => `${v}°`}
        onValueChange={onChange}
      />
      <SecondaryButton onClick={() => onChange(turnDoorAngle(value))}>
        Turn 90°
      </SecondaryButton>
    </span>
  );
}

/** Plateau height: signed, and a step that would land on flat goes on to the other side. */
export function HeightControl({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  return (
    <Stepper
      label={def.label}
      value={value}
      min={r?.min}
      max={r?.max}
      format={signed}
      onValueChange={(v) => onChange(stepHeight(value, Math.sign(v - value)))}
    />
  );
}
