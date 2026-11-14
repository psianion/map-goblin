// The brush: a freehand stroke closes into one floor piece on the layer in hand, in the
// layer's one stack, where the top piece wins. The rail's Material, Terrain and Water entries
// are this one tool with these same controls; they differ only in which textures each lists
// first and remembers (brush.ts). Size, Strength, Feather, Paint over rooms and the swatches
// change mid-painting, so they sit in the dock; Paint or erase, Smooth, Border, whether a band set
// paints a real floor and the piece's height are set up in the panel, and with water in hand
// its shore, the shore's width and the shallow line.

import { Layers2 } from 'lucide-react';
import { z } from 'zod';
import { MATERIAL_BRUSH_RANGES } from '@/store/slices/tools';
import { useStore } from '@/store/store';
import type { BrushKind, MaterialToolSettings } from '@/store/types';
import { brushMaterial, defaultShoreId, isTextureMaterial, isWaterMaterial } from '@dnd/core/src/assets/materialKit';
import { SHORE_DEFAULT_WIDTH, SHORE_MAX_WIDTH, SHORE_MIN_WIDTH, shoreWidthOf } from '@dnd/core/src/shared/materialPatch';
import { GROUND_HEIGHT_MAX, GROUND_HEIGHT_MIN, GROUND_HEIGHT_STEP, groundHeightOf } from '@dnd/core/src/shared/plateaus';
import { FEATHER_DEFAULT, featherOf } from '@dnd/core/src/shared/pieceFades';
import { selectedPieceIds } from '@dnd/core/src/engine/tools/eraseShapes';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { CoreStore, DockColumnDef, EditorState, SettingDef } from '@/editor/registry/types';
import { MaterialsColumn, ShoreField } from './MaterialsColumn';

const { radius } = MATERIAL_BRUSH_RANGES;

/** Which entry of the brush is in hand: the engine tool names it. */
export function brushKindOf(s: { tools: { activeTool: string } }): BrushKind {
  return s.tools.activeTool === 'terrain' || s.tools.activeTool === 'water' ? s.tools.activeTool : 'material';
}

/** What the entry in hand paints with. */
export function materialInHand(s: { tools: { activeTool: string; settings: { material: MaterialToolSettings } } }): string {
  return brushMaterial(s.tools.settings.material, brushKindOf(s));
}

/** A plain floor texture in hand: no border units to lay and no band to wall a real floor with. */
const bandInHand = () => !isTextureMaterial(materialInHand(useStore.getState()));

/** A band set with Border on: the only brush a real floor can be walled with. */
const walledInHand = () => bandInHand() && useStore.getState().tools.settings.material.border;

/** Feather does something: always erasing; painting, for any stroke that lands as a ground piece with no rim. */
const featherApplies = () => useStore.getState().tools.eraseMode || !walledInHand();

/** Paint, or erase: the erase mode Scatter shares, drawn as a seg here. Erase cuts the top piece under the stroke, or the selected pieces. */
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

/** Strength: the opacity a new piece is painted at; erasing, how much a pass takes off. */
export const materialStrength = defineSetting<number>({
  id: 'material.strength',
  label: 'Strength',
  schema: z.number().min(0.1).max(1),
  default: 1,
  home: 'dock',
  control: 'slider',
  typed: true,
  section: 'Strength',
  range: { min: 0.1, max: 1, step: 0.05, unit: '%' },
  bind: {
    read: (s) => s.tools.settings.material.strength ?? 1,
    write: (store, v) =>
      store.setState((s) => {
        s.tools.settings.material.strength = v >= 1 ? undefined : Math.max(0.1, Math.round(v * 20) / 20);
      }),
  },
});

/**
 * Feather: the share of the brush's radius that fades, painting and erasing alike, as a
 * light's feather does. 0 is a hard brush; the cursor shows a second ring where it starts.
 */
export const materialFeather = defineSetting<number>({
  id: 'material.feather',
  label: 'Feather',
  schema: z.number().min(0).max(1),
  default: FEATHER_DEFAULT,
  home: 'dock',
  control: 'slider',
  typed: true,
  section: 'Feather',
  range: { min: 0, max: 1, step: 0.05, unit: '%' },
  visibleWhen: featherApplies,
  bind: {
    read: (s) => featherOf(s.tools.settings.material),
    write: (store, v) =>
      store.setState((s) => {
        const next = Math.min(1, Math.max(0, Math.round(v * 20) / 20));
        s.tools.settings.material.feather = next === FEATHER_DEFAULT ? undefined : next;
      }),
  },
});

