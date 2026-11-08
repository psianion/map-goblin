// The Terrain brush: paints the map's six terrain textures over floors and ground. Holding
// the brush keeps adding paint, Intensity setting how fast. Size and Intensity change
// mid-painting, so they sit in the dock with the slots; Paint or erase, the blending, Fill
// and the brush colour are set up before, in the panel.

import { Paintbrush } from 'lucide-react';
import { z } from 'zod';
import { TERRAIN_BRUSH_RANGES } from '@/store/slices/tools';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { FillField, ColourAlphaField, IntensityControl, SlotsColumn } from './TerrainControls';
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

/**
 * How fast held paint builds, per second: 100% lays the texture solid in a second.
 * Saved prefs keep the id and the store field they had as Strength.
 */
export const terrainStrength = defineSetting<number>({
  id: 'terrain.strength',
  label: 'Intensity',
  schema: z.number().min(strength.min).max(strength.max),
  default: 0.6,
  home: 'dock',
  control: 'custom',
  section: 'Intensity',
  range: { ...strength, unit: '%' },
  render: IntensityControl,
  path: 'terrainBrush.strength',
});

/** Paint, or paint back to the floor's own texture: the erase mode Scatter shares, drawn as a seg here. */
export const terrainMode = defineSetting<boolean>({
  id: 'terrain.mode',
  label: 'Paint or erase',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'seg',
  section: 'Mode',
  options: [
    { value: false, label: 'Paint' },
    { value: true, label: 'Erase' },
  ],
  persist: false,
  bind: {
    read: (s) => s.tools.eraseMode,
    write: (store, v) => store.getState().setEraseMode(v),
  },
});

/** The terrain's own switch, saved with the map: soft seams and edges, or ragged ones. */
export const terrainSmooth = defineSetting<boolean>({
  id: 'terrain.smoothBlend',
  label: 'Smooth blending',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Blending',
  persist: false,
  bind: {
    read: (s) => s.mapSettings.terrain?.smoothBlend === true,
    write: (store, v) => store.getState().setTerrainData({ smoothBlend: v }),
  },
});

/** Fill enclosed floor: arms a one-shot, and the next map click floods the floor there. */
export const terrainFill = defineSetting<boolean>({
  id: 'terrain.fill',
  label: 'Fill enclosed floor',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'custom',
  section: 'Blending',
  render: FillField,
  persist: false,
  bind: {
    read: (s) => s.tools.terrainFill !== 'off',
    write: (store, armed) => store.getState().setTerrainFill(armed ? 'armed' : 'off'),
  },
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
  settings: [terrainSize, terrainStrength, terrainMode, terrainSmooth, terrainFill, terrainColour],
  dock: [slotsColumn],
  // The brush's size, as the wheel steps it; the tool in hand takes the key.
  keys: [
    { id: 'size.down', combo: '[', label: 'Brush smaller' },
    { id: 'size.up', combo: ']', label: 'Brush larger' },
  ],
  hint: (s) => {
    const fill = s.tools.terrainFill;
    if (fill !== 'off') {
      return { label: 'Terrain brush', segments: [t(fill === 'miss' ? 'No floor here · ' : 'Click a floor to fill · '), k('Esc'), t(' cancels')] };
    }
    const size = [k('['), t(' '), k(']'), t(' size')];
    return {
      label: 'Terrain brush',
      segments: s.tools.eraseMode
        ? [t('Hold to erase back to the floor · '), ...size]
        : [t('Hold to build up · '), k('Alt'), t(' erase · '), ...size],
    };
  },
});
