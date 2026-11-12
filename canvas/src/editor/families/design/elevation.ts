// The Elevation tool: plateaus, rings of relief raised or sunk over floors and terrain.
// Height, edge and a cliff's art change per plateau, so all sit in the dock, with a painted
// border's texture and width beside them. No cave brush (plan 6.1).

import { Mountain } from 'lucide-react';
import { z } from 'zod';
import type { PlateauToolSettings } from '@/store/types';
import { PLATEAU_DEFAULTS } from '@dnd/core/src/engine/tools/PlateauTool';
import { PAINTED_BORDER, paintedBorderArt, paintedBorderTexture } from '@dnd/core/src/engine/plateauKit';
import { BORDER_DEFAULT_WIDTH, BORDER_MAX_WIDTH, BORDER_MIN_WIDTH, borderWidthOf } from '@dnd/core/src/shared/plateauShade';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { CoreStore, EditorState } from '@/editor/registry/types';
import { HeightControl } from './controls';
import { BorderTextureField, CliffArtField } from './PlateauFields';
import { BORDER_STEP, cliffArtValue, DEFAULT_ART, EDGE_OPTIONS, edgeArtFor } from './plateauModel';

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

const isCliff = (get: (id: string) => unknown) => get('elevation.edge') === 'cliff';
const isPainted = (get: (id: string) => unknown) => isCliff(get) && get('elevation.cliffArt') === PAINTED_BORDER;

/** What a new cliff is laid with: the card's Cliff art choices. */
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
  bind: {
    read: (s) => cliffArtValue(plateauOf(s).edgeArt),
    write: (store, v) => setPlateau(store, { edgeArt: edgeArtFor(v, plateauOf(store.getState()).edgeArt) }),
  },
});

/** A painted border's texture. */
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
  bind: {
    read: (s) => paintedBorderTexture(plateauOf(s).edgeArt) ?? '',
    write: (store, id) => {
      if (id) setPlateau(store, { edgeArt: paintedBorderArt(id) });
    },
  },
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
  bind: {
    read: (s) => borderWidthOf(plateauOf(s).borderWidth),
    write: (store, borderWidth) => setPlateau(store, { borderWidth }),
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
  settings: [elevationHeight, elevationEdge, elevationCliffArt, elevationBorderTexture, elevationBorderWidth],
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
