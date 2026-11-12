// The Material brush: a freehand stroke closes into one solid patch of a material on the
// layer in hand, the material's border units laid round it on release, "like scatter but
// fuller". Size and the material swatches are what changes mid-painting, so they sit in the
// dock; Paint or erase, Smooth, Border, whether it paints a real floor and the patch's height
// are set up in the panel, and with water in hand its shore, the shore's width and the shallow line.

import { Layers2 } from 'lucide-react';
import { z } from 'zod';
import { MATERIAL_BRUSH_RANGES } from '@/store/slices/tools';
import { useStore } from '@/store/store';
import type { MaterialToolSettings } from '@/store/types';
import { defaultShoreId, isTextureMaterial, isWaterMaterial } from '@dnd/core/src/assets/materialKit';
import { SHORE_DEFAULT_WIDTH, SHORE_MAX_WIDTH, SHORE_MIN_WIDTH, shoreWidthOf } from '@dnd/core/src/shared/materialPatch';
import { GROUND_HEIGHT_MAX, GROUND_HEIGHT_MIN, GROUND_HEIGHT_STEP, groundHeightOf } from '@dnd/core/src/shared/plateaus';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { CoreStore, DockColumnDef } from '@/editor/registry/types';
import { terrainMode } from './brush';
import { MaterialsColumn, ShoreField } from './MaterialsColumn';

const { radius } = MATERIAL_BRUSH_RANGES;

/** A plain floor texture in hand: no border units to lay and no band to wall a real floor with. */
const bandInHand = () => !isTextureMaterial(useStore.getState().tools.settings.material.material);

/** Brush radius in cells. [ and ] and the wheel step it too (MaterialTool). */
export const materialSize = defineSetting<number>({
  id: 'material.size',
  label: 'Size',
  schema: z.number().min(radius.min).max(radius.max),
  default: 3,
  home: 'dock',
  control: 'stepper',
  section: 'Size',
  range: { ...radius, unit: 'sq' },
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
  visibleWhen: bandInHand,
});

/** A water texture in hand: its patches get a shore. */
const waterInHand = () => isWaterMaterial(useStore.getState().tools.settings.material.material);

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

export const materialBrushTool = defineTool({
  id: 'materialBrush',
  label: 'Material brush',
  description: "Paint a solid patch with the material's border",
  icon: Layers2,
  // M is Measure's on the rail; A is free in the family and everywhere the family is live.
  key: 'A',
  engine: ['material'],
  settings: [materialSize, terrainMode, materialRockOnCut, materialSmooth, materialBorder, materialFloor, materialHeight, materialShore, materialShoreWidth, materialShallowLine],
  dock: [materialsColumn],
  keys: [
    { id: 'size.down', combo: '[', label: 'Brush smaller' },
    { id: 'size.up', combo: ']', label: 'Brush larger' },
  ],
  hint: (s) => {
    const floor = s.tools.settings.material.floor && !isTextureMaterial(s.tools.settings.material.material);
    // On a cave's floor Erase opens the rock it crosses, unless Rock on cut edge keeps it closed.
    const carve = s.tools.settings.material.rockOnCut ? 'Carve the floor · ' : 'Erase across the rock to open the cave · ';
    return {
      label: 'Material brush',
      segments: s.tools.eraseMode
        ? [t(floor ? carve : 'Erase from patches · '), k('['), t(' '), k(']'), t(' size')]
        : [t(floor ? 'Paint a cave floor · release to close it · ' : 'Paint a patch · release to close it · '), k('Alt'), t(' erase')],
    };
  },
});
