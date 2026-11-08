// The plateau card's custom rows: Height with where it stands, Cliff art, Slope width, Crossing.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { absoluteHeight, defaultCrossingId, edgeOf, shapeDrop } from '@dnd/core/src/shared/plateaus';
import { cliffArtChoices } from '@dnd/core/src/engine/plateauKit';
import { SelectRow, SettingRow, Stepper } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { signed, stepHeight } from './plateauModel';
import { DEFAULT_ART, EDGE_CROSSING } from './plateauModel';

/** Its own height on the stepper, and beside it where it stands in the stack and how far its edge falls. */
export function HeightField({ def, value, onChange }: SettingProps<number>) {
  const where = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const layer = id ? selectLayerForChild(s, id) : undefined;
    return layer && id ? `${signed(absoluteHeight(layer, id))} · drop ${Math.abs(shapeDrop(layer, id))}` : '';
  });
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-3" data-testid="design-plateau-standing">
          {where}
        </span>
        <Stepper label={def.label} value={value} format={signed} onValueChange={(v) => onChange(stepHeight(value, Math.sign(v - value)))} />
      </span>
    </SettingRow>
  );
}

/** The cliff sets the packs ship; they arrive after boot, so they are read live. */
export function CliffArtField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const options = cliffArtChoices().map((c) => ({ value: c.value ?? DEFAULT_ART, label: c.label }));
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}

/** Slope cells for each cell of drop, in half cells; the hint says what the number means. */
export function SlopeField({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-2">
        <span className="text-[11px] text-text-3">cells per cell of drop</span>
        <Stepper label={def.label} value={value} min={r?.min} max={r?.max} step={r?.step} onValueChange={onChange} />
      </span>
    </SettingRow>
  );
}

/** The map's crossing kinds, Default (the edge's own) first. */
export function CrossingField({ def, value, onChange }: SettingProps<string>) {
  const kinds = useStore((s) => s.mapSettings.crossingKinds);
  const edgeDefault = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const p = id ? selectLayerForChild(s, id)?.children.find((c) => c.id === id) : undefined;
    return p?.childType === 'plateau' ? defaultCrossingId(edgeOf(p)) : 'free';
  });
  const name = kinds.find((k) => k.id === edgeDefault)?.name ?? 'none';
  const options = [{ value: EDGE_CROSSING, label: `Default (${name})` }, ...kinds.map((k) => ({ value: k.id, label: k.name }))];
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}
