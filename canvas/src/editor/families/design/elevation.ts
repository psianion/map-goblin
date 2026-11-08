// The Elevation tool: plateaus, rings of relief raised or sunk over floors and terrain.
// Height and edge change per plateau, so both sit in the dock. No cave brush (plan 6.1).

import { Mountain } from 'lucide-react';
import { z } from 'zod';
import type { PlateauToolSettings } from '@/store/types';
import { PLATEAU_DEFAULTS } from '@dnd/core/src/engine/tools/PlateauTool';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { CoreStore, EditorState } from '@/editor/registry/types';
import { HeightControl } from './controls';
import { EDGE_OPTIONS } from './plateauModel';

/** The plateau settings with their defaults filled in: the group is absent on old settings. */
function plateauOf(s: Pick<EditorState, 'tools'>): PlateauToolSettings {
  return { ...PLATEAU_DEFAULTS, ...s.tools.settings.plateau };
}

function setPlateau(store: CoreStore, patch: Partial<PlateauToolSettings>): void {
  const st = store.getState();
  st.updateToolSettings({ plateau: { ...plateauOf(st), ...patch } });
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
  bind: {
    read: (s) => plateauOf(s).height,
    write: (store, height) => setPlateau(store, { height }),
  },
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
  bind: {
    read: (s) => plateauOf(s).edge,
    write: (store, edge) => setPlateau(store, { edge }),
  },
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const elevationTool = defineTool({
  id: 'elevation',
  label: 'Elevation',
  description: 'Plateaus and pits over floors or terrain',
  icon: Mountain,
  // Not E: that is the Environment family's own key.
  key: 'L',
  engine: ['plateau'],
  settings: [elevationHeight, elevationEdge],
  dock: [],
  hint: () => ({
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
  }),
});
