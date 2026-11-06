// The Floor tool: one tool over the rectangle, polygon and regular polygon engine tools.
// The dock's Shape row picks which of the three is in hand; Sides shows for Regular only.

import { Hexagon, Pentagon, Square, SquareDashed } from 'lucide-react';
import { z } from 'zod';
import type { ToolType } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef, EditorState, HintLine } from '@/editor/registry/types';
import { editNodeMode, gridSnap, gridSnapStep } from '@/editor/registry/shared';
import { activeDungeonLayer, setActiveStyle } from './layerStyle';
import { FloorLook } from './LookColumn';

export type FloorShape = 'rect' | 'polygon' | 'regular';

/** The engine tool each shape draws with, in the order the Shape row shows them. */
export const FLOOR_ENGINE: Record<FloorShape, ToolType> = {
  rect: 'rectangle',
  polygon: 'polygon',
  regular: 'regularPolygon',
};

const SHAPE_OF = new Map<ToolType, FloorShape>(
  (Object.entries(FLOOR_ENGINE) as [FloorShape, ToolType][]).map(([shape, tool]) => [tool, shape]),
);

/** The shape in hand: the floor engine tool that is active, else the first. */
export function floorShapeOf(state: Pick<EditorState, 'tools'>): FloorShape {
  return SHAPE_OF.get(state.tools.activeTool) ?? 'rect';
}

/**
 * Shape row. It follows the engine tool in hand rather than keeping a copy, so the R, P
 * and H keys and the row can never disagree.
 */
export const floorShape = defineSetting<FloorShape>({
  id: 'floor.shape',
  label: 'Shape',
  schema: z.enum(['rect', 'polygon', 'regular']),
  default: 'rect',
  home: 'dock',
  control: 'seg',
  section: 'Shape',
  // Keys are today's floor shortcuts; step 9 takes the final letters from the registry.
  options: [
    { value: 'rect', label: 'Rectangle', icon: Square, key: 'R' },
    { value: 'polygon', label: 'Polygon', icon: Pentagon, key: 'P' },
    { value: 'regular', label: 'Regular polygon', icon: Hexagon, key: 'H' },
  ],
  persist: false,
  bind: {
    read: floorShapeOf,
    write: (store, shape) => store.getState().setActiveTool(FLOOR_ENGINE[shape]),
  },
});

export const floorSides = defineSetting<number>({
  id: 'floor.sides',
  label: 'Sides',
  schema: z.number().int().min(3).max(32),
  default: 6,
  home: 'dock',
  control: 'stepper',
  section: 'Shape',
  range: { min: 3, max: 32, step: 1 },
  path: 'regularPolygon.sides',
  visibleWhen: (get) => get('floor.shape') === 'regular',
});

/**
 * Edge transitions between floors of different textures on the layer being drawn on: the
 * layer's own switch (also in the layer sheet), so it is not saved with the tool.
 */
export const floorBlend = defineSetting<boolean>({
  id: 'floor.blend',
  label: 'Blend with neighbours',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Edge',
  persist: false,
  bind: {
    read: (s) => activeDungeonLayer(s)?.style.showEdgeTransitions ?? true,
    write: (store, on) => setActiveStyle(store.getState(), 'showEdgeTransitions', on, 'Blend with neighbours'),
  },
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

const FLOOR_HINTS: Record<FloorShape, HintLine> = {
  rect: { label: 'Floor', segments: [t('Drag a rectangle · '), k('Shift'), t(' square · '), k('Esc'), t(' cancel')] },
  polygon: {
    label: 'Floor',
    segments: [t('Click points · '), k('Enter'), t(' close · '), k('Shift'), t(' 15° steps · '), k('Esc'), t(' cancel')],
  },
  regular: { label: 'Floor', segments: [t('Drag from the centre out · '), k('Esc'), t(' cancel')] },
};

/** Colour, the style presets, the texture strip and From library. */
const floorLookColumn: DockColumnDef = { id: 'floor.look', caption: 'Look', render: FloorLook };

export const floorTool = defineTool({
  id: 'floor',
  label: 'Floor',
  description: 'Rectangle, polygon, regular polygon',
  icon: SquareDashed,
  key: 'F',
  engine: [FLOOR_ENGINE.rect, FLOOR_ENGINE.polygon, FLOOR_ENGINE.regular],
  // No Curve: the polygon tool draws straight edges only; curveMode reaches walls alone.
  settings: [floorShape, floorSides, editNodeMode, gridSnap, gridSnapStep, floorBlend],
  dock: [floorLookColumn],
  hint: (s) => FLOOR_HINTS[floorShapeOf(s)],
});