/**
 * Off, a stroke keeps to the side of the walls it started on: begun outside a walled room or
 * cave it stops at the wall, begun inside it stays inside. On, it covers whatever is under
 * it, border and inside; wall art stays drawn on top.
 */
export const materialOverRooms = defineSetting<boolean>({
  id: 'material.overRooms',
  label: 'Paint over rooms',
  schema: z.boolean(),
  default: false,
  home: 'dock',
  control: 'switch',
  section: 'Rooms',
  bind: {
    read: (s) => s.tools.settings.material.overRooms === true,
    write: (store, on) =>
      store.setState((s) => {
        s.tools.settings.material.overRooms = on ? true : undefined;
      }),
  },
});

/** Brush radius in cells. [ and ] and the wheel step it too (MaterialTool). */
export const materialSize = defineSetting<number>({
  id: 'material.size',
  label: 'Size',
  schema: z.number().min(radius.min).max(radius.max),
  default: 3,
  home: 'dock',
  control: 'slider',
  typed: true,
  section: 'Size',
  // Cells, read as a bare number beside the slider ("0.5").
  range: { ...radius },
  path: 'material.radius',
});

/** Erasing a cave's real floor: the one case Erase can open a cave's rock. */
const erasingCave = () => {
  const { eraseMode, settings } = useStore.getState().tools;
  return eraseMode && settings.material.floor && bandInHand();
};

/**
 * Off, an erase across a cave's rock leaves the cut open to the ground outside (a cave
 * mouth); on, the rock re-forms round the cut, for reshaping a cave.
 */
export const materialRockOnCut = defineSetting<boolean>({
  id: 'material.rockOnCut',
  label: 'Rock on cut edge',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Mode',
  visibleWhen: erasingCave,
  bind: {
    read: (s) => s.tools.settings.material.rockOnCut === true,
    write: (store, on) =>
      store.setState((s) => {
        s.tools.settings.material.rockOnCut = on ? true : undefined;
      }),
  },
});

/** Rounds the patch's outline before the border goes on. */
export const materialSmooth = defineSetting<boolean>({
  id: 'material.smooth',
  label: 'Smooth',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Outline',
  path: 'material.smooth',
});

/** The material's border units laid round the patch. */
export const materialBorder = defineSetting<boolean>({
  id: 'material.border',
  label: 'Border',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Outline',
  path: 'material.border',
  visibleWhen: bandInHand,
});

/**
 * On, a stroke paints real floors (the material's fill, its band as the wall set) that the
 * rooms, doors, light and the table all see; off, a paint-only patch.
 */
export const materialFloor = defineSetting<boolean>({
  id: 'material.floor',
  label: 'Paint a real floor',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Outline',
  path: 'material.floor',
  visibleWhen: walledInHand,
});

/** A water texture in hand: its pieces get a shore. */
const waterInHand = () => isWaterMaterial(materialInHand(useStore.getState()));

const setMaterial = (store: CoreStore, patch: Partial<MaterialToolSettings>) =>
  store.setState((s) => {
    Object.assign(s.tools.settings.material, patch);
  });

/** A water patch's shore: a ground texture on the land side, or None. Absent = the dirt floor. */
export const materialShore = defineSetting<string>({
  id: 'material.shore',
  label: 'Shore',
  schema: z.string(),
  default: '',
  home: 'panel',
  control: 'custom',
  section: 'Water',
  render: ShoreField,
  visibleWhen: waterInHand,
  bind: {
    // '' is the default shore (the dirt floor); the field shows it by name.
    read: (s) => s.tools.settings.material.shore ?? '',
    write: (store, v) => {
      if (v) setMaterial(store, { shore: v === defaultShoreId() ? undefined : v });
    },
  },
});

