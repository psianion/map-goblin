// The Light tool: Bright, Dim, Intensity, Colour and the presets in the dock; Cone,
// Direction, Effect, Speed and Through walls in the panel. All of it sets up the next light
// (tools.settings.lightDefaults); a placed light is changed on its card.
//
// Gone from it: the Flicker switch (Effect says it), Falloff, Night only, Darkvision sees
// through, and the Darkness toggle (the Darkness preset is the way to one).

import { Lightbulb } from 'lucide-react';
import { z } from 'zod';
import type { LightDefaults } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { CoreStore, DockColumnDef, EditorState } from '@/editor/registry/types';
import { DockColourSwatch, FeetStepper, PercentSlider, PresetsColumn, SkyButton } from './LightControls';
import {
  CONE_RANGE,
  DIRECTION_RANGE,
  EFFECTS,
  INTENSITY_RANGE,
  LIGHT_RADIUS_FT,
  SPEED_RANGE,
  animationFor,
  brightPatch,
  coneAngle,
  coneDirection,
  conePatch,
  dimPatch,
  effectOf,
  speedOf,
  toFt,
  type Effect,
} from './lightModel';

const next = (s: EditorState): LightDefaults => s.tools.settings.lightDefaults;
const ftPerCell = (s: EditorState) => s.mapSettings.cellScale.value;
/** A hand edit is no longer the preset it started from, so the preset tile lets go. */
const setNext = (store: CoreStore, patch: Partial<LightDefaults>) => store.getState().updateLightDefaults({ ...patch, presetId: undefined });

const feet = z.number().int().min(LIGHT_RADIUS_FT.min).max(LIGHT_RADIUS_FT.max);

export const lightBright = defineSetting<number>({
  id: 'light.bright',
  label: 'Bright',
  schema: feet,
  default: 5,
  home: 'dock',
  control: 'custom',
  section: 'Bright',
  range: { ...LIGHT_RADIUS_FT, unit: 'ft' },
  render: FeetStepper,
  bind: {
    read: (s) => toFt(next(s).featherRadius, ftPerCell(s)),
    write: (store, ft) => setNext(store, brightPatch(next(store.getState()), ft, ftPerCell(store.getState()))),
  },
});

export const lightDim = defineSetting<number>({
  id: 'light.dim',
  label: 'Dim',
  schema: feet,
  default: 30,
  home: 'dock',
  control: 'custom',
  section: 'Dim',
  range: { ...LIGHT_RADIUS_FT, unit: 'ft' },
  render: FeetStepper,
  bind: {
    read: (s) => toFt(next(s).radius, ftPerCell(s)),
    write: (store, ft) => setNext(store, dimPatch(next(store.getState()), ft, ftPerCell(store.getState()))),
  },
});

export const lightIntensity = defineSetting<number>({
  id: 'light.intensity',
  label: 'Intensity',
  schema: z.number().min(INTENSITY_RANGE.min).max(INTENSITY_RANGE.max),
  default: 0.9,
  home: 'dock',
  control: 'custom',
  section: 'Intensity',
  range: { ...INTENSITY_RANGE, unit: '%' },
  render: PercentSlider,
  bind: {
    read: (s) => next(s).intensity,
    write: (store, v) => setNext(store, { intensity: v }),
  },
});

export const lightColour = defineSetting<string>({
  id: 'light.colour',
  label: 'Colour',
  schema: z.string().regex(/^#[0-9a-f]{6}$/i),
  default: '#ffdd88',
  home: 'dock',
  control: 'custom',
  section: 'Colour',
  render: DockColourSwatch,
  bind: {
    read: (s) => next(s).color,
    write: (store, c) => setNext(store, { color: c }),
  },
});

export const lightCone = defineSetting<number>({
  id: 'light.cone',
  label: 'Cone',
  schema: z.number().min(CONE_RANGE.min).max(CONE_RANGE.max),
  default: 360,
  home: 'panel',
  control: 'slider',
  section: 'Shape',
  range: { ...CONE_RANGE, unit: '°' },
  bind: {
    read: (s) => coneAngle(next(s)),
    write: (store, angle) => setNext(store, conePatch(next(store.getState()), angle)),
  },
});

export const lightDirection = defineSetting<number>({
  id: 'light.direction',
  label: 'Direction',
  schema: z.number().min(0).max(359),
  default: 0,
  home: 'panel',
  control: 'slider',
  section: 'Shape',
  range: { ...DIRECTION_RANGE, unit: '°' },
  // A full circle points nowhere.
  visibleWhen: (get) => (get('light.cone') as number) < 360,
  bind: {
    read: (s) => coneDirection(next(s)),
    write: (store, direction) => {
      const d = next(store.getState());
      setNext(store, { cone: { angle: coneAngle(d), direction } });
    },
  },
});

export const lightEffect = defineSetting<Effect>({
  id: 'light.effect',
  label: 'Effect',
  schema: z.enum(['none', 'flicker', 'pulse']),
  default: 'none',
  home: 'panel',
  control: 'seg',
  section: 'Effect',
  options: EFFECTS,
  bind: {
    read: (s) => effectOf(next(s)),
    write: (store, effect) => setNext(store, { animation: animationFor(effect, speedOf(next(store.getState()))) }),
  },
});

export const lightSpeed = defineSetting<number>({
  id: 'light.speed',
  label: 'Speed',
  schema: z.number().min(SPEED_RANGE.min).max(SPEED_RANGE.max),
  default: 1,
  home: 'panel',
  control: 'slider',
  section: 'Effect',
  range: { ...SPEED_RANGE, unit: '×' },
  visibleWhen: (get) => get('light.effect') !== 'none',
  bind: {
    read: (s) => speedOf(next(s)),
    write: (store, speed) => setNext(store, { animation: animationFor(effectOf(next(store.getState())), speed) }),
  },
});

export const lightThroughWalls = defineSetting<boolean>({
  id: 'light.throughWalls',
  label: 'Through walls',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Reach',
  bind: {
    read: (s) => next(s).throughWalls === true,
    write: (store, on) => setNext(store, { throughWalls: on ? true : undefined }),
  },
});

const presetsColumn: DockColumnDef = { id: 'light.presets', caption: 'Presets', render: PresetsColumn };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const lightTool = defineTool({
  id: 'light',
  label: 'Light',
  description: 'Torches, lanterns, candles and darkness',
  icon: Lightbulb,
  key: 'L',
  engine: ['light'],
  settings: [lightBright, lightDim, lightIntensity, lightColour, lightCone, lightDirection, lightEffect, lightSpeed, lightThroughWalls],
  dock: [presetsColumn],
  panelExtra: SkyButton,
  hint: () => ({
    label: 'Light',
    segments: [
      t('Click to place a light, on a prop to attach it · wheel sizes bright · '),
      k('Shift'),
      t('+wheel dim · '),
      k('R'),
      t(' turns the cone'),
    ],
  }),
});
