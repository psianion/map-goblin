// The Elevation tool: plateaus, rings of relief raised or sunk over floors and terrain.
// Every setting belongs to the plateau, so all sit in the dock: Height, Edge, how it is drawn
// (Pen or Brush, its Size, Curve), the Top, and what the edge draws with (a cliff's art, a
// painted border's texture and width, a slope's face and direction). No cave brush (plan 6.1).
//
// One rule for every dock control: with plateaus picked it shows the first one's value, and a
// change writes every picked plateau as one undo step and sets the tool's value for the next
// plateau too; with none picked it sets the tool's value only.

import { Brush, Mountain, PenLine } from 'lucide-react';
import { z } from 'zod';
import type { DungeonLayer, PlateauChild, PlateauToolSettings } from '@/store/types';
import { PLATEAU_BRUSH_RADIUS, PLATEAU_DEFAULTS } from '@dnd/core/src/engine/tools/PlateauTool';
import { PAINTED_BORDER, paintedBorderArt, paintedBorderTexture } from '@dnd/core/src/engine/plateauKit';
import { BORDER_DEFAULT_WIDTH, BORDER_MAX_WIDTH, BORDER_MIN_WIDTH, borderWidthOf, DEFAULT_FACE_DIRECTION, faceDirectionOf } from '@dnd/core/src/shared/plateauShade';
import { edgeOf, ownHeight } from '@dnd/core/src/shared/plateaus';
import { setPlateauFields, type PlateauPatch } from '@dnd/core/src/store/plateauCommands';
import { MATERIAL_BRUSH_RANGES } from '@/store/slices/tools';
import { defineSetting, defineTool } from '@/editor/registry/define';
import { editCurve } from '@/editor/registry/shared';
import type { CoreStore, EditorState, HintLine } from '@/editor/registry/types';
import { HeightControl } from './controls';
import { BorderTextureField, CliffArtField, FaceArtField, SlopeDirectionField, TopArtField } from './PlateauFields';
import { runEdit } from './cardWrites';
import {
  BORDER_STEP,
  cliffArtValue,
  DEFAULT_ART,
  EDGE_OPTIONS,
  edgeArtFor,
  faceArtFor,
  faceArtValue,
  GROUND_FACE,
  GROUND_TOP,
  topArtFor,
  topArtValue,
} from './plateauModel';

/** The plateau settings with their defaults filled in: the group is absent on old settings. */
function plateauOf(s: Pick<EditorState, 'tools'>): PlateauToolSettings {
  return { ...PLATEAU_DEFAULTS, ...s.tools.settings.plateau };
}

function setPlateau(store: CoreStore, patch: Partial<PlateauToolSettings>): void {
  const st = store.getState();
  st.updateToolSettings({ plateau: { ...plateauOf(st), ...patch } });
}

/** The plateaus the dock acts on: the picked ones, while the Elevation tool is in hand. */
export function pickedPlateaus(s: Pick<EditorState, 'tools' | 'selection' | 'layers'>): PlateauChild[] {
  if (s.tools.activeTool !== 'plateau' || s.selection.selectedIds.length === 0) return [];
  const ids = new Set(s.selection.selectedIds);
  const out: PlateauChild[] = [];
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    for (const c of (l as DungeonLayer).children) if (c.childType === 'plateau' && ids.has(c.id)) out.push(c);
  }
  return out;
}

/**
 * A dock setting's binding under the one rule: `read` shows the first picked plateau's value,
 * else the tool's (`tool`); a write lands `patch` on every picked plateau as one undo step
 * (`label`) and sets the tool by `toTool`.
 */
function plateauBind<T>(
  label: string,
  read: (p: PlateauChild, s: EditorState) => T,
  tool: (t: PlateauToolSettings, s: EditorState) => T,
  patch: (p: PlateauChild, v: T) => PlateauPatch,
  toTool: (v: T, t: PlateauToolSettings) => Partial<PlateauToolSettings>,
) {
  return {
    read: (s: EditorState): T => {
      const [first] = pickedPlateaus(s);
      return first ? read(first, s) : tool(plateauOf(s), s);
    },
    write: (store: CoreStore, v: T): void => {
      const picked = pickedPlateaus(store.getState());
      if (picked.length > 0) runEdit(label, picked.flatMap((p) => setPlateauFields(p.id, patch(p, v), label) ?? []));
      setPlateau(store, toTool(v, plateauOf(store.getState())));
    },
  };
}

