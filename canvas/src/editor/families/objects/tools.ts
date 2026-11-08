// Stamp and Scatter: two tools over the one props brush (the core's scatterBrush), told
// apart by its stamp mode. They share the pool of props, the prop strip and Place under.

import { FlipHorizontal2, SprayCan, Stamp } from 'lucide-react';
import { z } from 'zod';
import { PROPS_RANGES } from '@dnd/core/src/store/slices/tools';
import type { ScatterBrushSettings } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import { editErase } from '@/editor/registry/shared';
import type { CoreStore, DockColumnDef, EditorState } from '@/editor/registry/types';
import { AngleChip, CompactSlider, PropsColumn, TintSwatch, TintsField, VariantStepper } from './ObjectsControls';
import { RANDOM } from './variant';

const brush = (s: EditorState) => s.tools.settings.scatterBrush;
const setBrush = (store: CoreStore, patch: Partial<ScatterBrushSettings>) => store.getState().updateScatterBrushSettings(patch);
const HEX = /^#[0-9a-f]{6}$/i;
const toDeg = (rad: number) => Math.round((rad * 180) / Math.PI);
const toRad = (deg: number) => (deg * Math.PI) / 180;

/* ── Shared ────────────────────────────────────────────── */

/** New props go under the layer's props. Defined once; both tools list it. */
export const placeUnder = defineSetting<boolean>({
  id: 'objects.placeUnder',
  label: 'Place under',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Placement',
  path: 'scatterBrush.placeUnder',
});

const propsColumn: DockColumnDef = { id: 'objects.props', caption: 'Props', render: PropsColumn };

/* ── Stamp ─────────────────────────────────────────────── */

export const stampScale = defineSetting<number>({
  id: 'stamp.scale',
  label: 'Scale',
  schema: z.number().min(PROPS_RANGES.stampScale.min).max(PROPS_RANGES.stampScale.max),
  default: 1,
  home: 'dock',
  control: 'custom',
  section: 'Scale',
  range: { ...PROPS_RANGES.stampScale, unit: '×' },
  render: CompactSlider,
  path: 'scatterBrush.stampScale',
});

/** Degrees, whole. A new pick starts at 0. */
export const stampAngle = defineSetting<number>({
  id: 'stamp.angle',
  label: 'Angle',
  schema: z.number().int().min(0).max(359),
  default: 0,
  home: 'dock',
  control: 'custom',
  section: 'Angle',
  render: AngleChip,
  bind: {
    read: (s) => toDeg(brush(s).stampRotation) % 360,
    write: (store, deg) => setBrush(store, { stampRotation: toRad(deg) }),
  },
});

export const stampMirror = defineSetting<boolean>({
  id: 'stamp.mirror',
  label: 'Mirror',
  schema: z.boolean(),
  default: false,
  home: 'dock',
  control: 'switch',
  section: 'Angle',
  icon: FlipHorizontal2,
  key: 'F',
  path: 'scatterBrush.stampFlipX',
});

/** The family member in hand, or Random, which re-rolls it after every stamp. */
export const stampVariant = defineSetting<string>({
  id: 'stamp.variant',
  label: 'Variant',
  schema: z.string(),
  default: '',
  home: 'dock',
  control: 'custom',
  section: 'Variant',
  render: VariantStepper,
  persist: false,
  bind: {
    read: (s) => (brush(s).stampVary ? RANDOM : (brush(s).assetIds[0] ?? '')),
    write: (store, v) => {
      if (v === RANDOM) setBrush(store, { stampVary: true });
      else if (v) setBrush(store, { stampVary: false, assetIds: [v, ...brush(store.getState()).assetIds.slice(1)] });
    },
  },
});

/** The colour the next stamp is placed with: set before placing, not prop by prop after. */
export const stampTint = defineSetting<string>({
  id: 'stamp.tint',
  label: 'Tint',
  schema: z.string().regex(HEX),
  default: '#ffffff',
  home: 'dock',
  control: 'custom',
  section: 'Tint',
  render: TintSwatch,
  path: 'scatterBrush.stampTint',
});

