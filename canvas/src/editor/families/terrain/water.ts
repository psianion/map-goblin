// The Water brush: paints water on the layer in hand, drawn just above that layer's floors,
// so layer order puts it over or under a floor. Size changes mid-painting, so it sits in the
// dock beside Brush or Shape (Shape waits for the shape placer). The look is set up in the
// panel: on a layer that already holds water it is that water's own, changed as an undo
// step; on a dry layer it is what the first stroke will take.

import { Waves } from 'lucide-react';
import { z } from 'zod';
import { WATER_BRUSH_RANGES } from '@/store/slices/tools';
import { setLayerWaterLook } from '@dnd/core/src/store/waterCommands';
import type { WaterLook } from '@dnd/core/src/shared/waterMask';
import type { DungeonLayer, WaterToolSettings } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { Binding, EditorState } from '@/editor/registry/types';
import { terrainMode } from './brush';

const { radius, blend } = WATER_BRUSH_RANGES;

/** Brush radius in cells. [ and ] and the wheel step it too (WaterTool). */
export const waterSize = defineSetting<number>({
  id: 'water.size',
  label: 'Size',
  schema: z.number().min(radius.min).max(radius.max),
  default: 3,
  home: 'dock',
  control: 'stepper',
  section: 'Size',
  range: { ...radius, unit: 'sq' },
  path: 'water.radius',
});

/** Brush or Shape: Shape is drawn disabled until the shape placer exists. */
export const waterPlace = defineSetting<'brush' | 'shape'>({
  id: 'water.place',
  label: 'Place',
  schema: z.enum(['brush', 'shape']),
  default: 'brush',
  home: 'dock',
  control: 'seg',
  section: 'Place',
  options: [
    { value: 'brush', label: 'Brush' },
    { value: 'shape', label: 'Shape', disabled: true },
  ],
  note: 'Shape comes after the brush',
  persist: false,
  bind: {
    read: () => 'brush',
    write: () => {},
  },
});

const activeWater = (s: EditorState) =>
  s.layers.find((l): l is DungeonLayer => l.id === s.ui.activeLayerId && l.type === 'dungeon')?.water;

/** A look value: the layer's own water's when it has some, else the brush's for the first stroke. */
function lookBinding<K extends keyof WaterLook>(key: K): Binding<WaterToolSettings[K]> {
  return {
    read: (s) => (activeWater(s)?.[key] ?? s.tools.settings.water[key]) as WaterToolSettings[K],
    write: (store, v) => {
      store.setState((d) => {
        d.tools.settings.water[key] = v;
      });
      setLayerWaterLook(store.getState().ui.activeLayerId, { [key]: v });
    },
  };
}

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const waterShallow = defineSetting<string>({
  id: 'water.shallow',
  label: 'Shallow',
  schema: hex,
  default: '#9db7bd',
  home: 'panel',
  control: 'colour',
  section: 'Colour',
  persist: false,
  bind: lookBinding('shallow'),
});

export const waterDeep = defineSetting<string>({
  id: 'water.deep',
  label: 'Deep',
  schema: hex,
  default: '#5f8a93',
  home: 'panel',
  control: 'colour',
  section: 'Colour',
  persist: false,
  bind: lookBinding('deep'),
});

/** Cells from the edge over which Shallow blends to Deep. */
export const waterBlend = defineSetting<number>({
  id: 'water.blend',
  label: 'Blend distance',
  schema: z.number().min(blend.min).max(blend.max),
  default: 1.5,
  home: 'panel',
  control: 'slider',
  section: 'Colour',
  range: { ...blend, unit: 'sq' },
  persist: false,
  bind: lookBinding('blend'),
});

/** The thin Deep line along the water's edge. */
export const waterBorder = defineSetting<boolean>({
  id: 'water.border',
  label: 'Border',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Edge',
  persist: false,
  bind: lookBinding('border'),
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const waterBrushTool = defineTool({
  id: 'waterBrush',
  label: 'Water brush',
  description: 'Paint water with a shallow edge and deep middle',
  icon: Waves,
  key: 'W',
  engine: ['water'],
  settings: [waterSize, waterPlace, terrainMode, waterShallow, waterDeep, waterBlend, waterBorder],
  dock: [],
  keys: [
    { id: 'size.down', combo: '[', label: 'Brush smaller' },
    { id: 'size.up', combo: ']', label: 'Brush larger' },
  ],
  hint: (s) => {
    const size = [k('['), t(' '), k(']'), t(' size')];
    return {
      label: 'Water brush',
      segments: s.tools.eraseMode ? [t('Erase water · '), ...size] : [t('Paint water · '), k('Alt'), t(' erase · '), ...size],
    };
  },
});