/** Cells, whole, never 0: a plateau is never flat. Negative is a pit. */
export const elevationHeight = defineSetting<number>({
  id: 'elevation.height',
  label: 'Height',
  schema: z.number().int().min(-20).max(20).refine((n) => n !== 0),
  default: PLATEAU_DEFAULTS.height,
  home: 'dock',
  control: 'custom',
  section: 'Height',
  range: { min: -20, max: 20, step: 1 },
  render: HeightControl,
  bind: plateauBind(
    'Plateau height',
    (p) => ownHeight(p),
    (t) => t.height,
    (_p, height) => ({ height }),
    (height) => ({ height }),
  ),
});

export const elevationEdge = defineSetting<PlateauToolSettings['edge']>({
  id: 'elevation.edge',
  label: 'Edge',
  schema: z.enum(['none', 'slope', 'cliff']),
  default: PLATEAU_DEFAULTS.edge,
  home: 'dock',
  control: 'seg',
  section: 'Edge',
  options: EDGE_OPTIONS.map(({ value, label }) => ({ value, label })),
  bind: plateauBind(
    'Plateau edge',
    (p) => edgeOf(p),
    (t) => t.edge,
    (_p, edge) => ({ edge }),
    (edge) => ({ edge }),
  ),
});

/** Click points, or paint the plateau with a round brush. */
export const elevationInput = defineSetting<'pen' | 'brush'>({
  id: 'elevation.input',
  label: 'Draw',
  schema: z.enum(['pen', 'brush']),
  default: 'pen',
  home: 'dock',
  control: 'seg',
  section: 'Draw',
  options: [
    { value: 'pen', label: 'Pen', icon: PenLine },
    { value: 'brush', label: 'Brush', icon: Brush },
  ],
  bind: {
    read: (s) => plateauOf(s).input ?? 'pen',
    write: (store, input) => setPlateau(store, { input: input === 'pen' ? undefined : input }),
  },
});

const { radius } = MATERIAL_BRUSH_RANGES;

/** The brush's radius in cells, on the Material brush's range and step. [ and ] and the wheel step it too (PlateauTool). */
export const elevationBrushSize = defineSetting<number>({
  id: 'elevation.brushSize',
  label: 'Size',
  schema: z.number().min(radius.min).max(radius.max),
  default: PLATEAU_BRUSH_RADIUS,
  home: 'dock',
  control: 'stepper',
  section: 'Size',
  range: { ...radius },
  visibleWhen: (get) => get('elevation.input') === 'brush',
  bind: {
    read: (s) => plateauOf(s).brushRadius ?? PLATEAU_BRUSH_RADIUS,
    write: (store, brushRadius) => setPlateau(store, { brushRadius }),
  },
});

/** What the top of the next plateau, and of the picked ones, is laid with: Ground or a floor. */
export const elevationTopArt = defineSetting<string>({
  id: 'elevation.topArt',
  label: 'Top',
  schema: z.string().min(1),
  default: GROUND_TOP,
  home: 'dock',
  control: 'custom',
  section: 'Top',
  render: TopArtField,
  bind: plateauBind(
    'Plateau top',
    (p) => topArtValue(p.topArt),
    (t) => topArtValue(t.topArt),
    (_p, v) => ({ topArt: topArtFor(v) }),
    (v) => ({ topArt: topArtFor(v) }),
  ),
});

const isCliff = (get: (id: string) => unknown) => get('elevation.edge') === 'cliff';
const isPainted = (get: (id: string) => unknown) => isCliff(get) && get('elevation.cliffArt') === PAINTED_BORDER;

/** What a cliff is laid with: the card's Cliff art choices. */
export const elevationCliffArt = defineSetting<string>({
  id: 'elevation.cliffArt',
  label: 'Cliff art',
  schema: z.string().min(1),
  default: DEFAULT_ART,
  home: 'dock',
  control: 'custom',
  section: 'Cliff art',
  render: CliffArtField,
  visibleWhen: isCliff,
  bind: plateauBind(
    'Cliff art',
    (p) => cliffArtValue(p.edgeArt),
    (t) => cliffArtValue(t.edgeArt),
    (p, v) => ({ edgeArt: edgeArtFor(v, p.edgeArt) }),
    (v, t) => ({ edgeArt: edgeArtFor(v, t.edgeArt) }),
  ),
});

