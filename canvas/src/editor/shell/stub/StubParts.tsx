// The stub registry's custom controls and dock column, for the /next route and the tests.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AddTile, DockColumn, Fold, SecondaryButton, SelectRow, SettingRow, Swatch, Tile } from '@/editor/components';
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
