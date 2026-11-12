// The plateau card (Elevation): Height with where it stands, Edge, then what the edge draws
// with (Cliff art, a painted border's Texture, Border width and Edge line, Slope width, Contour lines),
// Blocks sight and Crossing. Every row writes
// every picked plateau as one undo step and shows the first.

import { z } from 'zod';
import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import type { Command, MapBuilderStore, PlateauChild } from '@/store/types';
import { setPlateauFields, type PlateauPatch } from '@dnd/core/src/store/plateauCommands';
import { edgeHides, edgeOf, ownHeight, shapeDrop } from '@dnd/core/src/shared/plateaus';
import { isPaintedBorder, paintedBorderArt, paintedBorderTexture } from '@dnd/core/src/engine/plateauKit';
import { BORDER_DEFAULT_WIDTH, BORDER_MAX_WIDTH, BORDER_MIN_WIDTH, borderWidthOf } from '@dnd/core/src/shared/plateauShade';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { runEdit } from './cardWrites';
import { blocksSight, BORDER_STEP, cliffArtValue, edgeArtFor, EDGE_OPTIONS, sightOverrideFor, SLOPE_STEP } from './plateauModel';
import { EDITABLE_VERBS } from './verbs';
import { DEFAULT_ART, EDGE_CROSSING } from './plateauModel';
import { BorderTextureField, CliffArtField, CrossingField, HeightField, SlopeField } from './PlateauFields';

const state = () => useStore.getState() as MapBuilderStore;

/** One undo step over every picked plateau; `patch` may differ per plateau, or skip one with null. */
function apply(label: string, ids: readonly string[], patch: (p: PlateauChild) => PlateauPatch | null): void {
  const cmds: Command[] = [];
  for (const id of ids) {
    const p = selectLayerForChild(state(), id)?.children.find((c): c is PlateauChild => c.id === id && c.childType === 'plateau');
    const next = p && patch(p);
    const cmd = next ? setPlateauFields(id, next, label) : null;
    if (cmd) cmds.push(cmd);
  }
  runEdit(label, cmds);
}

/** What Auto says for a plateau: a cliff whose drop reaches the map's sight drop hides its top. */
function autoBlocks(p: PlateauChild): boolean {
  const layer = selectLayerForChild(state(), p.id);
  const drop = layer ? shapeDrop(layer, p.id) : 0;
  return edgeHides(null, edgeOf(p), drop, state().mapSettings.sightDropCells);
}

const isSloped = (p: PlateauChild) => edgeOf(p) === 'slope';
const hasEdge = (p: PlateauChild) => edgeOf(p) !== 'none';

/* ── Height ────────────────────────────────────────────── */

const height = defineCardField<'plateau', number>({
  id: 'card.plateau.height',
  label: 'Height',
  schema: z.number().int().refine((n) => n !== 0),
  default: 1,
  home: 'card',
  control: 'custom',
  render: HeightField,
  read: ownHeight,
  write: (_store, ids, h) => apply('Plateau height', ids, () => ({ height: h })),
});

const edge = defineCardField<'plateau', PlateauChild['edge']>({
  id: 'card.plateau.edge',
  label: 'Edge',
  schema: z.enum(['none', 'slope', 'cliff']),
  default: 'cliff',
  home: 'card',
  control: 'seg',
  options: EDGE_OPTIONS,
  read: edgeOf,
  write: (_store, ids, e) => apply('Plateau edge', ids, () => ({ edge: e })),
});

/* ── The edge ──────────────────────────────────────────── */

const isPainted = (p: PlateauChild) => edgeOf(p) === 'cliff' && isPaintedBorder(p.edgeArt);

const cliffArt = defineCardField<'plateau', string>({
  id: 'card.plateau.cliffArt',
  label: 'Cliff art',
  schema: z.string().min(1),
  default: DEFAULT_ART,
  home: 'card',
  control: 'custom',
  section: 'Edge',
  render: CliffArtField,
  visibleWhen: (p) => edgeOf(p) === 'cliff',
  read: (p) => cliffArtValue(p.edgeArt),
  write: (_store, ids, v) => apply('Cliff art', ids, (p) => ({ edgeArt: edgeArtFor(v, p.edgeArt) })),
});

