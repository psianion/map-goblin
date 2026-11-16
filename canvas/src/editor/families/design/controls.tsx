// The Design tools' custom dock controls: a width stepper whose floor follows the wall set,
// an angle stepper with its quarter turn, and a height stepper that steps over flat.

import { useStore } from '@/store/store';
import { turnDoorAngle } from '@dnd/core/src/engine/tools/DoorTool';
import { SecondaryButton, Stepper } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { wallWidthMin } from '@/editor/models/assetStrip';
import { wallLookValue } from './wallLook';
import { signed, stepHeight } from './plateauModel';

const fixed2 = (v: number) => v.toFixed(2);

/** Wall width. A cave kit's rock is laid larger or smaller by it, down to the kit's smallest. */
export function WallWidthControl({ def, value, onChange }: SettingProps<number>) {
  // The kits arrive with the packs, after boot; re-read when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const setId = useStore((s) => wallLookValue(s, 'wallTextureSetId'));
  const r = def.range;
  return (
    <Stepper
      label={def.label}
      value={value}
      min={wallWidthMin(setId || undefined)}
      max={r?.max}
      step={r?.step}
      format={fixed2}
      // Steps of 0.05 drift in floating point; the value is kept to the step.
      onValueChange={(v) => onChange(Math.round(v * 100) / 100)}
    />
  );
}

/** A free-standing door's angle in 5° steps, and Turn 90° for the common case. */
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
