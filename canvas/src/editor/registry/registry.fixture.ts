// A small, valid registry for the registry and settings tests. Each rule's test breaks
// one thing in a copy of it.

import { Square, SquareDashed, Triangle } from 'lucide-react';
import { z } from 'zod';
import { defineFamily, defineSetting, defineTool, type RegistryInput } from './index';
import { RAIL_TOOLS } from './rail';
import { SHARED_SETTINGS, editCurve, editNodeMode, gridSnap } from './shared';

export const sides = defineSetting<number>({
  id: 'fixture.sides',
  label: 'Sides',
  schema: z.number().int().min(3).max(32),
  default: 6,
  home: 'dock',
  control: 'stepper',
  range: { min: 3, max: 32, step: 1 },
  path: 'regularPolygon.sides',
});

export const secret = defineSetting<boolean>({
  id: 'fixture.secret',
  label: 'Secret',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Door',
  path: 'doorSecret',
});

export const scale = defineSetting<number>({
  id: 'fixture.scale',
  label: 'Scale',
  schema: z.number().min(0.25).max(4),
  default: 1,
  home: 'dock',
  control: 'slider',
  range: { min: 0.25, max: 4, step: 0.05 },
  path: 'scatterBrush.stampScale',
});

export const scaleRange = defineSetting<[number, number]>({
  id: 'fixture.scaleRange',
  label: 'Scale range',
  schema: z.tuple([z.number().min(0.1), z.number().min(0.1)]).refine(([lo, hi]) => lo <= hi),
  default: [0.8, 1.2],
  home: 'panel',
  control: 'range',
  section: 'Scatter',
  path: 'scatterBrush.scaleRange',
});

const hint = () => ({ label: 'Fixture', segments: [{ text: 'Click to place' }] });

export const shapeTool = defineTool({
  id: 'fixture',
  label: 'Fixture',
  description: 'A tool for the tests',
  icon: SquareDashed,
  key: 'F',
  engine: ['polygon'],
  settings: [sides, editCurve, editNodeMode, secret, gridSnap, scale, scaleRange],
  dock: [],
  hint,
});

export const otherTool = defineTool({
  id: 'fixture2',
  label: 'Other',
  description: 'Shares snap and curve with the first',
  icon: Triangle,
  key: 'W',
  engine: ['wall'],
  settings: [editCurve, gridSnap],
  dock: [],
  hint,
});

export const fixtureFamily = defineFamily({
  id: 'design',
  label: 'Design',
  icon: Square,
  key: 'D',
  tools: [shapeTool, otherTool],
});

export function fixtureInput(): RegistryInput {
  return { rail: RAIL_TOOLS, families: [fixtureFamily], shared: SHARED_SETTINGS, cards: [] };
}
