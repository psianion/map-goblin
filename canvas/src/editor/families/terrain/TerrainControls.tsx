// The Terrain brush's own controls: a compact Intensity slider for the dock, Fill and the
// brush colour with its alpha for the panel, and the six texture slots with From library.

import { useState } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { DEFAULT_TERRAIN_PALETTE } from '@/store/slices/mapSettings';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import {
  AddTile,
  DockColumn,
  SecondaryButton,
  SettingRow,
  Swatch,
  Tile,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
} from '@dnd/ui';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import type { SettingProps } from '@/editor/registry/types';
import { pickTerrainSlotTexture, TERRAIN_SLOT_COUNT } from '@/editor/models/assetStrip';
import { openAssets } from '@/editor/families/design/openAssets';
import { isHex8 } from './colour';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Intensity in the dock: a short track and its percentage, the column's caption naming it. Greyed while Solid is on. */
export function IntensityControl({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  const solid = useStore((s) => s.tools.settings.terrainBrush.solid === true);
  return (
    <span className={`flex w-[132px] items-center gap-2${solid ? ' opacity-50' : ''}`}>
      <Slider
        aria-label={def.label}
        className="flex-1"
        value={[value]}
        min={r?.min}
        max={r?.max}
        step={r?.step}
        disabled={solid}
        onValueChange={(next: number | readonly number[]) => onChange(typeof next === 'number' ? next : next[0])}
      />
      <span className="w-8 text-right font-mono text-[11px] text-text tabular-nums">{percent(value)}</span>
    </span>
  );
}

const armFill = () => {
  const s = useStore.getState();
  s.setTerrainFill(s.tools.terrainFill === 'off' ? 'armed' : 'off');
};

/** Fill enclosed floor: the row's Fill button, ringed while armed. */
export function FillField({ def, value, onChange }: SettingProps<boolean>) {
  return (
    <SettingRow label={def.label}>
      <SecondaryButton active={value} onClick={() => onChange(!value)}>
        Fill
      </SecondaryButton>
    </SettingRow>
  );
}

/**
 * One colour with alpha, in place of Tint and Tint opacity. Alpha 0 paints the texture
 * as it is; a stroke keeps the colour it was painted with.
 */
export function ColourAlphaField({ def, value, onChange }: SettingProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  const alpha = parseInt(value.slice(7, 9), 16) / 255;
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-2 tabular-nums">{alpha === 0 ? 'None' : percent(alpha)}</span>
        <Popover>
          <PopoverTrigger render={<Swatch label={def.label} color={value} />} />
          <PopoverContent align="end" className="w-auto">
            <HexAlphaColorPicker color={value} onChange={onChange} />
            <Input
              aria-label={`${def.label} hex`}
              className="font-mono"
              value={draft ?? value}
              onChange={(e) => {
                setDraft(e.target.value);
                if (isHex8(e.target.value)) onChange(e.target.value.toLowerCase());
              }}
              onBlur={() => setDraft(null)}
            />
          </PopoverContent>
        </Popover>
      </span>
    </SettingRow>
  );
}

/**
 * The map's six terrain textures, one per brush slot. A click picks the slot; a click on
 * the picked slot while it is empty, or From library, opens the floor textures, and a pick
 * there fills the slot in hand. Right-click empties a slot.
 */
export function SlotsColumn() {
  const slot = useStore((s) => s.tools.settings.terrainBrush.slot);
  const palette = useStore(useShallow((s) => s.mapSettings.terrain?.palette ?? DEFAULT_TERRAIN_PALETTE));
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const armed = useStore((s) => s.tools.terrainFill !== 'off');
  const pick = (i: number) => useStore.getState().updateTerrainBrushSettings({ slot: i });
  return (
    <DockColumn
      title="Textures"
      data-column="slots"
      data-testid="terrain-slots"
      control={
        <SecondaryButton className="h-5 px-2" active={armed} onClick={armFill} aria-label="Fill enclosed floor">
          Fill
        </SecondaryButton>
      }
    >
      {Array.from({ length: TERRAIN_SLOT_COUNT }, (_, i) => {
        const id = palette[i] ?? null;
        const on = slot === i;
        const name = id ? (getCatalogEntry(id)?.label ?? id) : `Slot ${i + 1}`;
        return (
          <Tile
            key={i}
            name={name}
            aria-label={id ? `Slot ${i + 1}, ${name}` : `Slot ${i + 1}, empty`}
            active={on}
            data-slot-index={i}
            onClick={() => (on && !id ? openAssets('floor') : pick(i))}
            onContextMenu={(e) => {
              e.preventDefault();
              pickTerrainSlotTexture(i, null);
            }}
          >
            {id ? <PackThumbnailCanvas textureId={id} fit="cover" /> : null}
          </Tile>
        );
      })}
      <AddTile name="From library" onClick={() => openAssets('floor')} />
    </DockColumn>
  );
}
