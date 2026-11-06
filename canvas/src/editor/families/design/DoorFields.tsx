// The door card's custom rows: Name, Width, Angle and Material.

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { isOwnPiece } from '@dnd/core/src/shared/doorwaySeal';
import { DOOR_ANGLE_STEP, turnDoorAngle } from '@dnd/core/src/engine/tools/DoorTool';
import { type DoorKitId } from '@dnd/core/src/assets/doorKits';
import { InputRow, SecondaryButton, SelectRow, SettingRow, SliderRow, Stepper } from '@/editor/components';
import type { SettingProps } from '@/editor/registry/types';
import { DOOR_WIDTH_STEP, doorMaterialOptions, doorModel, doorWidthValue } from '@/v2/editor/selectionModel';
import { doorHost, installedDoorKits } from './doorModel';

/** Typed freely, landed on Enter or blur as one step; Escape puts it back; empty keeps the old name. */
export function NameField({ def, value, onChange }: SettingProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputRow
      label={def.label}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onChange(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

/** The span the door may take where it hangs, read live: the opening caps it. */
export function WidthField({ def, value, onChange }: SettingProps<number>) {
  const span = useStore(
    useShallow((s) => {
      const id = s.selection.selectedIds[0];
      const host = id ? doorHost(s, id) : null;
      const w = host ? doorModel(host.door, host.room, host.wallSetId).width : null;
      return w ? { min: w.min, max: w.max } : { min: 1, max: 1 };
    }),
  );
  return (
    <SliderRow
      label={def.label}
      value={value}
      min={span.min}
      max={span.max}
      step={DOOR_WIDTH_STEP}
      format={(v) => `${v.toFixed(2)} sq`}
      onValueChange={(v) => onChange(doorWidthValue(v, span))}
    />
  );
}

/** A door on its own piece of wall turns here; any other takes its wall's angle. */
export function AngleField({ def, value, onChange }: SettingProps<number>) {
  const own = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const layer = id ? selectLayerForChild(s, id) : undefined;
    return Boolean(layer && id && isOwnPiece(layer, id));
  });
  if (!own) {
    return (
      <SettingRow label={def.label}>
        <span className="text-[11px] text-text-3">
          <span className="font-mono text-text-2">{value}°</span> · turn the wall to turn it
        </span>
      </SettingRow>
    );
  }
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-1.5">
        <Stepper label={def.label} value={value} min={0} max={165} step={DOOR_ANGLE_STEP} format={(v) => `${v}°`} onValueChange={onChange} />
        <SecondaryButton onClick={() => onChange(turnDoorAngle(value))}>Turn 90°</SecondaryButton>
      </span>
    </SettingRow>
  );
}

/** Auto (the wall's kit) and the kits the installed packs ship. */
export function MaterialField({ def, value, onChange }: SettingProps<string>) {
  // Read as one string, so the selector hands back the same value while nothing moved.
  const key = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const host = id ? doorHost(s, id) : null;
    const kits = installedDoorKits(s);
    return JSON.stringify(doorMaterialOptions(host?.wallSetId).filter((o) => o.value === 'auto' || kits.includes(o.value as DoorKitId)));
  });
  const options = useMemo(() => JSON.parse(key) as { value: string; label: string }[], [key]);
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}
