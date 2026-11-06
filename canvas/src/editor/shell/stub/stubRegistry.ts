// A stub registry for the `/next` development route and the shell tests, so the shell's
// four frames can be driven before the real families land (steps 7, 10 to 14). Never
// imported by the editor at `/`; nothing here ships. Settings the core store has no field
// for yet keep their value in memory here; card fields read the real object and write
// nothing.

import {
  Box,
  BrickWall,
  Copy,
  DoorOpen,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  GitCommitHorizontal,
  Hexagon,
  Lightbulb,
  Lock,
  Mountain,
  Paintbrush,
  PencilRuler,
  Pentagon,
  RotateCw,
  Square,
  SquareDashed,
  Stamp,
  SunMoon,
  Trash2,
  Type,
} from 'lucide-react';
import { z } from 'zod';
import { FillField, LayerField, LookColumn, TextureField } from './StubParts';
import { handleShortcut } from '@/shortcuts/defaultShortcuts';
import type { ShapeChild } from '@/store/types';
import {
  createRegistry,
  defineCard,
  defineCardField,
  defineFamily,
  defineSetting,
  defineTool,
  type Binding,
  type DockColumnDef,
  type EditorState,
  type HintLine,
  type ToolDef,
} from '@/editor/registry';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS, editCurve, editErase, editNodeMode, gridSnap, gridSnapStep } from '@/editor/registry/shared';

/** A value the core store has no field for yet, held here; a write nudges the store so readers re-render. */
function memory<T>(initial: T): Binding<T> {
  let value = initial;
  return {
    read: () => value,
    write: (store, next) => {
      value = next;
      store.setState({});
    },
  };
}

const line = (label: string, ...parts: (string | [string])[]): HintLine => ({
  label,
  segments: parts.map((p) => (typeof p === 'string' ? { text: p } : { text: p[0], key: true })),
});

// ── Design: Floor ────────────────────────────────────────

const SHAPE_ENGINE = { rect: 'rectangle', polygon: 'polygon', regular: 'regularPolygon' } as const;
type Shape = keyof typeof SHAPE_ENGINE;

const floorShape = defineSetting<Shape>({
  id: 'floor.shape',
  label: 'Shape',
  schema: z.enum(['rect', 'polygon', 'regular']),
  default: 'rect',
  home: 'dock',
  control: 'seg',
  section: 'Shape',
  options: [
    { value: 'rect', label: 'Rectangle', icon: Square, key: 'R' },
    { value: 'polygon', label: 'Polygon', icon: Pentagon, key: 'P' },
    { value: 'regular', label: 'Regular polygon', icon: Hexagon, key: 'G' },
  ],
  persist: false,
  bind: {
    read: (s) => (s.tools.activeTool === 'polygon' ? 'polygon' : s.tools.activeTool === 'regularPolygon' ? 'regular' : 'rect'),
    write: (store, v) => store.getState().setActiveTool(SHAPE_ENGINE[v]),
  },
});

const floorSides = defineSetting<number>({
  id: 'floor.sides',
  label: 'Sides',
  schema: z.number().int().min(3).max(32),
  default: 6,
  home: 'dock',
  control: 'stepper',
  section: 'Shape',
  range: { min: 3, max: 32, step: 1 },
  visibleWhen: (get) => get('floor.shape') === 'regular',
  path: 'regularPolygon.sides',
});

const floorMode = defineSetting<'draw' | 'carve'>({
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
    read: (s) => (s.tools.eraseMode ? 'carve' : 'draw'),
    write: (store, v) => store.getState().setEraseMode(v === 'carve'),
  },
});

const EDGE_BANDS = [
  { value: 'cave-ink', label: 'Cave ink' },
  { value: 'none', label: 'None' },
];

const floorEdgeBand = defineSetting<string>({
  id: 'floor.edgeBand',
  label: 'Edge band',
  schema: z.string(),
  default: 'cave-ink',
  home: 'panel',
  control: 'select',
  section: 'Edge',
  options: EDGE_BANDS,
  bind: memory('cave-ink'),
});

