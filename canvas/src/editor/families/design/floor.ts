// The Floor tool: one tool over the rectangle, polygon and regular polygon engine tools.
// The dock's Shape row picks which of the three is in hand; Sides shows for Regular only.
// The panel's Mode draws floors or carves them out; Alt while drawing carves the one shape.

import { Hexagon, Pentagon, Square, SquareDashed } from 'lucide-react';
import { z } from 'zod';
import type { ToolType } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef, EditorState, HintLine } from '@/editor/registry/types';
import { editCurve, editNodeMode, gridSnap, gridSnapStep } from '@/editor/registry/shared';
import { activeDungeonLayer, setActiveStyle } from './layerStyle';
import { FloorLook } from './LookColumn';
import { EdgeBandField } from './FloorFields';
import { layerBandOf } from './floorModel';

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
 * Draw, or Carve out: the shape drawn comes off every floor under it on the active layer.
 * The floor tools' own mode, apart from the erase switch the brushes share.
 */
export const floorMode = defineSetting<'draw' | 'carve'>({
  id: 'floor.mode',
  label: 'Draw or carve',
  schema: z.enum(['draw', 'carve']),
  default: 'draw',
  home: 'panel',
  control: 'seg',
  section: 'Mode',
  options: [
    { value: 'draw', label: 'Draw' },
    { value: 'carve', label: 'Carve out' },
  ],
  persist: false,
  bind: {
    read: (s) => s.tools.floorMode,
    write: (store, v) => store.getState().setFloorMode(v),
  },
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

/**
 * The edge band new floors take. Unset, it reads as the active layer's band and new floors
 * follow their layer; picking another pins it on them, picking the layer's own unsets it.
 * Not saved in prefs: the value it reads depends on the layer in hand.
 */
export const floorEdgeBand = defineSetting<string | null>({
  id: 'floor.edgeBand',
  label: 'Edge band',
  schema: z.string().nullable(),
  default: null,
  home: 'panel',
  control: 'custom',
  section: 'Edge',
  render: EdgeBandField,
  persist: false,
  bind: {
    read: (s) => (s.tools.settings.floorEdgeBand !== undefined ? s.tools.settings.floorEdgeBand : layerBandOf(activeDungeonLayer(s))),
    write: (store, v) =>
      store.setState((draft) => {
        draft.tools.settings.floorEdgeBand = v === layerBandOf(activeDungeonLayer(draft)) ? undefined : v;
      }),
  },
});

/** The opacity new floors take: their fill and texture only. */
export const floorOpacity = defineSetting<number>({
  id: 'floor.opacity',
  label: 'Opacity',
  schema: z.number().min(0).max(1),
  default: 1,
  home: 'panel',
  control: 'slider',
  section: 'Defaults for new floors',
  range: { min: 0, max: 1, step: 0.05, unit: '%' },
  bind: {
    read: (s) => s.tools.settings.floorOpacity ?? 1,
    write: (store, v) =>
      store.setState((draft) => {
        draft.tools.settings.floorOpacity = v;
      }),
  },
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

const FLOOR_HINTS: Record<FloorShape, HintLine> = {
  rect: { label: 'Floor', segments: [t('Drag a rectangle · '), k('Shift'), t(' square · '), k('Alt'), t(' carves · '), k('Esc'), t(' cancel')] },
  polygon: {
    label: 'Floor',
    segments: [t('Click points · '), k('Enter'), t(' close · '), k('Shift'), t(' 15° steps · '), k('Alt'), t(' carves · '), k('Esc'), t(' cancel')],
  },
  regular: { label: 'Floor', segments: [t('Drag from the centre out · '), k('Alt'), t(' carves · '), k('Esc'), t(' cancel')] },
};

const whileInDraw = [k('Alt'), t(' carves while in Draw')];

/** Carve out in hand: what to draw, and that Alt is the fast path from Draw. */
const CARVE_HINTS: Record<FloorShape, HintLine> = {
  rect: { label: 'Floor', segments: [t('Carve out · drag a rectangle · '), ...whileInDraw] },
  polygon: { label: 'Floor', segments: [t('Carve out · click points · '), k('Enter'), t(' close · '), ...whileInDraw] },
  regular: { label: 'Floor', segments: [t('Carve out · drag from the centre out · '), ...whileInDraw] },
};

/** Colour, the style presets, the texture strip and From library. */
export const floorLookColumn: DockColumnDef = { id: 'floor.look', caption: 'Look', render: FloorLook };

export const floorTool = defineTool({
  id: 'floor',
  label: 'Floor',
  description: 'Rectangle, polygon, regular polygon',
  icon: SquareDashed,
  key: 'F',
  engine: [FLOOR_ENGINE.rect, FLOOR_ENGINE.polygon, FLOOR_ENGINE.regular],
  // Curve and Node mode share the Edit column, as on walls: Curve smooths a drawn
  // polygon and bends a dragged edge in node mode.
  settings: [floorShape, floorSides, editCurve, editNodeMode, floorMode, gridSnap, gridSnapStep, floorEdgeBand, floorBlend, floorOpacity],
  dock: [floorLookColumn],
  hint: (s) => (s.tools.floorMode === 'carve' ? CARVE_HINTS : FLOOR_HINTS)[floorShapeOf(s)],
});
