// The plateau card (Elevation): Height with where it stands, Edge, Top, Smooth corners, then
// what the edge draws with (Cliff art, a painted border's Texture, Border width and Edge line, a
// slope's Slope face, Direction and Ledge lines, a cliff's Contour lines),
// Blocks sight and Crossing. Every row writes
// every picked plateau as one undo step and shows the first.

import { z } from 'zod';
import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import type { Command, MapBuilderStore, PlateauChild } from '@/store/types';
import { setPlateauFields, type PlateauPatch } from '@dnd/core/src/store/plateauCommands';
import { edgeHides, edgeOf, ownHeight, shapeDrop } from '@dnd/core/src/shared/plateaus';
import { isPaintedBorder, paintedBorderArt, paintedBorderTexture } from '@dnd/core/src/engine/plateauKit';
import { BORDER_DEFAULT_WIDTH, BORDER_MAX_WIDTH, BORDER_MIN_WIDTH, borderWidthOf, DEFAULT_FACE_DIRECTION, faceDirectionOf } from '@dnd/core/src/shared/plateauShade';
import { plateauSmooth, setPlateausSmooth } from '@dnd/core/src/engine/ringNodeEdit';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { runEdit } from './cardWrites';
import { blocksSight, BORDER_STEP, cliffArtValue, edgeArtFor, EDGE_OPTIONS, faceArtFor, faceArtValue, GROUND_FACE, GROUND_TOP, sightOverrideFor, topArtFor, topArtValue } from './plateauModel';
import { EDITABLE_VERBS } from './verbs';
import { DEFAULT_ART, EDGE_CROSSING } from './plateauModel';
import { BorderTextureField, CliffArtField, CrossingField, DirectionField, FaceArtField, HeightField, TopArtField } from './PlateauFields';

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

/** A slope's face texture: Ground (nothing stored) or a face tile. */
const faceArt = defineCardField<'plateau', string>({
  id: 'card.plateau.faceArt',
  label: 'Slope face',
  schema: z.string().min(1),
  default: GROUND_FACE,
  home: 'card',
  control: 'custom',
  section: 'Edge',
  render: FaceArtField,
  visibleWhen: isSloped,
  read: (p) => faceArtValue(p.faceArt),
  write: (_store, ids, v) => apply('Slope face', ids, () => ({ faceArt: faceArtFor(v) })),
});

/** The way a slope's faces point, degrees: its own, or for a plateau saved without one the map's. */
const faceDir = defineCardField<'plateau', number>({
  id: 'card.plateau.faceDir',
  label: 'Direction',
  schema: z.number().int().min(0).max(359),
  default: DEFAULT_FACE_DIRECTION,
  home: 'card',
  control: 'custom',
  section: 'Edge',
  render: DirectionField,
  visibleWhen: isSloped,
  read: (p) => faceDirectionOf(p, state().mapSettings.faceDirection),
  write: (_store, ids, d) => apply('Slope direction', ids, () => ({ faceDir: d })),
});

/** The top's texture: Ground (nothing stored, the top shows what is under it) or a floor. */
const topArt = defineCardField<'plateau', string>({
  id: 'card.plateau.topArt',
  label: 'Top',
  schema: z.string().min(1),
  default: GROUND_TOP,
  home: 'card',
  control: 'custom',
  render: TopArtField,
  read: (p) => topArtValue(p.topArt),
  write: (_store, ids, v) => apply('Plateau top', ids, () => ({ topArt: topArtFor(v) })),
});

/** The picked plateaus' rings: on when every node of them all is smooth. */
function pickedRings(p: PlateauChild): PlateauChild[] {
  const ids = state().selection.selectedIds;
  const picked = ids.flatMap((id) => {
    const c = selectLayerForChild(state(), id)?.children.find((x): x is PlateauChild => x.id === id && x.childType === 'plateau');
    return c ? [c] : [];
  });
  return picked.length > 0 ? picked : [p];
}

/** Every node smooth, holes too, or every handle off: one undo step, put back if it would leave the ground. */
const smoothCorners = defineCardField<'plateau', boolean>({
  id: 'card.plateau.smoothCorners',
  label: 'Smooth corners',
  schema: z.boolean(),
  default: false,
  home: 'card',
  control: 'switch',
  read: (p) => pickedRings(p).every(plateauSmooth),
  write: (_store, ids, on) => {
    void setPlateausSmooth(ids, on);
  },
});

/** The thin lines between a slope's ledge bands: the same stored switch as Contour lines, which it stands in for. */
const ledgeLines = defineCardField<'plateau', boolean>({
  id: 'card.plateau.ledgeLines',
  label: 'Ledge lines',
  schema: z.boolean(),
  default: true,
  home: 'card',
  control: 'switch',
  section: 'Edge',
  visibleWhen: isSloped,
  read: (p) => p.contourLines ?? true,
  write: (_store, ids, on) => apply('Ledge lines', ids, () => ({ contourLines: on ? undefined : false })),
});

const contourLines = defineCardField<'plateau', boolean>({
  id: 'card.plateau.contourLines',
  label: 'Contour lines',
  schema: z.boolean(),
  default: true,
  home: 'card',
  control: 'switch',
  section: 'Edge',
  // A painted border has no contours: its Edge line takes this place; a slope's Ledge lines.
  visibleWhen: (p) => edgeOf(p) === 'cliff' && !isPainted(p),
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
  fields: [height, edge, topArt, smoothCorners, cliffArt, borderTexture, borderWidth, faceArt, faceDir, ledgeLines, contourLines, edgeLine, blocks, crossing],
});