const floorBlend = defineSetting<boolean>({
  id: 'floor.blend',
  label: 'Blend with neighbours',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Edge',
  bind: memory(true),
});

const floorOpacity = defineSetting<number>({
  id: 'floor.opacity',
  label: 'Opacity',
  schema: z.number().min(0).max(1),
  default: 1,
  home: 'panel',
  control: 'slider',
  section: 'Defaults for new floors',
  range: { min: 0, max: 1, step: 0.05, unit: '%' },
  bind: memory(1),
});

const lookColumn: DockColumnDef = { id: 'look', caption: 'Look', render: LookColumn };

function floorHint(s: EditorState): HintLine {
  switch (s.tools.activeTool) {
    case 'polygon':
      return line('Floor', 'Click points ·', ['Enter'], 'close ·', ['Backspace'], 'last point ·', ['Shift'], 'bend');
    case 'regularPolygon':
      return line('Floor', 'Drag from the centre ·', ['Shift'], 'keeps it upright');
    default:
      return line('Floor', 'Drag a rectangle ·', ['Shift'], 'square ·', ['Alt'], 'carves');
  }
}

const floor = defineTool({
  id: 'floor',
  label: 'Floor',
  description: 'Rectangle, polygon, regular polygon',
  icon: SquareDashed,
  key: 'F',
  engine: ['rectangle', 'polygon', 'regularPolygon'],
  settings: [floorShape, floorSides, editCurve, editNodeMode, floorMode, gridSnap, gridSnapStep, floorEdgeBand, floorBlend, floorOpacity],
  dock: [lookColumn],
  hint: floorHint,
  savePreset: () => {},
});

const simple = (t: Omit<ToolDef, 'dock' | 'hint'> & { hint: string }): ToolDef =>
  defineTool({ ...t, dock: [], hint: () => line(t.label, t.hint) });

const design = defineFamily({
  id: 'design',
  label: 'Design',
  icon: PencilRuler,
  key: 'D',
  tools: [
    floor,
    simple({ id: 'wall', label: 'Wall', description: 'Solid, window, open', icon: BrickWall, key: 'W', engine: ['wall'], settings: [editCurve, editNodeMode, gridSnap], hint: 'Click to start a wall' }),
    simple({ id: 'door', label: 'Door', description: 'Single, double, portcullis, archway', icon: DoorOpen, key: 'D', engine: ['door'], settings: [gridSnap], hint: 'Click a wall to place a door' }),
    simple({ id: 'elevation', label: 'Elevation', description: 'Plateaus, cliffs, slopes, pits', icon: Mountain, key: 'E', engine: ['plateau'], settings: [gridSnap], hint: 'Drag to raise a plateau' }),
  ],
});

const terrain = defineFamily({
  id: 'terrain',
  label: 'Terrain',
  icon: Mountain,
  key: 'T',
  tools: [simple({ id: 'terrainBrush', label: 'Terrain brush', description: 'Paint terrain textures', icon: Paintbrush, key: 'B', engine: ['terrain'], settings: [editErase], hint: 'Drag to paint' })],
});

const objects = defineFamily({
  id: 'objects',
  label: 'Objects',
  icon: Box,
  key: 'O',
  tools: [simple({ id: 'stamp', label: 'Stamp', description: 'Place one prop at a time', icon: Stamp, key: 'S', engine: ['scatterBrush'], settings: [], hint: 'Click to place' })],
});

const environment = defineFamily({
  id: 'environment',
  label: 'Environment',
  icon: SunMoon,
  key: 'E',
  tools: [simple({ id: 'light', label: 'Light', description: 'Torches, lanterns, darkness', icon: Lightbulb, key: 'L', engine: ['light'], settings: [], hint: 'Click to place a light' })],
});

const text = defineFamily({
  id: 'text',
  label: 'Text',
  icon: Type,
  key: 'X',
  tools: [simple({ id: 'label', label: 'Label', description: 'Room names, notes, numbers', icon: Type, key: 'L', engine: ['text'], settings: [], hint: 'Click to place a label' })],
});