/** A painted border's texture. An empty choice changes nothing. */
export const elevationBorderTexture = defineSetting<string>({
  id: 'elevation.paintTexture',
  label: 'Texture',
  schema: z.string(),
  default: '',
  home: 'dock',
  control: 'custom',
  section: 'Border',
  render: BorderTextureField,
  visibleWhen: isPainted,
  bind: (() => {
    const b = plateauBind<string>(
      'Border texture',
      (p) => paintedBorderTexture(p.edgeArt) ?? '',
      (t) => paintedBorderTexture(t.edgeArt) ?? '',
      (_p, id) => ({ edgeArt: paintedBorderArt(id) }),
      (id) => ({ edgeArt: paintedBorderArt(id) }),
    );
    return { read: b.read, write: (store: CoreStore, id: string) => (id ? b.write(store, id) : undefined) };
  })(),
});

/** A painted border's width, cells. */
export const elevationBorderWidth = defineSetting<number>({
  id: 'elevation.paintWidth',
  label: 'Border width',
  schema: z.number().min(BORDER_MIN_WIDTH).max(BORDER_MAX_WIDTH),
  default: BORDER_DEFAULT_WIDTH,
  home: 'dock',
  control: 'stepper',
  section: 'Border',
  range: { min: BORDER_MIN_WIDTH, max: BORDER_MAX_WIDTH, step: BORDER_STEP, unit: 'sq' },
  visibleWhen: isPainted,
  bind: plateauBind(
    'Border width',
    (p) => borderWidthOf(p.borderWidth),
    (t) => borderWidthOf(t.borderWidth),
    (_p, borderWidth) => ({ borderWidth }),
    (borderWidth) => ({ borderWidth }),
  ),
});

const isSlope = (get: (id: string) => unknown) => get('elevation.edge') === 'slope';

/** What a slope's face is drawn with: Ground or a face tile. */
export const elevationFaceArt = defineSetting<string>({
  id: 'elevation.faceArt',
  label: 'Slope face',
  schema: z.string().min(1),
  default: GROUND_FACE,
  home: 'dock',
  control: 'custom',
  section: 'Slope face',
  render: FaceArtField,
  visibleWhen: isSlope,
  bind: plateauBind(
    'Slope face',
    (p) => faceArtValue(p.faceArt),
    (t) => faceArtValue(t.faceArt),
    (_p, v) => ({ faceArt: faceArtFor(v) }),
    (v) => ({ faceArt: faceArtFor(v) }),
  ),
});

/**
 * The way a slope's faces point, degrees: the next plateau's (else the map's stored one, else
 * the default) and the picked plateaus' (a plateau saved without one shows the map's).
 */
export const elevationSlopeDirection = defineSetting<number>({
  id: 'elevation.slopeDirection',
  label: 'Slope direction',
  schema: z.number().int().min(0).max(359),
  default: DEFAULT_FACE_DIRECTION,
  home: 'dock',
  control: 'custom',
  section: 'Slope direction',
  render: SlopeDirectionField,
  visibleWhen: isSlope,
  bind: plateauBind(
    'Slope direction',
    (p, s) => faceDirectionOf(p, s.mapSettings.faceDirection),
    (t, s) => faceDirectionOf(t, s.mapSettings.faceDirection),
    (_p, faceDir) => ({ faceDir }),
    (faceDir) => ({ faceDir }),
  ),
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

const PEN_HINT: HintLine = {
  label: 'Elevation',
  segments: [
    t('Click points or drag freehand · click the first point or '),
    k('Enter'),
    t(' to finish · '),
    k('Backspace'),
    t(' last point · '),
    k('Shift'),
    t(' 15° steps · '),
    k('Esc'),
    t(' cancel'),
  ],
};

const BRUSH_HINT: HintLine = {
  label: 'Elevation',
  segments: [t('Paint a plateau · release to close it, over a matching one to grow it · '), k('['), t(' '), k(']'), t(' size · '), k('Esc'), t(' cancel')],
};

export const elevationTool = defineTool({
  id: 'elevation',
  label: 'Elevation',
  description: 'Plateaus and pits over floors or terrain',
  icon: Mountain,
  // Not E: that is the Environment family's own key.
  key: 'L',
  engine: ['plateau'],
  settings: [
    elevationHeight,
    elevationEdge,
    elevationInput,
    elevationBrushSize,
    editCurve,
    elevationTopArt,
    elevationCliffArt,
    elevationBorderTexture,
    elevationBorderWidth,
    elevationFaceArt,
    elevationSlopeDirection,
  ],
  dock: [],
  hint: (s) => (plateauOf(s).input === 'brush' ? BRUSH_HINT : PEN_HINT),
});