/** A painted border's texture: any floor the packs ship. */
const borderTexture = defineCardField<'plateau', string>({
  // Not "border…": the family's tests keep "order" out of card ids.
  id: 'card.plateau.paintTexture',
  label: 'Texture',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'custom',
  section: 'Edge',
  render: BorderTextureField,
  visibleWhen: isPainted,
  read: (p) => paintedBorderTexture(p.edgeArt) ?? '',
  write: (_store, ids, id) => {
    if (id) apply('Border texture', ids, () => ({ edgeArt: paintedBorderArt(id) }));
  },
});

const borderWidth = defineCardField<'plateau', number>({
  id: 'card.plateau.paintWidth',
  label: 'Border width',
  schema: z.number().min(BORDER_MIN_WIDTH).max(BORDER_MAX_WIDTH),
  default: BORDER_DEFAULT_WIDTH,
  home: 'card',
  control: 'stepper',
  section: 'Edge',
  range: { min: BORDER_MIN_WIDTH, max: BORDER_MAX_WIDTH, step: BORDER_STEP },
  visibleWhen: isPainted,
  read: (p) => borderWidthOf(p.borderWidth),
  write: (_store, ids, w) => apply('Border width', ids, () => ({ borderWidth: w })),
});

const slopeWidth = defineCardField<'plateau', number>({
  id: 'card.plateau.slopeWidth',
  label: 'Slope width',
  schema: z.number().positive(),
  default: 1,
  home: 'card',
  control: 'custom',
  section: 'Edge',
  range: { min: SLOPE_STEP, max: 10, step: SLOPE_STEP },
  render: SlopeField,
  visibleWhen: isSloped,
  read: (p) => p.slopeWidth ?? 1,
  write: (_store, ids, w) => apply('Slope width', ids, () => ({ slopeWidth: w })),
});

const contourLines = defineCardField<'plateau', boolean>({
  id: 'card.plateau.contourLines',
  label: 'Contour lines',
  schema: z.boolean(),
  default: true,
  home: 'card',
  control: 'switch',
  section: 'Edge',
  // A painted border has no contours: its Edge line takes this place.
  visibleWhen: (p) => hasEdge(p) && !isPainted(p),
  read: (p) => p.contourLines ?? true,
  write: (_store, ids, on) => apply('Contour lines', ids, () => ({ contourLines: on ? undefined : false })),
});

/** A painted border's thin ink line along the outline: the same stored switch as Contour lines, which it stands in for. */
const edgeLine = defineCardField<'plateau', boolean>({
  id: 'card.plateau.edgeLine',
  label: 'Edge line',
  schema: z.boolean(),
  default: true,
  home: 'card',
  control: 'switch',
  section: 'Edge',
  visibleWhen: isPainted,
  read: (p) => p.contourLines ?? true,
  write: (_store, ids, on) => apply('Edge line', ids, () => ({ contourLines: on ? undefined : false })),
});

/* ── Sight and crossing ────────────────────────────────── */

/**
 * One switch in place of Auto, Always and Never. It shows what the plateau does; while that
 * is what Auto decides nothing is stored, so Auto stays the default. The undo step says
 * Blocks sight, as the switch does.
 */
const blocks = defineCardField<'plateau', boolean>({
  id: 'card.plateau.blocksSight',
  label: 'Blocks sight',
  schema: z.boolean(),
  default: false,
  home: 'card',
  control: 'switch',
  section: 'Table',
  read: (p) => blocksSight(p, autoBlocks(p)),
  write: (_store, ids, on) =>
    apply('Blocks sight', ids, (p) => {
      const next = sightOverrideFor(on, autoBlocks(p));
      return next === p.sightOverride ? null : { sightOverride: next };
    }),
});

const crossing = defineCardField<'plateau', string>({
  id: 'card.plateau.crossing',
  label: 'Crossing',
  schema: z.string().min(1),
  default: EDGE_CROSSING,
  home: 'card',
  control: 'custom',
  section: 'Table',
  render: CrossingField,
  read: (p) => p.crossingId ?? EDGE_CROSSING,
  write: (_store, ids, v) => apply('Crossing', ids, () => ({ crossingId: v === EDGE_CROSSING ? undefined : v })),
});

export const plateauCard = defineCard<'plateau'>({
  kind: 'plateau',
  title: () => 'Elevation',
  verbs: EDITABLE_VERBS,
  fields: [height, edge, cliffArt, borderTexture, borderWidth, slopeWidth, contourLines, edgeLine, blocks, crossing],
});
