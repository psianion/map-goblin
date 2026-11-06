// The stub registry's custom controls and dock column, for the /next route and the tests.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AddTile, Caption, Chip, DockColumn, Fold, SecondaryButton, SelectRow, SettingRow, Swatch, Tile } from '@/editor/components';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import type { SettingProps } from '@/editor/registry';

const MATERIALS = [
  { name: 'Colour', color: '#d9cfbd' },
  { name: 'Flagstone', color: '#b9ad96' },
  { name: 'Planks', color: '#8b7d66' },
  { name: 'Cobbles', color: '#9a9a90' },
  { name: 'Cave rock', color: '#7d7a70' },
];

export function LookColumn() {
  const [picked, setPicked] = useState('Flagstone');
  return (
    <DockColumn
      title="Look"
      data-column="look"
      control={
        <>
          Fieldstone Keep <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5" />
        </>
      }
    >
      {MATERIALS.map((m) => (
        <Tile key={m.name} name={m.name} color={m.color} active={picked === m.name} onClick={() => setPicked(m.name)} />
      ))}
      <AddTile name="From library" />
    </DockColumn>
  );
}

const PICK_ONLY = ['All', 'Floors', 'Walls', 'Doors', 'Props', 'Lights', 'Labels', 'Zones'];

export function PickOnly({ value, onChange }: SettingProps<string[]>) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  return (
    <div className="flex flex-col gap-2">
      <Caption>Pick only</Caption>
      <div className="flex flex-wrap gap-1">
        {PICK_ONLY.map((k) => (
          <Chip key={k} pressed={value.includes(k)} onPressedChange={() => toggle(k)}>
            {k}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function TextureField() {
  return (
    <SettingRow label="Texture">
      <span className="flex items-center gap-1.5">
        <Swatch label="Texture" color="#d9cfbd" className="h-7 w-9 rounded-key" />
        <SecondaryButton>Change</SecondaryButton>
      </span>
    </SettingRow>
  );
}

export function FillField({ value }: SettingProps<string>) {
  return (
    <Fold title="Fill" summary={value}>
      <div className="text-[11px] text-text-3">Scale, rotate and offset arrive with the Design family.</div>
    </Fold>
  );
}

export function LayerField() {
  const name = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const layer = s.layers.find((l) => l.type === 'dungeon' && (l as DungeonLayer).children.some((c) => c.id === id));
    return layer?.name || 'Unnamed layer';
  });
  return <SelectRow label="Layer" value={name} options={[{ value: name, label: name }]} onValueChange={() => {}} />;
}