/** The shore band's width, cells. */
export const materialShoreWidth = defineSetting<number>({
  id: 'material.shoreWidth',
  label: 'Shore width',
  schema: z.number().min(SHORE_MIN_WIDTH).max(SHORE_MAX_WIDTH),
  default: SHORE_DEFAULT_WIDTH,
  home: 'panel',
  control: 'stepper',
  section: 'Water',
  range: { min: SHORE_MIN_WIDTH, max: SHORE_MAX_WIDTH, step: 0.25, unit: 'sq' },
  visibleWhen: waterInHand,
  bind: {
    read: (s) => shoreWidthOf(s.tools.settings.material.shoreWidth),
    write: (store, w) => setMaterial(store, { shoreWidth: w === SHORE_DEFAULT_WIDTH ? undefined : w }),
  },
});

/** A pale line just inside the water along its edge. */
export const materialShallowLine = defineSetting<boolean>({
  id: 'material.shallowLine',
  label: 'Shallow line',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Water',
  visibleWhen: waterInHand,
  bind: {
    read: (s) => s.tools.settings.material.shallowLine === true,
    write: (store, on) => setMaterial(store, { shallowLine: on ? true : undefined }),
  },
});

/** The height new patches take, cells, in half steps; patches of another height do not merge. */
export const materialHeight = defineSetting<number>({
  id: 'material.height',
  label: 'Height',
  schema: z.number().min(GROUND_HEIGHT_MIN).max(GROUND_HEIGHT_MAX),
  default: 0,
  home: 'panel',
  control: 'stepper',
  section: 'Height',
  range: { min: GROUND_HEIGHT_MIN, max: GROUND_HEIGHT_MAX, step: GROUND_HEIGHT_STEP, unit: 'sq' },
  bind: {
    read: (s) => s.tools.settings.material.height ?? 0,
    write: (store, v) => setMaterial(store, { height: groundHeightOf(v) || undefined }),
  },
});

const materialsColumn: DockColumnDef = { id: 'material.swatches', caption: 'Material', render: MaterialsColumn };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

/** The brush's controls, the same under every entry. */
export const BRUSH_SETTINGS: SettingDef[] = [
  materialSize,
  materialStrength,
  materialFeather,
  materialOverRooms,
  terrainMode,
  materialRockOnCut,
  materialSmooth,
  materialBorder,
  materialFloor,
  materialHeight,
  materialShore,
  materialShoreWidth,
  materialShallowLine,
];

export const BRUSH_KEYS = [
  { id: 'size.down', combo: '[', label: 'Brush smaller' },
  { id: 'size.up', combo: ']', label: 'Brush larger' },
];

/** The status line under an entry of the brush. */
export function brushHint(label: string) {
  return (s: EditorState) => {
    const floor = s.tools.settings.material.floor && !isTextureMaterial(materialInHand(s));
    // A stroke lands as cave floor only with Border on too; without, it paints a ground piece.
    const cave = floor && s.tools.settings.material.border;
    // On a cave's floor Erase opens the rock it crosses, unless Rock on cut edge keeps it closed.
    const carve = s.tools.settings.material.rockOnCut ? 'Carve the floor · ' : 'Erase across the rock to open the cave · ';
    // Pieces selected on the layer in hand: the erase keeps to them until Escape lets them go.
    const layer = s.layers.find((l) => l.id === s.ui.activeLayerId);
    const only = layer?.type === 'dungeon' && selectedPieceIds(layer, s.selection.selectedIds) !== undefined;
    return {
      label,
      segments: s.tools.eraseMode
        ? only
          ? [t('Erasing only the selected piece · '), k('['), t(' '), k(']'), t(' size · '), k('Esc'), t(' erase anything')]
          : [t(floor ? carve : 'Erase the top piece, or the selected one · '), k('['), t(' '), k(']'), t(' size')]
        :[t(cave ? 'Paint a cave floor · release to close it · ' : 'Paint a piece · release to close it · '), k('Alt'), t(' erase')],
    };
  };
}

export const materialBrushTool = defineTool({
  id: 'materialBrush',
  label: 'Material brush',
  description: 'Paint floor pieces: caves with their rock, ground and water',
  icon: Layers2,
  // M is Measure's on the rail; A is free in the family and everywhere the family is live.
  key: 'A',
  engine: ['material'],
  settings: BRUSH_SETTINGS,
  dock: [materialsColumn],
  keys: BRUSH_KEYS,
  hint: brushHint('Material brush'),
});