export const keepPlacing = defineSetting<boolean>({
  id: 'stamp.keepPlacing',
  label: 'Keep placing',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Placement',
  path: 'continuousPlacement',
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const stampTool = defineTool({
  id: 'stamp',
  label: 'Stamp',
  description: 'Place one prop at a time',
  icon: Stamp,
  key: 'S',
  engine: ['scatterBrush'],
  inHand: (s) => brush(s).stampMode,
  onPick: (store) => setBrush(store, { stampMode: true }),
  opensAssets: 'object',
  settings: [stampScale, stampAngle, stampMirror, stampVariant, stampTint, keepPlacing, placeUnder],
  dock: [propsColumn],
  hint: () => ({
    label: 'Stamp',
    segments: [
      t('Click to place · wheel turns 15° · '),
      k('Alt'),
      t('+wheel scales · '),
      k('Shift'),
      t('+wheel variant · '),
      k('F'),
      t(' mirror · right-click turns 90°'),
    ],
  }),
});

/* ── Scatter ───────────────────────────────────────────── */

export const scatterRadius = defineSetting<number>({
  id: 'scatter.radius',
  label: 'Radius',
  schema: z.number().min(PROPS_RANGES.brushRadius.min).max(PROPS_RANGES.brushRadius.max),
  default: 3,
  home: 'dock',
  control: 'stepper',
  section: 'Radius',
  range: PROPS_RANGES.brushRadius,
  path: 'scatterBrush.brushRadius',
});

export const scatterDensity = defineSetting<number>({
  id: 'scatter.density',
  label: 'Density',
  schema: z.number().min(PROPS_RANGES.density.min).max(PROPS_RANGES.density.max),
  default: 0.2,
  home: 'dock',
  control: 'custom',
  section: 'Density',
  range: PROPS_RANGES.density,
  render: CompactSlider,
  path: 'scatterBrush.density',
});

/** A new pattern for the next stroke. The seed behind it stays out of sight. */
export const scatterReroll = defineSetting<number>({
  id: 'scatter.reroll',
  label: 'Re-roll',
  schema: z.number().int(),
  default: 1,
  home: 'dock',
  control: 'button',
  section: 'Density',
  persist: false,
  bind: {
    read: (s) => brush(s).seed,
    write: (store) => setBrush(store, { seed: 1 + Math.floor(Math.random() * 9999) }),
  },
});

/** The size each prop is scattered at, times its art, between two ends. */
export const scatterScaleRange = defineSetting<[number, number]>({
  id: 'scatter.scaleRange',
  label: 'Scale range',
  schema: z.tuple([z.number().min(0.1), z.number().min(0.1)]).refine(([lo, hi]) => lo <= hi),
  default: [0.8, 1.2],
  home: 'panel',
  control: 'range',
  section: 'Variety',
  range: { min: 0.3, max: 2, step: 0.05, unit: '×' },
  path: 'scatterBrush.scaleRange',
});

/**
 * The stored range in degrees, the same array while the stored one is the same: the
 * surfaces read settings in store selectors, which must not hand back a new value each call.
 */
let lastRange: readonly [number, number] | null = null;
let lastDegrees: [number, number] = [0, 360];
function degreesOf(range: readonly [number, number]): [number, number] {
  if (range !== lastRange) {
    lastRange = range;
    lastDegrees = [toDeg(range[0]), range[1] >= Math.PI * 2 - 1e-6 ? 360 : toDeg(range[1])];
  }
  return lastDegrees;
}

/** The angle each prop is scattered at, degrees, between two ends: the placer reads both. */
export const scatterRotationRange = defineSetting<[number, number]>({
  id: 'scatter.rotationRange',
  label: 'Rotation range',
  schema: z.tuple([z.number().min(0).max(360), z.number().min(0).max(360)]).refine(([lo, hi]) => lo <= hi),
  default: [0, 360],
  home: 'panel',
  control: 'range',
  section: 'Variety',
  range: { min: 0, max: 360, step: 5, unit: '°' },
  bind: {
    read: (s) => degreesOf(brush(s).rotationRange),
    write: (store, [lo, hi]) => setBrush(store, { rotationRange: [toRad(lo), toRad(hi)] }),
  },
});

export const scatterRandomVariant = defineSetting<boolean>({
  id: 'scatter.randomVariant',
  label: 'Random variant',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Variety',
  path: 'scatterBrush.randomVariant',
});

export const scatterTints = defineSetting<string[]>({
  id: 'scatter.tints',
  label: 'Tints',
  schema: z.array(z.string().regex(HEX)).max(4),
  default: [],
  home: 'panel',
  control: 'custom',
  section: 'Variety',
  render: TintsField,
  path: 'scatterBrush.tints',
});

export const scatterSpacing = defineSetting<number>({
  id: 'scatter.spacing',
  label: 'Spacing',
  schema: z.number().min(0.1).max(2),
  default: 0.5,
  home: 'panel',
  control: 'slider',
  section: 'Placement',
  range: { min: 0.2, max: 2, step: 0.1, unit: 'sq' },
  path: 'scatterBrush.minSpacing',
});

export const scatterAvoidOverlap = defineSetting<boolean>({
  id: 'scatter.avoidOverlap',
  label: 'Avoid overlaps',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Placement',
  path: 'scatterBrush.avoidOverlap',
});

export const scatterStayOnFloor = defineSetting<boolean>({
  id: 'scatter.stayOnFloor',
  label: 'Stay on floors',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Placement',
  path: 'scatterBrush.stayOnFloor',
});

export const scatterTool = defineTool({
  id: 'scatter',
  label: 'Scatter',
  description: 'Spray a pool of props with a brush',
  icon: SprayCan,
  key: 'C',
  engine: ['scatterBrush'],
  inHand: (s) => !brush(s).stampMode,
  onPick: (store) => setBrush(store, { stampMode: false }),
  settings: [
    scatterRadius,
    scatterDensity,
    scatterReroll,
    scatterScaleRange,
    scatterRotationRange,
    scatterRandomVariant,
    scatterTints,
    scatterSpacing,
    scatterAvoidOverlap,
    scatterStayOnFloor,
    placeUnder,
    editErase,
  ],
  dock: [propsColumn],
  hint: (s) => ({
    label: 'Scatter',
    segments: [
      t(s.tools.eraseMode ? 'Drag to clear props under the brush · ' : 'Drag to scatter the pool · '),
      k('Shift E'),
      t(' erase · '),
      k('Esc'),
      t(' cancel'),
    ],
  }),
});
