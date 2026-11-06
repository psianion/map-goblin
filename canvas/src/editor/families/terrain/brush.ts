// The Terrain brush: paints the map's six terrain textures over floors and ground. Size and
// Strength change mid-painting, so they sit in the dock with the slots; Erase and the
// brush colour are set up before, in the panel.

import { Paintbrush } from 'lucide-react';
import { z } from 'zod';
import { TERRAIN_BRUSH_RANGES } from '@/store/slices/tools';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { editErase } from '@/editor/registry/shared';
import { ColourAlphaField, SlotsColumn, StrengthControl } from './TerrainControls';
import { fromHex8, toHex8 } from './colour';

const { radius, strength } = TERRAIN_BRUSH_RANGES;

/** Brush radius in cells. [ and ] and the wheel step it too (TerrainTool). */
export const terrainSize = defineSetting<number>({
  id: 'terrain.size',
  label: 'Size',
  schema: z.number().min(radius.min).max(radius.max),
  default: 2,
  home: 'dock',
  control: 'stepper',
  section: 'Size',
  range: { ...radius, unit: 'sq' },
  path: 'terrainBrush.radius',
});

/** How far one stroke goes towards the texture: the stroke's ceiling, so low strength blends. */
export const terrainStrength = defineSetting<number>({
  id: 'terrain.strength',
  label: 'Strength',
  schema: z.number().min(strength.min).max(strength.max),
  default: 0.6,
  home: 'dock',
  control: 'custom',
  section: 'Strength',
  range: { ...strength, unit: '%' },
  render: StrengthControl,
  path: 'terrainBrush.strength',
});

/** The brush colour and its alpha, one value; alpha 0 paints untinted. */
export const terrainColour = defineSetting<string>({
  id: 'terrain.colour',
  label: 'Colour',
  schema: z.string().regex(/^#[0-9a-f]{8}$/i),
  default: '#ffffff00',
  home: 'panel',
  control: 'custom',
  section: 'Colour',
  render: ColourAlphaField,
  bind: {
    read: (s) => toHex8(s.tools.settings.terrainBrush.tintColor, s.tools.settings.terrainBrush.tintOpacity),
    // Both halves at once, so the store never lifts a zero alpha on its own.
    write: (store, v) => {
      const { colour, alpha } = fromHex8(v);
      store.getState().updateTerrainBrushSettings({ tintColor: colour, tintOpacity: alpha });
    },
  },
});

const slotsColumn: DockColumnDef = { id: 'terrain.slots', caption: 'Textures', render: SlotsColumn };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const terrainBrushTool = defineTool({
  id: 'terrainBrush',
  label: 'Terrain brush',
  description: 'Paint terrain textures over floors and ground',
  icon: Paintbrush,
  key: 'B',
  engine: ['terrain'],
  settings: [terrainSize, terrainStrength, editErase, terrainColour],
  dock: [slotsColumn],
  hint: (s) => ({
    label: 'Terrain brush',
    segments: [
      t(s.tools.eraseMode ? 'Drag to erase back to the floor · ' : 'Drag to paint · '),
      k('['),
      t(' '),
      k(']'),
      t(' or the wheel sizes the brush · '),
      k('Shift E'),
      t(' erase · '),
      k('Esc'),
      t(' cancel'),
    ],
  }),
});