// ── The floor card ───────────────────────────────────────

function bounds(o: ShapeChild): { w: number; h: number } {
  const ring = o.contours[0] ?? [];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)) };
}

const noWrite = () => {};



const floorCard = defineCard<'shape'>({
  kind: 'shape',
  title: () => 'Floor',
  verbs: [
    { id: 'nodes', label: 'Node mode', icon: GitCommitHorizontal, key: 'N', run: (store) => editNodeMode.bind?.write(store, true) },
    { id: 'flipH', label: 'Flip horizontal', icon: FlipHorizontal2, run: () => handleShortcut('shift+h') },
    { id: 'flipV', label: 'Flip vertical', icon: FlipVertical2, bar: false, run: () => handleShortcut('shift+v') },
    { id: 'rotate', label: 'Rotate 90°', icon: RotateCw, run: () => handleShortcut('shift+r') },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, run: () => handleShortcut('ctrl+d') },
    { id: 'lock', label: 'Lock', icon: Lock, run: () => handleShortcut('ctrl+shift+l') },
    { id: 'hide', label: 'Hide', icon: EyeOff, bar: false, run: () => handleShortcut('ctrl+shift+h') },
    { id: 'delete', label: 'Delete', icon: Trash2, danger: true, run: () => handleShortcut('delete') },
  ],
  fields: [
    defineCardField<'shape', string>({
      id: 'card.floor.size', label: 'Size', schema: z.string(), default: '', home: 'card', control: 'readout',
      read: (o) => {
        const b = bounds(o);
        return `${b.w} × ${b.h} sq`;
      },
      write: noWrite,
    }),
    defineCardField<'shape', null>({
      id: 'card.floor.layer', label: 'Layer', schema: z.null(), default: null, home: 'card', control: 'custom',
      render: LayerField, read: () => null, write: noWrite,
    }),
    defineCardField<'shape', string>({
      id: 'card.floor.colour', label: 'Colour', schema: z.string(), default: '#cfc3ad', home: 'card', control: 'colour', section: 'Look',
      read: () => '#cfc3ad', write: noWrite,
    }),
    defineCardField<'shape', null>({
      id: 'card.floor.texture', label: 'Texture', schema: z.null(), default: null, home: 'card', control: 'custom', section: 'Look',
      render: TextureField, read: () => null, write: noWrite,
    }),
    defineCardField<'shape', string>({
      id: 'card.floor.tint', label: 'Tint', schema: z.string(), default: '', home: 'card', control: 'colour', section: 'Look',
      read: (o) => o.textureTint, write: noWrite,
    }),
    defineCardField<'shape', number>({
      id: 'card.floor.opacity', label: 'Opacity', schema: z.number().min(0).max(1), default: 1, home: 'card', control: 'slider', section: 'Look',
      range: { min: 0, max: 1, step: 0.05, unit: '%' }, read: () => 1, write: noWrite,
    }),
    defineCardField<'shape', string>({
      id: 'card.floor.fill', label: 'Fill', schema: z.string(), default: '', home: 'card', control: 'custom', section: 'Look',
      render: FillField,
      read: (o) => `scale ${o.textureScale} · ${Math.round(o.textureFillRotation)}° · offset ${o.textureOffsetX}, ${o.textureOffsetY}`,
      write: noWrite,
    }),
    defineCardField<'shape', string>({
      id: 'card.floor.edgeBand', label: 'Edge band', schema: z.string(), default: 'cave-ink', home: 'card', control: 'select', section: 'Edge',
      options: EDGE_BANDS, read: () => 'cave-ink', write: noWrite,
    }),
  ],
});

export const stubInput = {
  rail: RAIL_TOOLS,
  families: [design, terrain, objects, environment, text],
  shared: SHARED_SETTINGS,
  cards: [floorCard],
};

export const stubRegistry = createRegistry(stubInput);
