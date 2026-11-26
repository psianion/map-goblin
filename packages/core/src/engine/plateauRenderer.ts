// Plateaus, drawn (plan §4.3), band by band, lowest first, in two of the layer's sublayers.
// The tops (`plateauTops`, over the floor, under the paths) are a translucent lift over
// whatever lies beneath (7 % a cell), so floor texture, terrain paint and floor borders show
// through. The edges (`plateauEdges`, over the paths, under the shadows) are its slopes' side
// faces and its cliffs, laid by the cave walk with the ledge kit, one ledge ring at any drop
// (void side = low side, so a pit's rock faces in). Where a cliff lies on a wall it lays no rock,
// top line or shade there: the wall's rock stands for it, and the cliff's rock runs on into the
// wall's where it leaves it, with no end piece.
//
// A slope shows a side face on one side only, the side pointing the way the DM set (the
// plateau's own direction, else the map's; never the sun's), as deep as its drop says
// (`slopeFace`). Its texture, when it has one, is a floor of its own drawn among the ground
// pieces at the plateau's place in their order (floorWallRenderer.ts), so ground painted later
// covers it; here, above every ground piece, the face is darkened in ledge bands, lined at its
// foot and between the bands, and the rim lined heavier on the face side with a pale highlight
// just inside it on the far side (`drawSlopeFaces`).
//
// Under all of it, every edge lays a drop shade on its low side (`drawShade`): a soft dark band
// hugging the edge, wider for a taller drop, so a raised edge reads raised whatever its kind.
// A slope's is kept off its own face.
//
// A cliff whose art is a painted border lays no ledge: a band of its texture on the high side
// of the edge, its inner edge ragged, into the tops under the band's lift (`drawPaintedBorder`),
// and a thin ink edge line along the outline unless switched off.
//
// The drop shade is a faint contact shade only; the shadow pass's one directional shadow per
// plateau is what reads as the drop.
//
// The cliff shadows are the shadow pass's (shadowPass.ts); it also re-lights the cliff rock
// here when the sun moves (`shadeCliffs`).

import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import {
  BORDER_FADE,
  BORDER_WOBBLE,
  DROP_SHADE_ALPHA,
  FACE_DEPTH_MAX,
  FACE_DEPTH_WANDER,
  FACE_FOOT_ALPHA,
  FACE_FOOT_WIDTH,
  FACE_HIGHLIGHT_ALPHA,
  FACE_HIGHLIGHT_COLOR,
  FACE_HIGHLIGHT_INSET,
  FACE_HIGHLIGHT_WIDTH,
  FACE_INK,
  FACE_LEDGE_ALPHA,
  FACE_LEDGE_WIDTH,
  FACE_RIM_ALPHA,
  FACE_RIM_FAR_ALPHA,
  FACE_RIM_FAR_WIDTH,
  FACE_RIM_STEPS,
  FACE_RIM_WIDTH,
  borderWidthOf,
  blurStrengthFor,
  dropShadeWidth,
  faceBandShades,
  faceDirectionOf,
  faceVector,
  highlightWeight,
  linesOff,
  lowSegments,
  offsetPath,
  rimWeight,
  slopeFace,
  TOP_SEAM,
  wobbleNoise,
  wobbleSeed,
  type FaceEnds,
  type SlopeFace,
} from '../shared/plateauShade';
import { useStore } from '../store/store';
import type { DungeonLayer, RockLine } from '../store/types';
import type { Polygon } from '../types/geometry';
import {
  byPrecedence,
  edgeOf,
  edgeRuns,
  hasPlateaus,
  layerPlateaus,
  precedenceOf,
  plateausOf,
  pointInPoly,
  splitAtCrossings,
  stairFlights,
  tierLift,
  unionShapes,
  type EdgeRun,
  type EntranceInfo,
  type PlateauBand,
  type StairFlight,
} from '../shared/plateaus';
import type { CliffEntrance, PlateauChild } from '../shared/types';
import { isGroundPiece, pieceRings } from '../shared/pieces';
import type { WorldBounds } from '../shared/mapBounds';
import { baseGroundFrame } from './mapFrame';
import { bandSize, getCatalogEntry, GRID_CELL_PX, isColoredSet, isMeasuredBandSet, type CatalogEntry } from '../assets/packCatalog';
import { layFlight, stairKitFor, stairPasses } from '../assets/stairKits';
import { swapWhenLanded } from './lateArt';
import { resolveTexture } from '../assets/textureLoader';
import type { ShadowLook } from '../shared/shadows';
import { fittedFloor, layBandChain, layBandRing, placeBand, withConnectors, type FloorFit } from './caveBandRenderer';
import { alongRock, laidFor, wallLines, type AlongRock } from '../shared/rockLines';
import { caveEdges } from '../shared/caveFloor';
import { layerDrawStyle } from './levelLook';
import { cliffArt, cliffChoice, cliffPieces, isPaintedBorder, ledgeEndPieces, paintedBorderTexture } from './plateauKit';
import { paintRamp, rampMaskSprite } from './softPiece';
import { ease } from './softMask';
import { distanceToLines, fallOff, fieldOf, keptRamp, rampGrid, unit, type Ramp, type RampField } from './rampMask';
import { kitOut, kitOverlap, placePiece, type WalkPlacement } from './caveWalk';
import { bandPiecesFor, jointsOf, kitEntrances, kitFacesFloor, kitRockWidth, mirrorPiece, pieceSkew, placeOnChord, type CaveKitPiece } from '../assets/caveWallKit';

type Vec = [number, number];

export interface PlateauRenderOptions {
  /** Ask for a re-bake when a pack texture this draw needed lands later. */
  waitFor?: (textureId: string) => void;
  /** The layer's floor fit (`bandFloorFit`): a top and its shade meet the rock where an edge runs along a wall. */
  fit?: FloorFit;
  /** The cliffs already walked for this draw (`cliffRockLines`); a run not in it is walked here. */
  cliffs?: CliffWalks;
}

/** Each band's cliff walks (`walkCliff`), by run (`cliffKey`): one per stretch of it off the walls (`LaidRun.cliffs`). */
export type CliffWalks = Map<PlateauBand, Map<string, WalkPlacement[][]>>;

/** Which of its band's runs a cliff walk is kept under. */
export const cliffKey = (run: EdgeRun): string => `${run.ring}:${run.start}`;

const INK = 0x2b2420;
/** The cliff's top-edge line, cells wide. */
const LINE = 0.04;
const TOP_LINE_ALPHA = 0.5;
/** A cliff with no ledge art to lay draws this ink edge instead, so it never reads as missing. */
const FALLBACK_EDGE = 0.12;
/**
 * Lit/shaded faces under a sun: a face turned away from the light keeps SHADE_FLOOR of its
 * brightness, one side-on to it SHADE_SIDE, one square to it all of it. The ledge is a thin ink
 * line with no rock face, so it takes no wash of light: with no sun (Indoor) it is drawn as is.
 */
export const SHADE_FLOOR = 0.4;
export const SHADE_SIDE = 0.72;

// ─── Lighting the rock ─────────────────────────────────────

interface CliffSprite {
  /** A piece of the ledge, tinted by how its face turns to the light. */
  sprite: Sprite;
  /** Unit normal pointing to the low side. */
  normal: Vec;
}

const cliffSprites = new Map<string, CliffSprite[]>();
const lastLook = new Map<string, ShadowLook | null>();

/** How bright a face turned to `normal` is under `look`: SHADE_FLOOR away from the light, 1 facing it. */
export function faceShade(normal: Vec, look: ShadowLook | null): number {
  if (!look) return 1;
  // The shadow runs along (dx, dy), away from the light; the light is the other way.
  const facing = Math.max(-1, Math.min(1, -(normal[0] * look.dx + normal[1] * look.dy)));
  return facing >= 0 ? SHADE_SIDE + (1 - SHADE_SIDE) * facing : SHADE_SIDE + (SHADE_SIDE - SHADE_FLOOR) * facing;
}


/** Re-light one layer's cliff rock for the sky's current look. Called by the shadow pass. A slope's face is never re-lit. */
export function shadeCliffs(layerId: string, look: ShadowLook | null): void {
  lastLook.set(layerId, look);
  for (const { sprite, normal } of cliffSprites.get(layerId) ?? []) {
    if (!sprite.destroyed) sprite.tint = mulColour(0xffffff, faceShade(normal, look));
  }
}

/** `colour` darkened to `k` of itself. */
function mulColour(colour: number, k: number): number {
  const c = (shift: number) => Math.round(((colour >> shift) & 255) * Math.max(0, Math.min(1, k)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

// ─── Geometry helpers ──────────────────────────────────────

function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Fill rings with their holes cut: outers positive, holes negative (the band's winding). */
function fillRings(g: Graphics, rings: Polygon[], style: { color: number; alpha?: number }): void {
  const areas = rings.map((r) => (r.length < 3 ? 0 : signedArea(r)));
  const allHoles = rings.filter((_, k) => areas[k] < 0);
  rings.forEach((r, k) => {
    if (areas[k] <= 0) return;
    g.poly(r.flat()).fill(style);
    const holes = allHoles.filter((h) => inside(h[0], r));
    if (holes.length === 0) return;
    for (const h of holes) g.poly(h.flat());
    g.cut();
  });
}

function inside([x, y]: [number, number], poly: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ─── The pass ──────────────────────────────────────────────

/**
 * Draw every band of a layer, its top into `tops` and its edges into `edges`, replacing what
 * was there. A flat layer draws nothing and costs one scan of its children.
 */
export function renderPlateaus(
  layer: DungeonLayer,
  tops: Container,
  edges: Container,
  options: PlateauRenderOptions = {},
): void {
  for (const child of tops.removeChildren()) child.destroy({ children: true });
  for (const child of edges.removeChildren()) child.destroy({ children: true });
  cliffSprites.delete(layer.id);
  if (!hasPlateaus(layer)) return;

  const plateaus = layerPlateaus(layer);
  const slopes = layerSlopes(layer);
  const sprites: CliffSprite[] = [];
  for (const band of plateaus.bands) {
    const laid = laidRuns(layer, band);
    const runs = laid.map((l) => l.run);
    const painted = (run: EdgeRun) => run.edge === 'cliff' && isPaintedBorder(run.owner?.edgeArt);
    for (const run of runs) if (painted(run)) drawPaintedBorder(tops, run, options);
    drawBandTop(tops, band, fittedAlongWalls(band.surface, laid, options.fit));
    const holder = new Container();
    holder.label = `plateau-band-${band.height}`;
    const faces = slopes.faces.filter((f) => f.run.band === band);
    // The faces of bands drawn over this one show over its edges: its shade stays off them.
    const over = slopes.faces.filter((f) => byPrecedence(f.run.band, band) > 0).flatMap((f) => f.region);
    drawShade(holder, band, laid, faces, slopes.land, over, options.fit);
    drawSlopeFaces(holder, band, faces, slopes.land);
    // The flights of stairs on its edges: over the shade and any slope face, under the cliffs.
    const flights = stairFlights(layer).filter((f) => band.shapes.includes(f.plateau));
    if (flights.length > 0) drawStairs(holder, flights);
    for (const { run, cliffs } of laid) {
      if (!cliffs) continue;
      const walks = options.cliffs?.get(band)?.get(cliffKey(run));
      cliffs.forEach((c, i) => sprites.push(...drawCliff(holder, c, walks?.[i] ?? walkStretch(c))));
    }
    // The cave mouths' pieces, over the cliff runs that stop at them.
    const mouths = entrancePlacements(layer, band);
    if (mouths.length > 0) sprites.push(...drawEntrances(holder, mouths));
    // A painted border's Edge line rides on the card's Contour lines switch: on unless set off.
    for (const run of runs) if (painted(run) && run.owner?.contourLines !== false) drawEdgeLine(holder, run);
    edges.addChild(holder);
  }
  cliffSprites.set(layer.id, sprites);
  shadeCliffs(layer.id, lastLook.get(layer.id) ?? null);
}

/** The corners of a flight's footprint: its top edge, then its foot `length` cells down. */
export function flightFootprint(f: Pick<StairFlight, 'top' | 'down' | 'length'>): Polygon {
  const [a, b] = f.top;
  const d = vmul(f.down, f.length);
  return [a, b, vadd(b, d), vadd(a, d)];
}

/**
 * The flights of stairs, each laid with its kit (`layFlight`): the span's own, else the packs'
 * default. A flight with no kit installed is drawn as the outline of the ground it covers.
 */
export function drawStairs(parent: Container, flights: StairFlight[]): void {
  const holder = new Container();
  holder.label = 'plateau-stairs';
  let outline: Graphics | null = null;
  for (const f of flights) {
    const kit = stairKitFor(f.span.kit, f.plateau.edgeArt);
    if (!kit) {
      outline ??= holder.addChild(new Graphics());
      outline.poly(flightFootprint(f).flat(), true).stroke({ color: INK, width: LINE, alpha: 0.85 });
      continue;
    }
    // A translucent overlay is laid twice over itself, so its steps read on a light floor.
    const passes = stairPasses(kit);
    for (const pl of layFlight(f, kit)) {
      const entry = getCatalogEntry(pl.entryId);
      if (!entry) continue;
      for (let pass = 0; pass < passes; pass++) {
        const sprite = holder.addChild(new Sprite(Texture.EMPTY));
        sprite.position.set(pl.origin[0], pl.origin[1]);
        sprite.rotation = pl.rotation;
        // World cells per texture pixel: the art is authored at GRID_CELL_PX a cell, brought back to
        // that size from whatever resolution it is served at. Where it meets a piece beside it, the
        // tile is cut off at its painted steps, its side line trimmed (`LaidStair.crop`).
        const show = (t: Texture): void => {
          const cell = (GRID_CELL_PX * t.width) / entry.naturalWidth;
          const fx0 = pl.crop[0] ? pl.painted[0] * cell : 0;
          const fx1 = pl.crop[1] ? pl.painted[2] * cell : t.width;
          sprite.texture = fx0 > 0 || fx1 < t.width ? new Texture({ source: t.source, frame: new Rectangle(t.frame.x + fx0, t.frame.y, fx1 - fx0, t.frame.height) }) : t;
          sprite.anchor.set((pl.painted[0] * cell - fx0) / (fx1 - fx0), (pl.painted[1] * GRID_CELL_PX) / entry.naturalHeight);
          sprite.scale.set(pl.scale[0] / cell, (pl.scale[1] * entry.naturalHeight) / t.height / GRID_CELL_PX);
          sprite.visible = true;
        };
        const tex = resolveTexture(entry.id);
        if (tex.width > 1) show(tex);
        else {
          sprite.visible = false;
          swapWhenLanded(entry.id, (t) => {
            if (!sprite.destroyed) show(t);
          });
        }
      }
    }
  }
  parent.addChild(holder);
}

// ─── Cliff entrances ───────────────────────────────────────

/**
 * The entrance piece a cave mouth in a cliff of art `edgeArt` is laid with: its own (`piece`) where
 * the kit has it at the span's width, else the kit's first of that width; the Shadow piece in its
 * place where nothing stands behind the mouth. Null where the kit has none that wide: a plain gap.
 */
export function entrancePiece(span: Pick<CliffEntrance, 'from' | 'to' | 'piece'>, edgeArt: string | undefined, behind: boolean): CaveKitPiece | null {
  const art = cliffArt(edgeArt);
  const width = Math.round(span.to - span.from);
  const all = kitEntrances(cliffPieces(art, edgeArt)).filter((p) => art.has(p.key) && Math.round(p.chordCells) === width);
  const byKey = (a: CaveKitPiece, b: CaveKitPiece): number => a.key.localeCompare(b.key, undefined, { numeric: true });
  const plain = all.filter((p) => !p.shadow).sort(byKey);
  if (plain.length === 0) return null;
  const k = Math.max(0, plain.findIndex((p) => p.key === span.piece));
  if (behind) return plain[k];
  // The Shadow twin: the dark piece in the same place among its own.
  const dark = all.filter((p) => p.shadow).sort(byKey);
  return dark[k] ?? plain[k];
}

/** The plain entrance pieces a cliff of art `edgeArt` offers at `width` cells, in the order the Kit tiles show them. */
export function entranceVariants(edgeArt: string | undefined, width: number): CaveKitPiece[] {
  const art = cliffArt(edgeArt);
  return kitEntrances(cliffPieces(art, edgeArt))
    .filter((p) => !p.shadow && art.has(p.key) && Math.round(p.chordCells) === Math.round(width))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** The widths, whole cells, a cliff of art `edgeArt` has entrance pieces for; empty for a kit with none. */
export function entranceWidths(edgeArt: string | undefined): number[] {
  const art = cliffArt(edgeArt);
  return [...new Set(kitEntrances(cliffPieces(art, edgeArt)).filter((p) => art.has(p.key)).map((p) => Math.round(p.chordCells)))].sort((a, b) => a - b);
}

/**
 * `span`, a cave mouth on `plateau`, with its hollow (`CliffEntrance.mouth`) worked out from the
 * piece it is laid with: the piece's measured mouth, turned the way the cliff's walk lays it, as
 * lengths along the ring; the whole span where the kit has no piece (a plain gap); none where the
 * piece measures none (its middle third then). What the Door tool stores as it places, slides or
 * resizes one, so the table, which has no catalog, opens the same stretch.
 */
export function withMouth(layer: Pick<DungeonLayer, 'children'>, plateau: PlateauChild, span: CliffEntrance): CliffEntrance {
  const bare: CliffEntrance = { ...span };
  delete bare.mouth;
  const probe = { ...plateau, entrances: [...(plateau.entrances ?? []).filter((s) => s.id !== span.id), bare] } as PlateauChild;
  const info = layerPlateaus({ children: layer.children.map((c) => (c.id === plateau.id ? probe : c)) }).entrances.find((e) => e.span.id === span.id);
  const piece = entrancePiece(bare, plateau.edgeArt, true);
  if (!piece) return { ...bare, mouth: [bare.from, bare.to] };
  if (!info || !piece.mouth) return bare;
  const [p, q] = [info.line[0], info.line[info.line.length - 1]];
  const [a, b] = info.edge;
  const ringWay = (q[0] - p[0]) * (b[0] - a[0]) + (q[1] - p[1]) * (b[1] - a[1]) >= 0;
  // The piece's joint 0 lies at the span's start (`from`) when its walk runs the plateau's own way.
  const fromJoint0 = walksForward({ drop: info.drop, owner: plateau }) === ringWay;
  const L = bare.to - bare.from;
  const [f0, f1] = piece.mouth;
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return { ...bare, mouth: fromJoint0 ? [round(bare.from + f0 * L), round(bare.from + f1 * L)] : [round(bare.to - f1 * L), round(bare.to - f0 * L)] };
}

/** One entrance's piece as laid, and what it was laid for. */
export interface LaidEntrance {
  info: EntranceInfo;
  pl: WalkPlacement;
  /** The art its piece's key names. */
  art: Map<string, CatalogEntry>;
  /** The span's ends in the walk's order (joint 0, joint 1), on the drawn edge. */
  ends: [Vec, Vec];
}

const entranceMemo = new WeakMap<PlateauBand, { lines: unknown; floor: unknown; value: LaidEntrance[] }>();

/**
 * The entrance pieces a band lays: one across each of its cliff entrances off the walls whose kit
 * has a piece that wide (`entrancePiece`), at its drawn size, its joints on the span's ends where the
 * cliff's runs stop (`CliffRun.joins`), shoved toward the low side as the cliff's own pieces are, so
 * its hollow faces the low ground. Plain with a walled floor behind the mouth, Shadow with none.
 */
export function entrancePlacements(layer: DungeonLayer, band: PlateauBand): LaidEntrance[] {
  const hit = entranceMemo.get(band);
  if (hit && hit.lines === layer.rockLines && hit.floor === layer.mergedFloor) return hit.value;
  const value: LaidEntrance[] = [];
  const infos = layerPlateaus(layer).entrances.filter((e) => band.shapes.includes(e.plateau) && edgeOf(e.plateau) === 'cliff' && !isPaintedBorder(e.plateau.edgeArt));
  let walls: CliffWalls | null = null;
  for (const info of infos) {
    const piece = entrancePiece(info.span, info.plateau.edgeArt, info.behind);
    if (!piece) continue;
    // Along a wall the wall's rock stands for the cliff: the stairs' rule, the wall opened instead.
    if (alongRock(info.line, false, (walls ??= cliffWalls(layer)).lines).replaced.length > 0) continue;
    const [p, q] = [info.line[0] as Vec, info.line[info.line.length - 1] as Vec];
    const [a, b] = info.edge;
    const ringWay = (q[0] - p[0]) * (b[0] - a[0]) + (q[1] - p[1]) * (b[1] - a[1]) >= 0;
    const [A, B] = ringWay ? [p, q] : [q, p];
    const kit = cliffPieces(cliffArt(info.plateau.edgeArt), info.plateau.edgeArt);
    const ends: [Vec, Vec] = walksForward({ drop: info.drop, owner: info.plateau }) ? [A, B] : [B, A];
    const d = vsub(ends[1], ends[0]);
    const len = Math.hypot(d[0], d[1]) || 1;
    // The walk's void side, the left of travel: the low side, where the hollow opens.
    const out = kitOut(kit);
    const shove = vmul([d[1] / len, -d[0] / len], out);
    const P = vadd(ends[0], shove);
    const Q = vadd(ends[1], shove);
    value.push({ info, pl: { piece, P, Q, i: 0, nudge: 0, branch: 'entrance', at: placePiece(piece, P, Q, out, 0, 0) }, art: cliffArt(info.plateau.edgeArt), ends });
  }
  entranceMemo.set(band, { lines: layer.rockLines, floor: layer.mergedFloor, value });
  return value;
}

/** The entrances' pieces, each lit as the cliff's rock is (`shadeCliffs`) unless its art carries its own colour. */
function drawEntrances(parent: Container, laid: LaidEntrance[]): CliffSprite[] {
  const holder = new Container();
  holder.label = 'plateau-entrances';
  const sprites: CliffSprite[] = [];
  for (const e of laid) {
    const from = holder.children.length;
    placeBand(holder, [e.pl], e.art, 0xffffff, from);
    const sprite = holder.children[from] as Sprite | undefined;
    if (sprite && !isColoredSet(cliffChoice(e.info.plateau.edgeArt).setId)) sprites.push({ sprite, normal: lowNormal(e.pl) });
  }
  parent.addChild(holder);
  return sprites;
}

/**
 * The band's top: a translucent lift tint over whatever is beneath it, nothing else. Only where
 * the surface stands at its level (`surface`, fitted to the rock along a wall), so each level
 * shows its own tint, never two stacked.
 */
function drawBandTop(parent: Container, band: PlateauBand, surface: Polygon[]): void {
  const lift = tierLift(band.height);
  if (lift === 0 || surface.length === 0) return;
  const tier = new Graphics();
  tier.label = `plateau-top-${band.height}`;
  fillRings(tier, surface, { color: lift > 0 ? 0xffffff : 0x000000, alpha: Math.abs(lift) });
  parent.addChild(tier);
}

// ─── Along a cave wall ─────────────────────────────────────

/** One edge run, and the run as drawn: on the wall's rock where it runs along a cave wall, on its own cliff's rock where it has one. */
export interface LaidRun {
  run: EdgeRun;
  /** `run` with its points along a rock line laid on the rock (`alongRock`) and a drop per new segment; `run` itself elsewhere. */
  laid: EdgeRun;
  /** `run` laid along the walls' lines alone, as `laid` is: what its cliff is walked along, never its own line. `run` itself along none. */
  walk: EdgeRun;
  /** The ground between each stretch of `run` along a wall and the rock that stands for it. Empty along none. */
  zone: Polygon[];
  /**
   * Along its own cliff's line: the ground between the drawn run and the rock, inside the band
   * (`tips`, where its top pokes past the rock) and outside it (`gaps`, where the rock sits
   * outside the outline). Empty along none.
   */
  cliff: FloorFit;
  /**
   * Along its own cliff's line: the ground just past that line (BEYOND_REACH) on its low side
   * (`low`, its left) and its high side (`high`). What is fitted to the rock (its own, or a wall's
   * where the two meet) on one side is never left past it on the other. Empty along none.
   */
  beyond: { low: Polygon[]; high: Polygon[] };
  /**
   * A cliff laid with ledge pieces: the stretches of it off every wall (`cliffRuns`), or its
   * whole walk when it meets none; none when it lies wholly on walls. Null for any other edge.
   */
  cliffs: CliffRun[] | null;
}

/** A stretch of a cliff that lays rock: the cliff off every wall, an open chain wherever it meets one. */
export interface CliffRun {
  /** What its rock is walked along (`walkCliff`): `LaidRun.walk` off the walls. */
  run: EdgeRun;
  /** What its top line and drop shade are drawn along: `run` on its own cliff's line where it has one. */
  top: EdgeRun;
  /** Whether its head and its tail, in `run`'s order, run on into a wall's rock: no end piece there. */
  merged: [boolean, boolean];
  /** Of those, whether each stops at the floor-side face of rock drawn under it (a painted cave's): it narrows there, as a free end does. */
  butts: [boolean, boolean];
  /** Whether its head and its tail stop at a flight of stairs (never `merged` then): laid to the span's end with no end piece, and tapered there. */
  opens: [boolean, boolean];
  /**
   * Whether its head and its tail stop at a cliff entrance's piece (`entrancePlacements`; never
   * `merged` or `opens` then): laid to the span's end with no end piece and no taper, the piece
   * lying on from there. Absent: neither. A kit with no entrance piece leaves a gap, as at stairs.
   */
  joins?: [boolean, boolean];
  /** Those pieces, at its head and its tail (`joins`), which its end pieces lap as their own neighbours do. */
  joined?: [WalkPlacement | null, WalkPlacement | null];
}

/** The tips a stretch's walk lays bare, with no painted ending (`walkCliff`'s `opens`): at stairs or an entrance's piece. */
export const bareTips = (c: Pick<CliffRun, 'opens' | 'joins'>): [boolean, boolean] => [c.opens[0] || !!c.joins?.[0], c.opens[1] || !!c.joins?.[1]];

/** A stretch's walk (`walkCliff`), its tips at stairs or an entrance bare. */
export const walkStretch = (c: CliffRun): WalkPlacement[] => walkCliff(c.run, c.merged, bareTips(c), c.joined);

/** How far past the drawn stretch and its rock a stretch's zone reaches, cells: past Clipper's snap. */
const ZONE_PAD = 0.05;

const NO_FIT: FloorFit = { tips: [], gaps: [] };

const laidMemo = new WeakMap<PlateauBand, { lines: unknown; floor: unknown; children: unknown; openings: unknown; style: unknown; value: LaidRun[] }>();

/**
 * A band's edge runs (`edgeRuns`), each as drawn against the layer's rock lines. Kept per band
 * while the lines and the walls stay the same.
 */
export function laidRuns(layer: DungeonLayer, band: PlateauBand): LaidRun[] {
  const hit = laidMemo.get(band);
  if (hit && hit.lines === layer.rockLines && hit.floor === layer.mergedFloor && hit.children === layer.children && hit.openings === layer.caveOpenings && hit.style === layer.style) {
    return hit.value;
  }
  const walls = wallLines(layer.rockLines);
  const ownLines = layer.rockLines?.filter((l) => l.kind === 'cliff');
  let cut: CliffWalls | null = null;
  // The entrance piece lying on a ring edge, where one does (`entrancePlacements`).
  let mouths: LaidEntrance[] | null = null;
  const joinAt = (ring: number, k: number): WalkPlacement | null => {
    const r = band.rings[ring];
    const [a, b] = [r[k], r[(k + 1) % r.length]];
    const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    mouths ??= entrancePlacements(layer, band);
    return mouths.find((m) => segDist(mid, m.info.line[0] as Vec, m.info.line[m.info.line.length - 1] as Vec) < 0.02)?.pl ?? null;
  };
  const value = edgeRuns(band).map((run): LaidRun => {
    const along = alongRock(run.points, run.closed, layer.rockLines);
    const onWalls = walls === layer.rockLines ? along : alongRock(run.points, run.closed, walls);
    const walk = onWalls.replaced.length === 0 ? run : { ...run, points: onWalls.points, drops: onWalls.segs.map((i) => run.drops[i]) };
    const laid = along.replaced.length === 0 ? run : { ...run, points: along.points, drops: along.segs.map((i) => run.drops[i]) };
    const ledge = run.edge === 'cliff' && !isPaintedBorder(run.owner?.edgeArt);
    const cliffs = ledge ? cliffRuns(run, walk, laid, (cut ??= cliffWalls(layer)), ownLines, (k) => joinAt(run.ring, k)) : null;
    if (along.replaced.length === 0) return { run, laid: run, walk, zone: [], cliff: NO_FIT, beyond: NO_BEYOND, cliffs };
    const between = (replaced: AlongRock['replaced']) => replaced.flatMap(({ drawn, rock }) => clipper2Engine.union([[...drawn, ...[...rock].reverse()]], []));
    const wall = along.replaced.filter((r) => r.line.kind !== 'cliff');
    const lines = wall.flatMap(({ drawn, rock }) => [drawn, rock]);
    const own = along.replaced.filter((r) => r.line.kind === 'cliff');
    const ownRock = between(own);
    return {
      run,
      laid,
      walk,
      zone: wall.length === 0 ? [] : clipper2Engine.union([...between(wall), ...clipper2Engine.inflateOpen(lines, ZONE_PAD)], []),
      cliff: ownRock.length === 0 ? NO_FIT : { tips: clipper2Engine.intersection(ownRock, band.rings), gaps: clipper2Engine.difference(ownRock, band.rings) },
      beyond: own.length === 0 ? NO_BEYOND : { low: beyondLines([...new Set(own.map((r) => r.line))], true), high: beyondLines([...new Set(own.map((r) => r.line))], false) },
      cliffs,
    };
  });
  laidMemo.set(band, { lines: layer.rockLines, floor: layer.mergedFloor, children: layer.children, openings: layer.caveOpenings, style: layer.style, value });
  return value;
}

/** How far past a cliff's own line the ground a wall's fit may not grow its top into reaches, cells. */
const BEYOND_REACH = 0.6;

const NO_BEYOND: LaidRun['beyond'] = { low: [], high: [] };

/** The ground within BEYOND_REACH of each of `lines`' runs (low ground on their left), on their `low` side or their high side. */
function beyondLines(lines: RockLine[], low: boolean): Polygon[] {
  const quads: Polygon[] = [];
  for (const line of lines) {
    for (const r of line.runs) {
      let last: Vec | null = null;
      for (let k = 0; k + 1 < r.length; k++) {
        const a = r[k] as Vec;
        const b = r[k + 1] as Vec;
        const L = vdist(a, b);
        if (L < 1e-9) continue;
        // The left of travel, or the right.
        const n = vmul([(b[1] - a[1]) / L, -(b[0] - a[0]) / L], low ? BEYOND_REACH : -BEYOND_REACH);
        quads.push([a, b, vadd(b, n), vadd(a, n)]);
        // Round the turn from the one before, so no corner of the line is left uncovered.
        if (last) {
          const mid = vadd(last, n);
          const m = Math.hypot(mid[0], mid[1]);
          if (m > 1e-9) quads.push([a, vadd(a, last), vadd(a, vmul(mid, BEYOND_REACH / m)), vadd(a, n)]);
        }
        last = n;
      }
    }
  }
  return quads.length === 0 ? [] : clipper2Engine.union(quads, []);
}

/**
 * The walls a layer's cliffs are cut along, how far short of each line a cliff's end stops where
 * it meets it, and the erased openings no cliff is laid in.
 */
interface CliffWalls {
  lines: RockLine[];
  back: Map<RockLine, number>;
  openings: readonly Polygon[];
}

/**
 * The walls a cliff may lie on, as lines to cut it along: every saved wall line, then every
 * painted cave ring and walled floor ring with none, as a line on its own drawn edge. A painted
 * cave's rock is drawn under the cliffs, so where a cliff meets a cave's saved line it stops at
 * the rock's floor-side face, half the rock's width short of the line (`back`), and butts it
 * rather than lying over it. A floor ring's rock is drawn over them: the cliff runs on under it.
 */
function cliffWalls(layer: DungeonLayer): CliffWalls {
  const saved = wallLines(layer.rockLines) ?? [];
  const caves = caveEdges(layer);
  const back = new Map<RockLine, number>();
  for (const line of saved) {
    const cave = caves.find((c) => c.rings.some((r) => laidFor(line, r)));
    if (cave) back.set(line, (kitRockWidth(bandPiecesFor(cave.material)) / 2) * bandSize(cave.material, cave.width ?? layerDrawStyle(layer).wallWidth));
  }
  const rings = [...caves.flatMap((c) => c.rings), ...(layer.mergedFloor ?? [])].filter((r) => r.length >= 3 && !saved.some((l) => laidFor(l, r)));
  return { lines: [...saved, ...rings.map((r): RockLine => ({ edge: r, closed: true, runs: [[...r, r[0]]] }))], back, openings: layer.caveOpenings ?? [] };
}

/** A crossing this close to either end of a drawn segment is where it joins a wall it lies along, cells. */
const CROSS_END = 0.05;
/** The most a crossing's stop is lengthened for meeting its wall aslant, as a share of the line's own. */
const CROSS_SLANT = 2;

/** Whether `p` lies inside any of `rings`. */
function insideAny([x, y]: Vec, rings: readonly Polygon[]): boolean {
  return rings.some((r) => {
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
    }
    return hit;
  });
}

/**
 * Where the drawn segment `a`–`b` crosses a wall's rock (`walls`), in order along it: each point,
 * and how far back from it the cliff stops, the line's own `back` lengthened as the segment meets
 * it aslant (no more than CROSS_SLANT times). None within CROSS_END of either end.
 */
function crossings(a: Vec, b: Vec, walls: CliffWalls): { p: Vec; t: number; back: number }[] {
  const d = vsub(b, a);
  const L = Math.hypot(d[0], d[1]);
  if (L < 2 * CROSS_END) return [];
  const out: { p: Vec; t: number; back: number }[] = [];
  for (const line of walls.lines) {
    const back = walls.back.get(line) ?? 0;
    for (const r of line.runs) {
      for (let k = 0; k + 1 < r.length; k++) {
        const e = vsub(r[k + 1] as Vec, r[k] as Vec);
        const den = d[0] * e[1] - d[1] * e[0];
        if (Math.abs(den) < 1e-12) continue;
        const w = vsub(r[k] as Vec, a);
        const t = (w[0] * e[1] - w[1] * e[0]) / den;
        const u = (w[0] * d[1] - w[1] * d[0]) / den;
        if (u < 0 || u > 1 || t * L < CROSS_END || (1 - t) * L < CROSS_END) continue;
        const sin = Math.abs(den) / (L * Math.hypot(e[0], e[1]));
        out.push({ p: vadd(a, vmul(d, t)), t, back: back / Math.max(1 / CROSS_SLANT, sin) });
      }
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/**
 * Where the outline's corner `a` (come into from `prev`, left toward `next`) lies on a wall's line
 * (within CROSS_END) and the outline passes through it there, one side to the other: how far back
 * from it the cliff stops, as `crossings` says for a crossing; null where it does not.
 */
function cornerCrossing(prev: Vec, a: Vec, next: Vec, walls: CliffWalls): number | null {
  for (const line of walls.lines) {
    for (const r of line.runs) {
      for (let k = 0; k + 1 < r.length; k++) {
        const [p, q] = [r[k] as Vec, r[k + 1] as Vec];
        if (segDist(a, p, q) > CROSS_END) continue;
        const e = vsub(q, p);
        const L = Math.hypot(e[0], e[1]);
        if (L < 1e-9) continue;
        const side = (v: Vec): number => (e[0] * (v[1] - p[1]) - e[1] * (v[0] - p[0])) / L;
        const [s0, s1] = [side(prev), side(next)];
        if (Math.abs(s0) <= CROSS_END || Math.abs(s1) <= CROSS_END || Math.sign(s0) === Math.sign(s1)) continue;
        const d = vsub(next, a);
        const sin = Math.abs(d[0] * e[1] - d[1] * e[0]) / ((Math.hypot(d[0], d[1]) || 1) * L);
        return (walls.back.get(line) ?? 0) / Math.max(1 / CROSS_SLANT, sin);
      }
    }
  }
  return null;
}

/**
 * A ledge cliff's stretches off every wall (`cliffWalls`), each an open run laid on to the wall's
 * line at a tip that meets one (short of it by the line's `back`), and its top drawn along its
 * own cliff's line where it has one (`own`). A cliff is cut where it crosses a wall's rock as
 * well as where it lies along it, and laid nowhere inside an erased opening. A cliff that meets
 * no wall is its walk, its top the run as drawn (`laid`), as one stretch; one wholly on walls has none.
 */
function cliffRuns(run: EdgeRun, walk: EdgeRun, laid: EdgeRun, walls: CliffWalls, own: RockLine[] | undefined, joinAt: (edge: number) => WalkPlacement | null = () => null): CliffRun[] {
  const whole: CliffRun[] = [{ run: walk, top: laid, merged: [false, false], butts: [false, false], opens: [false, false] }];
  // Segment k of the run is its ring's edge start + k: those inside a stair span lay no rock.
  const ringEdges = run.band.edges[run.ring];
  const stairsAt = (k: number): boolean => ringEdges[(run.start + k) % ringEdges.length]?.stairs === true;
  const entranceAt = (k: number): boolean => ringEdges[(run.start + k) % ringEdges.length]?.entrance === true;
  const stairs = run.drops.some((_, k) => stairsAt(k) || entranceAt(k));
  if (walls.lines.length === 0 && walls.openings.length === 0 && !stairs) return whole;
  const cut = alongRock(run.points, run.closed, walls.lines);
  // The run as stretches of drawn edge and the walls between them, each wall with how far short of
  // it the cliff stops; a flight of stairs is a gap it stops at exactly, tapered (`opens`); an
  // entrance's piece one it stops at exactly, untapered (`joins`).
  type Item = { a: Vec; b: Vec; drop: number } | { back: number; opens?: true; joins?: WalkPlacement };
  const items: Item[] = [];
  for (let i = 0; i < cut.on.length; i++) {
    const a = cut.points[i];
    const b = cut.points[(i + 1) % cut.points.length];
    if (cut.on[i] >= 0) {
      items.push({ back: walls.back.get(cut.replaced[cut.on[i]].line) ?? 0 });
      continue;
    }
    if (entranceAt(cut.segs[i])) {
      // An entrance's piece lies there (`entrancePlacements`); with none (no piece that wide), a gap, as at stairs.
      const pl = joinAt((run.start + cut.segs[i]) % ringEdges.length);
      items.push(pl ? { back: 0, joins: pl } : { back: 0, opens: true });
      continue;
    }
    if (stairsAt(cut.segs[i])) {
      items.push({ back: 0, opens: true });
      continue;
    }
    if (insideAny(vmul(vadd(a, b), 0.5), walls.openings)) {
      items.push({ back: 0 });
      continue;
    }
    const drop = run.drops[cut.segs[i]];
    // A corner of the outline drawn on a wall's line, the outline passing through it there, is a
    // crossing too: `crossings` leaves out what lies at a segment's ends.
    const p = i > 0 ? i - 1 : run.closed ? cut.on.length - 1 : -1;
    if (p >= 0 && cut.on[p] < 0) {
      const back = cornerCrossing(cut.points[p], a, b, walls);
      if (back !== null) items.push({ back });
    }
    let from = a;
    for (const x of crossings(a, b, walls)) {
      items.push({ a: from, b: x.p, drop }, { back: x.back });
      from = x.p;
    }
    items.push({ a: from, b, drop });
  }
  const m = items.length;
  type Wall = { back: number; opens?: true; joins?: WalkPlacement };
  const isWall = (it: Item): it is Wall => 'back' in it;
  if (!items.some(isWall)) return whole;
  // A ring is read from just past a wall, so no stretch is split across its seam.
  const start = run.closed ? items.findIndex((it, i) => !isWall(it) && isWall(items[(i - 1 + m) % m])) : 0;
  if (start < 0) return [];
  const out: CliffRun[] = [];
  // `head` and a tail: the wall or stairs it meets (how far short of it the stretch stops), null at a free tip.
  let part: { points: Vec[]; drops: number[]; head: Wall | null } | null = null;
  let before: Wall | null = null;
  const flush = (tail: Wall | null) => {
    const kept = part && trimmed(part.points, part.drops, part.head?.back ?? 0, tail?.back ?? 0);
    if (part && kept) {
      const stretch: EdgeRun = { ...run, closed: false, ...kept };
      const a = alongRock(kept.points, false, own);
      const bare = (w: Wall | null): boolean => !!w?.opens || !!w?.joins;
      const top = a.replaced.length === 0 ? stretch : { ...stretch, ...rockEnds(a, kept.drops, bare(part.head), bare(tail)) };
      out.push({
        run: stretch,
        top,
        // A tip at stairs or an entrance is a free end (laid to its end), never one that runs on into rock.
        merged: [part.head !== null && !bare(part.head), tail !== null && !bare(tail)],
        butts: [(part.head?.back ?? 0) > 0, (tail?.back ?? 0) > 0],
        opens: [!!part.head?.opens, !!tail?.opens],
        ...((part.head?.joins || tail?.joins) && {
          joins: [!!part.head?.joins, !!tail?.joins] as [boolean, boolean],
          joined: [part.head?.joins ?? null, tail?.joins ?? null] as [WalkPlacement | null, WalkPlacement | null],
        }),
      });
    }
    part = null;
  };
  if (run.closed) {
    const last = items[(start - 1 + m) % m];
    before = isWall(last) ? last : null;
  }
  for (let j = 0; j < m; j++) {
    const it = items[(start + j) % m];
    if (isWall(it)) {
      flush(it);
      before = it;
      continue;
    }
    part ??= { points: [it.a], drops: [], head: before };
    part.points.push(it.b);
    part.drops.push(it.drop);
  }
  flush(null);
  return out;
}

/** The most of a stretch's drawn edge left before its rock line starts, at a tip beside stairs, that is dropped from its top line, cells. */
const HOOK_MAX = 0.6;

/**
 * A stretch's top line along its own rock line (`a`, each segment with its drop), ending where the
 * rock does at a tip beside stairs (`head`, `tail`): the short bit of drawn edge from the span's end
 * to the rock line is left off, and the line runs on along the rock to the rock line's own end
 * there, so it neither hooks back to the edge nor stops short of the rock.
 */
function rockEnds(a: AlongRock, drops: number[], head: boolean, tail: boolean): { points: Vec[]; drops: number[] } {
  let points = a.points;
  let ds = a.segs.map((i) => drops[i]);
  const length =(pts: readonly Vec[]): number => pts.reduce((s, p, k) => (k === 0 ? 0 : s + vdist(pts[k - 1], p)), 0);
  const runs = [...new Set(a.replaced.map((r) => r.line))].flatMap((l) => l.runs as Vec[][]);
  /** The rock line from the end of one of its runs to `p` on it, when that is short: that end first, `p` left off. */
  const fromRunEnd = (p: Vec): Vec[] => {
    for (const r of runs) {
      for (const run of [r, [...r].reverse()]) {
        let s = 0;
        for (let j = 0; j + 1 < run.length && s <= HOOK_MAX; j++) {
          if (segDist(p, run[j], run[j + 1]) < 0.01) return vdist(p, run[j]) < 1e-9 ? run.slice(0, j) : run.slice(0, j + 1);
          s += vdist(run[j], run[j + 1]);
        }
      }
    }
    return [];
  };
  const onRock = (p: Vec): boolean => runs.some((r) => r.some((q, j) => j + 1 < r.length && segDist(p, q, r[j + 1]) < 0.01));
  if (head) {
    const k = points.findIndex(onRock);
    if (k >= 0 && length(points.slice(0, k + 1)) <= HOOK_MAX) {
      const lead = fromRunEnd(points[k]);
      points = [...lead, ...points.slice(k)];
      ds = [...lead.map(() => ds[k]), ...ds.slice(k)];
    }
  }
  if (tail) {
    let k = -1;
    for (let i = points.length - 1; i >= 0 && k < 0; i--) if (onRock(points[i])) k = i;
    if (k >= 0 && length(points.slice(k)) <= HOOK_MAX) {
      const trail = fromRunEnd(points[k]).reverse();
      const keep = ds.slice(0, k);
      points = [...points.slice(0, k + 1), ...trail];
      ds = [...keep, ...trail.map(() => keep[keep.length - 1] ?? ds[0])];
    }
  }
  return { points, drops: ds };
}

/** The open line `points` less `head` of its length at its start and `tail` at its end, each kept segment with its drop; null when nothing is left. */
function trimmed(points: Vec[], drops: number[], head: number, tail: number): { points: Vec[]; drops: number[] } | null {
  if (head <= 0 && tail <= 0) return { points, drops };
  const cum = [0];
  for (let k = 0; k + 1 < points.length; k++) cum.push(cum[k] + vdist(points[k], points[k + 1]));
  const [lo, hi] = [head, cum[cum.length - 1] - tail];
  if (hi - lo < 1e-6) return null;
  const out: Vec[] = [];
  const kept: number[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [s0, s1] = [cum[k], cum[k + 1]];
    if (s1 <= lo || s0 >= hi || s1 - s0 < 1e-12) continue;
    const at = (s: number): Vec => vadd(points[k], vmul(vsub(points[k + 1], points[k]), (s - s0) / (s1 - s0)));
    if (out.length === 0) out.push(at(Math.max(lo, s0)));
    out.push(at(Math.min(hi, s1)));
    kept.push(drops[k]);
  }
  return { points: out, drops: kept };
}

/**
 * `region` fitted to a measured kit's rock (`fit`, the layer's floor fit), but only beside the
 * stretches of `runs` that go along a wall: there it is cut where it lies past the rock and grown
 * to meet it, as the floor is (`fittedFloor`). Along a cliff's own line it is fitted the same way
 * to that line (`LaidRun.cliff`). A region on the low side outside the band (`outside`: a raised
 * edge's shade or face) is fitted the other way round, so it ends where the fitted top begins;
 * a pit's top and shade lie inside its band, so they take the fit as it is. Along no rock it is
 * handed back as it is.
 */
export function fittedAlongWalls(region: Polygon[], runs: readonly LaidRun[], fit: FloorFit | undefined, outside = false): Polygon[] {
  const zone = runs.flatMap((r) => r.zone);
  const ownTips = runs.flatMap((r) => r.cliff.tips);
  const ownGaps = runs.flatMap((r) => r.cliff.gaps);
  const walled = !!fit && zone.length > 0;
  if (region.length === 0 || (!walled && ownTips.length + ownGaps.length === 0)) return region;
  // Only the fit's pieces that reach the zone count: a brush stroke on a cave far off fits that cave
  // again, and nothing here.
  const zoneBox = walled ? boxOfRings(zone) : null;
  const near = (rings: readonly Polygon[]): Polygon[] => (zoneBox ? rings.filter((r) => boxesOverlap(boxOfRings([r]), zoneBox)) : []);
  const fitTips = near(fit?.tips ?? []);
  const fitGaps = near(fit?.gaps ?? []);
  // Nothing is left past the band's own cliff's line on the side it does not belong to, at its
  // corners or where it meets a wall: a raised top's low side; a pit's floor and shade's, and a
  // raised edge's shade's, high side.
  const beyond = runs.flatMap((r) => (!outside && r.run.drop > 0 ? r.beyond.low : r.beyond.high));
  // Kept while the region, the runs and the fit's pieces near them (kept with their layings) are.
  const key = JSON.stringify([region, zone, ownTips, ownGaps, outside, beyond]);
  const same = (a: readonly Polygon[], b: readonly Polygon[]): boolean => a.length === b.length && a.every((p, i) => p === b[i]);
  const hit = keptAlongWalls.get(key);
  if (hit && same(hit.tips, fitTips) && same(hit.gaps, fitGaps)) return hit.value;
  const keep = (rings: Polygon[]) => (walled && rings.length > 0 ? clipper2Engine.intersection(rings, zone) : []);
  const tips = [...keep(fitTips), ...ownTips];
  const gaps = [...keep(fitGaps), ...ownGaps];
  const fitted = fittedFloor(region, outside ? { tips: gaps, gaps: tips } : { tips, gaps });
  const value = beyond.length > 0 ? clipper2Engine.difference(fitted, beyond) : fitted;
  if (keptAlongWalls.size >= 64) keptAlongWalls.delete(keptAlongWalls.keys().next().value!);
  keptAlongWalls.set(key, { tips: fitTips, gaps: fitGaps, value });
  return value;
}

type Box = [number, number, number, number];
const boxOfRings = (rings: readonly Polygon[]): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) [b[0], b[1], b[2], b[3]] = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
};
const boxesOverlap = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

const keptAlongWalls = new Map<string, { tips: readonly Polygon[]; gaps: readonly Polygon[]; value: Polygon[] }>();

/**
 * A plateau's top texture region (`face` false) or its slope's face texture region, fitted along
 * the walls its own edge runs on and its own cliff's line (`fittedAlongWalls`).
 */
export function plateauAlongWalls(layer: DungeonLayer, plateau: PlateauChild, rings: Polygon[], fit: FloorFit | undefined, face: boolean): Polygon[] {
  if (!fit && !layer.rockLines?.some((l) => l.kind === 'cliff')) return rings;
  const band = layerPlateaus(layer).bands.find((b) => b.shapes.includes(plateau));
  if (!band) return rings;
  const mine = laidRuns(layer, band).filter((l) => l.run.owner === plateau);
  if (!face) return fittedAlongWalls(rings, mine, fit);
  const slopes = mine.filter((l) => l.run.edge === 'slope');
  const out = fittedAlongWalls(rings, slopes.filter((l) => l.run.drop > 0), fit, true);
  return fittedAlongWalls(out, slopes.filter((l) => l.run.drop < 0), fit);
}

/**
 * The ramp of a painted border along `run`: within `width` of the edge on its high side (on a
 * raised band's surface, outside a pit or a dip), full on the edge and easing out over its
 * inner BORDER_FADE of the width. Null where the high side holds none of it.
 */
export function paintedBorderRamp(run: EdgeRun, width: number): Ramp | null {
  const line = run.closed ? [...run.points, run.points[0]] : run.points;
  const id = run.owner?.id;
  return keptRamp('border', [line, width, run.drop > 0, run.drop > 0 ? run.band.surface : run.band.rings, id ?? null], () => {
    const fade = width * BORDER_FADE;
    // The inner edge wanders (grass creeping over the dirt unevenly), the same way every redraw.
    const noise = wobbleNoise(wobbleSeed(id));
    const reach = width * (1 + BORDER_WOBBLE);
    const strip = clipper2Engine.inflateOpen([line], reach);
    const clip = run.drop > 0 ? clipper2Engine.intersection(strip, run.band.surface) : clipper2Engine.difference(strip, run.band.rings);
    const grid = rampGrid(clip, 0.1);
    if (!grid) return null;
    const { d, qx, qy } = distanceToLines([{ pts: line, closed: false }], grid, reach);
    // The wander is read at the nearest point of the edge, so it moves each texel in from it alike.
    return { field: fieldOf(grid, (_x, _y, k) => (d[k] === Infinity ? 0 : fallOff(d[k] - width * BORDER_WOBBLE * noise(qx[k], qy[k]), width - fade, fade))), clip };
  });
}

/** A painted border's edge line, cells wide, and how dark its ink is. */
export const EDGE_LINE_WIDTH = 0.05;
export const EDGE_LINE_ALPHA = 0.85;

/** The thin ink line along a painted border's outline (the card's Edge line). */
function drawEdgeLine(parent: Container, run: EdgeRun): void {
  const path = run.closed ? [...run.points, run.points[0]] : run.points;
  const line = new Graphics();
  line.label = 'plateau-edge-line';
  line.poly(path.flat(), false).stroke({ color: INK, width: EDGE_LINE_WIDTH, alpha: EDGE_LINE_ALPHA });
  parent.addChild(line);
}

/** A painted border: its texture tiled in a band on the high side of the edge, crisp on the edge, soft inside. */
function drawPaintedBorder(parent: Container, run: EdgeRun, options: PlateauRenderOptions): void {
  const id = paintedBorderTexture(run.owner?.edgeArt);
  if (!id) return;
  const tex = resolveTexture(id);
  if (tex.width <= 1) {
    options.waitFor?.(id);
    return;
  }
  const ramp = paintedBorderRamp(run, borderWidthOf(run.owner?.borderWidth));
  if (!ramp) return;
  const border = new Container();
  border.label = 'plateau-border';
  paintRamp(border, ramp, { texture: tex, look: { scale: 1 } });
  parent.addChild(border);
}

const boxRing = (b: { minX: number; minY: number; maxX: number; maxY: number }): Polygon => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.maxX, b.maxY],
  [b.minX, b.maxY],
];

/**
 * The ground a layer's shade and slope faces may land on, as plateauGround.ts reasons about
 * what a plateau may stand on: its walled floors' union, its ground pieces, the base ground
 * over the map's frame, and any painted terrain. Empty = nothing known: everywhere.
 */
function groundOf(layer: DungeonLayer, base: WorldBounds | null): Polygon[] {
  const ground: Polygon[] = [];
  for (const ring of layer.mergedFloor ?? []) if (ring.length >= 3) ground.push(ring);
  for (const c of layer.children) {
    // A patch kept to the floors shows only on them, which are ground already.
    if (!isGroundPiece(c) || c.keptToFloors || c.visible === false) continue;
    const [outer, ...holes] = pieceRings(c);
    if (!outer || outer.length < 3) continue;
    // Outer wound positive and holes negative, so a hole stays out under the non-zero rule.
    ground.push(signedArea(outer) >= 0 ? outer : [...outer].reverse());
    for (const h of holes) if (h.length >= 3) ground.push(signedArea(h) < 0 ? h : [...h].reverse());
  }
  if (base) ground.push(boxRing(base));
  const t = useStore.getState().mapSettings.terrain?.bounds;
  if (t) ground.push(boxRing(t));
  return ground;
}

// ─── Slope faces ───────────────────────────────────────────

/** One slope run's face, as it lands. */
export interface SlopeFaceRun {
  run: EdgeRun;
  /** The unit vector its face points along. */
  v: Vec;
  /** Its face before it is cut to where it may land: the lines are drawn off this. */
  face: SlopeFace;
  /**
   * The face and its ledge bands, rim to foot, cut to where they may land (`land`) and off the
   * faces of higher bands (`over`).
   */
  region: Polygon[];
  bands: Polygon[][];
  /** The faces of the bands drawn over this one's: what shows over it, so nothing of it is drawn there. */
  over: Polygon[];
  /**
   * Where the face runs on under a cliff of its band at an end of its run (`underCliff`): the end
   * of its run-on, and the way it ran on. Its side fades out there over FACE_SIDE_FADE.
   */
  fades: { at: Vec; along: Vec }[];
}

/** Where what an edge throws may land, per band and the side it drops to: outside it (`outward`) or inside a pit. */
export type LandOf = (band: PlateauBand, outward: boolean) => Polygon[];

/** A layer's slope faces, and where an edge's shade and face may land. */
export interface LayerSlopes {
  faces: SlopeFaceRun[];
  land: LandOf;
}

/** How often a layer's slope faces were worked out afresh (`layerSlopes`). Tests read it. */
export const slopeWork = { faces: 0 };

const slopeMemo = new WeakMap<readonly unknown[], { floor: unknown; terrain: unknown; base: string; dir: unknown; lines: unknown; value: LayerSlopes }>();

/**
 * Every slope run's face on the layer, with its direction (its plateau's, else the map's), cut
 * to where the drop shade may land: the run's low side, on ground, never on a band as high or
 * higher. Kept while the layer's children, its ground and the map's direction stay the same:
 * the floors, the edges, the shadows and the brush all ask.
 */
export function layerSlopes(layer: DungeonLayer): LayerSlopes {
  const map = useStore.getState().mapSettings;
  const terrain = map.terrain?.bounds ?? null;
  const base = hasPlateaus(layer) ? baseGroundFrame(layer) : null;
  const baseKey = base ? `${base.minX},${base.minY},${base.maxX},${base.maxY}` : '';
  const hit = slopeMemo.get(layer.children);
  if (hit && hit.floor === layer.mergedFloor && hit.terrain === terrain && hit.base === baseKey && hit.dir === map.faceDirection && hit.lines === layer.rockLines) return hit.value;

  slopeWork.faces++;
  const { bands } = layerPlateaus(layer);
  const ground = groundOf(layer, base);
  let groundUnion: Polygon[] | null = null;
  const lands = new Map<PlateauBand, Map<boolean, Polygon[]>>();
  const land: LandOf = (band, outward) => {
    let sides = lands.get(band);
    if (!sides) lands.set(band, (sides = new Map()));
    const known = sides.get(outward);
    if (known) return known;
    const low = lowRegion(band, bands, outward, SHADE_REACH + FACE_DEPTH_MAX * (1 + FACE_DEPTH_WANDER));
    groundUnion ??= ground.length > 0 ? clipper2Engine.union(ground, []) : null;
    const region = groundUnion ? clipper2Engine.intersection(low, groundUnion) : low;
    sides.set(outward, region);
    return region;
  };

  const faces: SlopeFaceRun[] = [];
  for (const band of bands) {
    for (const { run, laid } of laidRuns(layer, band)) {
      if (run.edge !== 'slope' || run.drop === 0) continue;
      const deg = faceDirectionOf(run.owner, map.faceDirection);
      // Wandering and stepped by its plateau's id, so it is the same rock on every redraw; each
      // stretch as deep as its own drop, eased into the rim at the ends where the face stops.
      // Laid along a cave wall's rock where the edge runs on one; its ends read off the drawn ring.
      const ends = run.closed ? undefined : faceEnds(band, run, map.faceDirection);
      // Beside a cliff of its own band the face runs on under the cliff's rock at its full depth.
      const under = run.closed ? null : underCliff(band, run, laid);
      const face = under
        ? slopeFace(under.points, false, laid.drop > 0, band.rings, deg, under.drops, wobbleSeed(run.owner?.id), { start: ends!.start && !under.start, end: ends!.end && !under.end })
        : slopeFace(laid.points, laid.closed, laid.drop > 0, band.rings, deg, laid.drops, wobbleSeed(run.owner?.id), ends);
      if (face.region.length === 0) continue;
      const where = land(band, run.drop > 0);
      const cut = (rings: Polygon[]) => (rings.length === 0 ? [] : clipper2Engine.intersection(rings, where));
      faces.push({ run: laid, v: faceVector(deg), face, region: cut(face.region), bands: face.bands.map(cut), over: [], fades: under?.fades ?? [] });
    }
  }
  // One order for every face, the bands' own: where a later band's face lies over an earlier
  // one's, the later shows whole, tile, bands and lines, and nothing of the earlier shows through it.
  const landed = faces.map((f) => f.region);
  for (const f of faces) {
    const over = faces.flatMap((g, i) => (byPrecedence(g.run.band, f.run.band) > 0 ? landed[i] : []));
    if (over.length === 0) continue;
    const off = (rings: Polygon[]) => (rings.length === 0 ? [] : clipper2Engine.difference(rings, over));
    f.over = over;
    f.region = off(f.region);
    f.bands = f.bands.map(off);
  }
  const value: LayerSlopes = { faces, land };
  slopeMemo.set(layer.children, { floor: layer.mergedFloor, terrain, base: baseKey, dir: map.faceDirection, lines: layer.rockLines, value });
  return value;
}

/**
 * The fade over a band's faces where they run on under a cliff (`SlopeFaceRun.fades`): nothing at
 * each run-on's end, full FACE_SIDE_FADE back from it, eased, as a true ramp; full everywhere
 * else. Null when no face runs on under one.
 */
export function faceSideFade(faces: SlopeFaceRun[]): RampField | null {
  const fades = faces.flatMap((f) => f.fades);
  if (fades.length === 0) return null;
  const regions = faces.flatMap((f) => f.face.region);
  const kept = keptRamp('face-side', [regions, fades], () => {
    const grid = rampGrid(regions, 0.1);
    if (!grid) return null;
    // Only near a run-on's end: within a face's depth and a cell of it across, behind its end line.
    const reach = FACE_DEPTH_MAX * (1 + FACE_DEPTH_WANDER) + 1;
    return {
      field: fieldOf(grid, (x, y) => {
        let a = 1;
        for (const { at, along } of fades) {
          const back = (at[0] - x) * along[0] + (at[1] - y) * along[1];
          const across = Math.abs((x - at[0]) * along[1] - (y - at[1]) * along[0]);
          if (across > reach || back > FACE_SIDE_FADE) continue;
          a = Math.min(a, ease(unit(back / FACE_SIDE_FADE)));
        }
        return a;
      }),
      clip: null,
    };
  });
  return kept?.field ?? null;
}

/** How far a slope's face runs on under a cliff of its own band, cells: past the cliff's narrowed tip, under its rock. */
const FACE_UNDER_CLIFF = 0.5;
/** How far in from where it runs on under a cliff a face's side fades from nothing to full, cells. */
export const FACE_SIDE_FADE = 0.3;

/**
 * Where an open slope run (`run`, drawn as `laid`) meets a cliff of its own band at either end
 * (the next edge a ledge cliff dropping the same way): its line run on FACE_UNDER_CLIFF along that
 * cliff's edge there, under the cliff's rock, with its drops, which ends ran on, and each run-on's
 * end and way. Null where neither end meets one.
 */
function underCliff(band: PlateauBand, run: EdgeRun, laid: EdgeRun): { points: Vec[]; drops: number[]; start: boolean; end: boolean; fades: { at: Vec; along: Vec }[] } | null {
  const ring = band.rings[run.ring];
  const edges = band.edges[run.ring];
  const n = ring.length;
  const cliffAt = (index: number): boolean => {
    const e = edges[((index % n) + n) % n];
    return e.edge === 'cliff' && e.drop !== 0 && Math.sign(e.drop) === Math.sign(run.drop) && !isPaintedBorder(e.owner?.edgeArt);
  };
  const way = (from: Vec, to: Vec): { along: Vec; room: number } => {
    const d = vsub(to, from);
    const L = Math.hypot(d[0], d[1]);
    return { along: L > 1e-9 ? vmul(d, 1 / L) : [0, 0], room: L };
  };
  const i0 = (((run.start - 1) % n) + n) % n;
  const i1 = (run.start + run.points.length - 1) % n;
  const start = cliffAt(i0);
  const end = cliffAt(i1);
  if (!start && !end) return null;
  const points = laid.points.map(([x, y]): Vec => [x, y]);
  const drops = [...laid.drops];
  const fades: { at: Vec; along: Vec }[] = [];
  if (start) {
    const { along, room } = way(ring[(i0 + 1) % n] as Vec, ring[i0] as Vec);
    const at = vadd(points[0], vmul(along, Math.min(FACE_UNDER_CLIFF, room)));
    points.unshift(at);
    drops.unshift(drops[0] ?? laid.drop);
    fades.push({ at, along });
  }
  if (end) {
    const { along, room } = way(ring[i1] as Vec, ring[(i1 + 1) % n] as Vec);
    const at = vadd(points[points.length - 1], vmul(along, Math.min(FACE_UNDER_CLIFF, room)));
    points.push(at);
    drops.push(drops[drops.length - 1] ?? laid.drop);
    fades.push({ at, along });
  }
  return { points, drops, start, end, fades };
}

/**
 * Which ends of an open slope run its face eases into the rim at. Not where the ring goes on
 * under or against a higher plateau (the next edge has no drop: the face runs on under it), nor
 * where it goes on as another slope whose edge there faces its own direction too (two plateaus
 * of one height with different settings: no notch between them).
 */
function faceEnds(band: PlateauBand, run: EdgeRun, mapDirection: number | undefined): FaceEnds {
  const ring = band.rings[run.ring];
  const edges = band.edges[run.ring];
  const n = ring.length;
  const goesOn = (index: number): boolean => {
    const i = ((index % n) + n) % n;
    const e = edges[i];
    if (e.drop === 0) return true;
    if (e.edge !== 'slope' || !e.owner) return false;
    const seg = lowSegments([ring[i], ring[(i + 1) % n]], false, e.drop > 0)[0];
    if (!seg) return false;
    const v = faceVector(faceDirectionOf(e.owner, mapDirection));
    return seg.n[0] * v[0] + seg.n[1] * v[1] > 1e-6;
  };
  return { start: !goesOn(run.start - 1), end: !goesOn(run.start + run.points.length - 1) };
}

interface TopMemo {
  slopes: LayerSlopes;
  value: Map<PlateauChild, Polygon[]>;
  /** Per plateau, what of higher bands shows over its top. */
  above: Map<PlateauChild, Polygon[]>;
  /** Worked out on the first ask (`plateauTopFills`). */
  fills?: Map<PlateauChild, TopFill>;
}

const topMemo = new WeakMap<readonly unknown[], TopMemo>();

/**
 * The order the tops and faces of a layer's plateaus are drawn in, by plateau: precedence
 * (`byPrecedence`: the more deeply nested, then the higher), then the layer's own order. The
 * later of two overlapping tops wins.
 */
export function plateauDrawOrder(layer: DungeonLayer): Map<PlateauChild, number> {
  const { infos } = layerPlateaus(layer);
  const rank = (p: PlateauChild) => precedenceOf(infos.get(p.id) ?? { chain: [], height: 0 });
  const listed = plateausOf(layer);
  const sorted = listed.map((p, i) => ({ p, i })).sort((a, b) => byPrecedence(rank(a.p), rank(b.p)) || a.i - b.i);
  return new Map(sorted.map(({ p }, k) => [p, k]));
}

/**
 * The tops of every plateau with a top texture, by plateau, in draw order: its own outline
 * (holes kept) less the outlines of textured plateaus of another level that win over it
 * (`byPrecedence`) and the faces of plateaus that win over it, which show over it. What the
 * grid and the Material brush take as its top; the floors draw its texture over
 * `plateauTopFills`, which grows and fades it at seams with tops of its own level. A plateau
 * with a Ground top draws none, so a textured top under it shows through.
 */
export function plateauTopTiles(layer: DungeonLayer): Map<PlateauChild, Polygon[]> {
  const out = new Map<PlateauChild, Polygon[]>();
  if (!hasPlateaus(layer)) return out;
  const { infos } = layerPlateaus(layer);
  const order = plateauDrawOrder(layer);
  const textured = plateausOf(layer)
    .filter((p) => p.topArt && (infos.get(p.id)?.chain.length ?? 0) > 0)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (textured.length === 0) return out;
  const slopes = layerSlopes(layer);
  const hit = topMemo.get(layer.children);
  if (hit && hit.slopes === slopes) return hit.value;
  const rankOf = (p: PlateauChild) => precedenceOf(infos.get(p.id)!);
  const aboveOf = new Map<PlateauChild, Polygon[]>();
  for (const p of textured) {
    const mine = rankOf(p);
    // Tops of its own level are its band's: they meet in a seam (`plateauTopFills`), not a cut.
    const above = [
      ...textured.filter((q) => rankOf(q).height !== mine.height && byPrecedence(rankOf(q), mine) > 0).flatMap((q) => unionShapes([q])),
      ...slopes.faces
        .filter((f) => byPrecedence(f.run.owner && infos.has(f.run.owner.id) ? rankOf(f.run.owner) : f.run.band, mine) > 0)
        .flatMap((f) => f.region),
    ];
    const own = unionShapes([p]);
    const rings = above.length > 0 && own.length > 0 ? clipper2Engine.difference(own, above) : own;
    if (rings.length > 0) out.set(p, rings);
    aboveOf.set(p, above);
  }
  topMemo.set(layer.children, { slopes, value: out, above: aboveOf });
  return out;
}

// ─── Seams between tops of one height ──────────────────────

/** A textured top as the floors draw it. */
export interface TopFill {
  /** Its top (`plateauTopTiles`), grown TOP_SEAM under each later textured top of its band across a seam. */
  rings: Polygon[];
  /** The ramp it is painted through, within `rings`, when it fades in from a seam; null paints `rings` crisp. */
  soft: RampField | null;
  /** The stretches of its outline it fades in from: open lines, in its own outline's order. */
  fades: Polygon[];
  /** The stretches of its outline it grows across, under a later textured top. */
  grows: Polygon[];
}

/** A point this near a line lies on it, cells: Clipper keeps two decimals. */
const SEAM_ON = 0.02;
/** How far across a seam is looked at to tell what lies there, cells. */
const SEAM_PROBE = 0.05;

/** Inside a set of rings by even-odd: holes count as outside. */
function inRegion(rings: readonly Polygon[], p: Vec): boolean {
  let n = 0;
  for (const r of rings) if (r.length >= 3 && pointInPoly(p[0], p[1], r)) n++;
  return n % 2 === 1;
}

/** How near `p` comes to the closed `rings`. */
function ringsDistance(rings: readonly Polygon[], p: Vec): number {
  let best = Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) best = Math.min(best, segDist(p, r[i] as Vec, r[(i + 1) % r.length] as Vec));
  return best;
}

/** `ring` with every one of `points` that lies inside one of its edges added there, in order along it. */
function splitAtPoints(ring: Polygon, points: readonly [number, number][]): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % ring.length] as Vec;
    out.push(a);
    const ab = vsub(b, a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if (l2 < 1e-12) continue;
    const len = Math.sqrt(l2);
    const ts: number[] = [];
    for (const p of points) {
      const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2;
      if (t * len <= SEAM_ON || (1 - t) * len <= SEAM_ON) continue;
      if (segDist(p as Vec, a, b) <= SEAM_ON / 4) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    for (const t of ts) out.push(vadd(a, vmul(ab, t)));
  }
  return out;
}

/**
 * The seams of plateau `p`'s top: the parts of its own outline inside its band's union, off the
 * band's rings, where another plateau of its level meets it. Each stretch is told by what lies
 * just across it: a plateau later in the draw order (`plateauDrawOrder`) with a top texture of
 * its own (`grows`: `p` runs on under it), else anything (`fades`: `p` fades in from it).
 */
function topSeams(p: PlateauChild, band: PlateauBand, placeOf: Map<unknown, number>): { fades: Polygon[]; grows: Polygon[] } {
  const fades: Polygon[] = [];
  const grows: Polygon[] = [];
  const own = unionShapes([p]);
  const others = band.shapes.filter((q) => q !== p).map((q) => ({ q, rings: unionShapes([q]) }));
  const otherRings = others.flatMap((o) => o.rings);
  const corners = otherRings.flat() as [number, number][];
  const at = placeOf.get(p) ?? -1;
  for (const outline of own) {
    if (outline.length < 3) continue;
    const ring = splitAtPoints(splitAtCrossings(outline, otherRings), corners);
    const n = ring.length;
    const kinds = ring.map((pt, i): 'rim' | 'fade' | 'grow' => {
      const a = pt as Vec;
      const b = ring[(i + 1) % n] as Vec;
      const len = vdist(a, b);
      if (len < 1e-9) return 'rim';
      const mid = vmul(vadd(a, b), 0.5);
      if (ringsDistance(band.rings, mid) <= SEAM_ON) return 'rim';
      const nrm: Vec = [(-(b[1] - a[1]) / len) * SEAM_PROBE, ((b[0] - a[0]) / len) * SEAM_PROBE];
      const left = vadd(mid, nrm);
      const right = vsub(mid, nrm);
      const inLeft = inRegion(own, left);
      if (inLeft === inRegion(own, right)) return 'rim';
      const across = inLeft ? right : left;
      const later = others.some((o) => (placeOf.get(o.q) ?? -1) > at && !!o.q.topArt && inRegion(o.rings, across));
      return later ? 'grow' : 'fade';
    });
    // Consecutive edges of one kind as one open line, so a wobble runs on along the stretch.
    let start = kinds.findIndex((k, i) => k !== kinds[(i - 1 + n) % n]);
    const closed = start < 0;
    if (closed) start = 0;
    let line: Polygon | null = null;
    let kind: 'rim' | 'fade' | 'grow' = 'rim';
    const flush = () => {
      if (line && kind !== 'rim') (kind === 'grow' ? grows : fades).push(line);
      line = null;
    };
    for (let k = start; k < start + n; k++) {
      const i = k % n;
      if (line && kinds[i] !== kind) flush();
      if (!line) {
        line = [ring[i]];
        kind = kinds[i];
      }
      line.push(ring[(i + 1) % n]);
    }
    flush();
  }
  return { fades, grows };
}

/**
 * The ramp a top fades in from its seams by, over `region` (the top as drawn): nothing on the
 * seam, full TOP_SEAM inside it, eased between, the full edge wandering as a painted border's
 * inner edge does, the same way every time for `seed`. The rest of the top's outline stays crisp.
 */
export function seamFadeField(region: Polygon[], seams: Polygon[], seed: number): RampField | null {
  const grid = rampGrid(region, 0.1);
  if (!grid) return null;
  const noise = wobbleNoise(seed);
  const reach = TOP_SEAM * (1 + BORDER_WOBBLE);
  const { d, qx, qy } = distanceToLines(
    seams.map((pts) => ({ pts, closed: false })),
    grid,
    reach,
  );
  return fieldOf(grid, (_x, _y, k) => (d[k] === Infinity ? 1 : ease(unit((d[k] - TOP_SEAM * BORDER_WOBBLE * noise(qx[k], qy[k]) * ease(unit(d[k] / TOP_SEAM))) / TOP_SEAM))));
}

/**
 * Every textured top as the floors draw it, by plateau: where it meets another plateau of its
 * height the two feather into each other instead of meeting in a hard edge (`topSeams`): the
 * later one in the order fades in over TOP_SEAM, the earlier runs on TOP_SEAM under it so it has
 * that texture to fade onto, and a top against a Ground top fades in from nothing. The band's
 * outer rim and the cut by higher bands stay crisp. A top that meets none is its tile as is.
 * Kept with the tops.
 */
export function plateauTopFills(layer: DungeonLayer): Map<PlateauChild, TopFill> {
  const tops = plateauTopTiles(layer);
  const memo = topMemo.get(layer.children);
  if (tops.size === 0 || !memo || memo.value !== tops) return new Map([...tops].map(([p, rings]) => [p, { rings, soft: null, fades: [], grows: [] }]));
  if (memo.fills) return memo.fills;
  const { bands } = layerPlateaus(layer);
  const placeOf: Map<unknown, number> = plateauDrawOrder(layer);
  const fills = new Map<PlateauChild, TopFill>();
  for (const [p, rings] of tops) {
    const band = bands.find((b) => b.shapes.includes(p));
    const seams = band && band.shapes.length > 1 ? topSeams(p, band, placeOf) : { fades: [], grows: [] };
    let drawn = rings;
    if (band && seams.grows.length > 0) {
      const under = clipper2Engine.intersection(clipper2Engine.inflateOpen(seams.grows, TOP_SEAM), band.rings);
      const above = memo.above.get(p) ?? [];
      const grown = clipper2Engine.union(rings, under);
      drawn = above.length > 0 ? clipper2Engine.difference(grown, above) : grown;
    }
    const soft = seams.fades.length > 0 ? seamFadeField(drawn, seams.fades, wobbleSeed(p.id)) : null;
    fills.set(p, { rings: drawn, soft, ...seams });
  }
  memo.fills = fills;
  return fills;
}

/**
 * The faces of every slope plateau with a face texture, by plateau, as they land, in the bands'
 * draw order: what the floors draw its tile over.
 */
export function slopeFaceTiles(layer: DungeonLayer): Map<PlateauChild, Polygon[]> {
  const out = new Map<PlateauChild, Polygon[]>();
  if (!hasPlateaus(layer)) return out;
  const faces = [...layerSlopes(layer).faces].sort((a, b) => byPrecedence(a.run.band, b.run.band));
  for (const { run, region } of faces) {
    const owner = run.owner;
    if (!owner?.faceArt || region.length === 0) continue;
    out.set(owner, [...(out.get(owner) ?? []), ...region]);
  }
  return out;
}

/**
 * The faces of one band, above every ground piece: each ledge band shaded by its step
 * (`faceBandShades`: over a face tile its upper band lifted and its lowest darkened, over
 * plain ground darkening only), the foot lined and, with the plateau's Ledge lines on, a finer
 * line between the bands, both kept to where the face may land; then the rim along the outline,
 * heavier where the edge faces the face direction, and a pale highlight just inside it on the
 * far side.
 */
function drawSlopeFaces(holder: Container, band: PlateauBand, faces: SlopeFaceRun[], land: LandOf): void {
  if (faces.length === 0) return;
  // Where a face runs on under a cliff, its side fades out under the rock (faceSideFade).
  const fade = faceSideFade(faces);
  let parent = holder;
  if (fade) {
    parent = new Container();
    parent.label = 'plateau-slope-side-fade';
    const mask = rampMaskSprite(fade);
    parent.addChild(mask);
    parent.mask = mask;
    holder.addChild(parent);
  }
  const shade = new Graphics();
  shade.label = 'plateau-slope-face';
  // The lift is added over what is there, so the tile's own streaks stay as they are, lighter.
  const lift = new Graphics();
  lift.label = 'plateau-slope-lift';
  lift.blendMode = 'add';
  for (const { run, bands } of faces) {
    const shades = faceBandShades(bands.length, !!run.owner?.faceArt);
    bands.forEach((rings, k) => {
      const s = shades[k];
      if (s) fillRings(s.add ? lift : shade, rings, { color: s.color, alpha: s.alpha });
    });
  }
  parent.addChild(shade);
  if (lift.context.instructions.length > 0) parent.addChild(lift);
  else lift.destroy();

  for (const outward of [true, false]) {
    const mine = faces.filter((f) => f.run.drop > 0 === outward);
    if (mine.length === 0) continue;
    const lines = new Graphics();
    lines.label = 'plateau-slope-lines';
    for (const { run, face } of mine) {
      const { foot, ledges } = faceLines(face, band.rings);
      for (const line of foot) lines.poly(line.flat(), false).stroke({ color: FACE_INK, width: FACE_FOOT_WIDTH, alpha: FACE_FOOT_ALPHA, join: 'round', cap: 'round' });
      if (run.owner?.contourLines === false) continue;
      for (const ledge of ledges) lines.poly(ledge.flat(), false).stroke({ color: FACE_INK, width: FACE_LEDGE_WIDTH, alpha: FACE_LEDGE_ALPHA, join: 'round', cap: 'round' });
    }
    // Kept to where the face may land, and off the faces of higher bands.
    const over = faces[0].over;
    const mask = new Graphics();
    mask.label = 'plateau-slope-mask';
    fillRings(mask, keptOff(faces[0], outward ? 'out' : 'in', () => (over.length > 0 ? clipper2Engine.difference(land(band, outward), over) : land(band, outward))), { color: 0xffffff });
    const clip = new Container();
    clip.label = 'plateau-slope-foot';
    clip.addChild(lines, mask);
    clip.mask = mask;
    parent.addChild(clip);
  }

  const rim = new Graphics();
  rim.label = 'plateau-slope-rim';
  for (const { run, v } of faces) drawRim(rim, run, v);
  const over = faces[0].over;
  if (over.length === 0) {
    parent.addChild(rim);
    return;
  }
  // The rim stays off a higher band's face too.
  const mask = new Graphics();
  mask.label = 'plateau-slope-rim-mask';
  fillRings(mask, keptOff(faces[0], 'rim', () => clipper2Engine.difference(lowRegion(band, [], true, 1), over)), { color: 0xffffff });
  const clip = new Container();
  clip.label = 'plateau-slope-rim-clip';
  clip.addChild(rim, mask);
  clip.mask = mask;
  parent.addChild(clip);
}

/**
 * A face's lines, worked out once while the layer's slopes and the band's rings stay the same
 * (`layerSlopes` keeps its faces): its foot and sides, and each ledge boundary off the rim and the face.
 */
function faceLines(face: SlopeFace, rings: Polygon[]): { foot: Polygon[]; ledges: Polygon[] } {
  const hit = keptFaceLines.get(face);
  if (hit && hit.rings === rings) return hit.value;
  const value = {
    foot: linesOff(face.region, rings),
    ledges: face.steps.slice(0, -1).flatMap((step) => linesOff(step, [...rings, ...face.region])),
  };
  keptFaceLines.set(face, { rings, value });
  return value;
}
const keptFaceLines = new WeakMap<SlopeFace, { rings: Polygon[]; value: { foot: Polygon[]; ledges: Polygon[] } }>();

/** A band's face masks, kept on its first face (`layerSlopes` keeps its faces, so they are what would be worked out again). */
function keptOff(face: SlopeFaceRun, kind: string, build: () => Polygon[]): Polygon[] {
  let byKind = keptMasks.get(face);
  if (!byKind) keptMasks.set(face, (byKind = new Map()));
  let value = byKind.get(kind);
  if (!value) byKind.set(kind, (value = build()));
  return value;
}
const keptMasks = new WeakMap<SlopeFaceRun, Map<string, Polygon[]>>();

/** A run's segments in stretches of one level (0 to FACE_RIM_STEPS - 1), as open polylines; a closed run's first and last stretch join. */
function stretchesByLevel(run: EdgeRun, lowLeft: boolean, levelOf: (n: Vec) => number): { level: number; line: Polygon }[] {
  const segs = lowSegments(run.points, run.closed, lowLeft);
  const out: { level: number; line: Polygon }[] = [];
  for (const { a, b, n } of segs) {
    const level = levelOf(n);
    const last = out[out.length - 1];
    if (last && last.level === level && last.line[last.line.length - 1] === a) last.line.push(b);
    else out.push({ level, line: [a, b] });
  }
  if (run.closed && out.length > 1 && out[0].level === out[out.length - 1].level) {
    const tail = out.pop()!;
    out[0].line = [...tail.line, ...out[0].line.slice(1)];
  }
  return out;
}

/** The rim line and the far side's highlight along one slope run. */
function drawRim(g: Graphics, run: EdgeRun, v: Vec): void {
  const lowLeft = run.drop > 0;
  const top = FACE_RIM_STEPS - 1;
  const facing = (n: Vec) => n[0] * v[0] + n[1] * v[1];
  for (const { level, line } of stretchesByLevel(run, lowLeft, (n) => Math.round(rimWeight(facing(n)) * top))) {
    const w = level / top;
    g.poly(line.flat(), false).stroke({
      color: FACE_INK,
      width: FACE_RIM_FAR_WIDTH + (FACE_RIM_WIDTH - FACE_RIM_FAR_WIDTH) * w,
      alpha: FACE_RIM_FAR_ALPHA + (FACE_RIM_ALPHA - FACE_RIM_FAR_ALPHA) * w,
      join: 'round',
      cap: 'round',
    });
  }
  for (const { level, line } of stretchesByLevel(run, lowLeft, (n) => Math.round(highlightWeight(facing(n)) * top))) {
    if (level === 0) continue;
    // Pushed up onto the top, its own width clear of the rim line.
    const lifted = offsetPath(line, false, !lowLeft, FACE_HIGHLIGHT_INSET + FACE_HIGHLIGHT_WIDTH / 2);
    g.poly(lifted.flat(), false).stroke({ color: FACE_HIGHLIGHT_COLOR, width: FACE_HIGHLIGHT_WIDTH, alpha: (FACE_HIGHLIGHT_ALPHA * level) / top, cap: 'round', join: 'round' });
  }
}

// ─── The shade below an edge ───────────────────────────────

/** How far the shade's blur fades an edge, cells: from 90 % to 10 % of its darkness. */
export const SHADE_FADE = 0.2;
/** How far past a band's outline the outside it shades on is looked for, beyond the deepest face, cells. */
const SHADE_REACH = 2;

/**
 * The rings of the side of `band` its edges drop to: outside it (`outward`) or, for the rim of a
 * pit or a dip, inside it; either way only where the surface stands lower than the band (each
 * band's `surface`), so a pit or a dip dug into a higher plateau keeps its own floor.
 */
function lowRegion(band: PlateauBand, bands: readonly PlateauBand[], outward: boolean, reach: number): Polygon[] {
  if (!outward) {
    const above = bands.filter((b) => b.height > band.height).flatMap((b) => b.surface);
    return above.length > 0 ? clipper2Engine.difference(band.rings, above) : band.rings;
  }
  const xs = band.rings.flatMap((r) => r.map((p) => p[0]));
  const ys = band.rings.flatMap((r) => r.map((p) => p[1]));
  const [x0, y0, x1, y1] = [Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach];
  const high = bands.filter((b) => b.height >= band.height).flatMap((b) => b.surface);
  return clipper2Engine.difference([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], high);
}

/** `ground` less `faces`, kept while both are the same rings (`layerSlopes` keeps them). */
function keptLow(ground: Polygon[], faces: Polygon[]): Polygon[] {
  const hit = keptLows.get(ground);
  if (hit && hit.faces.length === faces.length && hit.faces.every((f, i) => f === faces[i])) return hit.value;
  const value = clipper2Engine.difference(ground, faces);
  keptLows.set(ground, { faces, value });
  return value;
}
const keptLows = new WeakMap<Polygon[], { faces: Polygon[]; value: Polygon[] }>();

/**
 * The drop shade below `runs`: DROP_SHADE_ALPHA black at each run's line, easing out to nothing
 * at its `dropShadeWidth`, by the nearest run. Null for none.
 */
export function dropShadeField(runs: EdgeRun[]): RampField | null {
  const lines = runs.map((run) => ({ pts: run.closed ? [...run.points, run.points[0]] : run.points, closed: false }));
  const widths = runs.map((run) => dropShadeWidth(run.drop));
  const reach = Math.max(0, ...widths);
  const kept = keptRamp('drop-shade', [lines, widths], () => {
    const grid = rampGrid(lines.map((l) => l.pts), reach + 0.1);
    if (!grid) return null;
    const { d, owner } = distanceToLines(lines, grid, reach);
    return { field: fieldOf(grid, (_x, _y, k) => (owner[k] < 0 ? 0 : DROP_SHADE_ALPHA * fallOff(d[k], 0, widths[owner[k]]))), clip: null };
  });
  return kept?.field ?? null;
}

/**
 * The shade a band lays under its edges, per side it drops to (see {@link drawShade}): the mask it
 * is painted through and the drop shade's ramp, unblurred. None for a side with no edge or no ground.
 */
export function bandShades(band: PlateauBand, runs: LaidRun[], faces: SlopeFaceRun[], land: LandOf, over: Polygon[], fit: FloorFit | undefined): { outward: boolean; region: Polygon[]; field: RampField }[] {
  const out: { outward: boolean; region: Polygon[]; field: RampField }[] = [];
  for (const outward of [true, false]) {
    // A run dropping to a band below shades it from above; one rising to a band it merely meets
    // is that band's to shade, so only the rim of a pit or a dip (rising to the ground or to the
    // plateau it is dug into, `dug`) shades its own band.
    const mine = runs.filter(({ run: r }) => r.drop !== 0 && r.drop > 0 === outward && (r.drop > 0 || r.dug));
    if (mine.length === 0) continue;
    const onFaces = [...faces.filter((f) => f.run.drop > 0 === outward).flatMap((f) => f.region), ...over];
    const ground = land(band, outward);
    const low = onFaces.length > 0 ? keptLow(ground, onFaces) : ground;
    const region = fittedAlongWalls(low, mine, fit, outward);
    if (region.length === 0) continue;
    const field = dropShadeField(mine.flatMap(({ laid, cliffs }) => (cliffs ? cliffs.map((c) => c.top) : [laid])));
    if (field) out.push({ outward, region, field });
  }
  return out;
}

/**
 * The shade a band lays under its edges, per side it drops to: the drop shade along each
 * edge, blurred, then cut by a mask of that side and of the ground there is (`land`), less the
 * band's slope faces there and the faces of higher bands (`over`), so it is as dark at the edge
 * as the shade says, never spills up onto the band, never lands on void and stays off a face.
 * Along a cave wall it runs on the rock and its mask is fitted to it (`fittedAlongWalls`); a
 * ledge cliff's is drawn only along its stretches off the walls (`LaidRun.cliffs`).
 */
function drawShade(parent: Container, band: PlateauBand, runs: LaidRun[], faces: SlopeFaceRun[], land: LandOf, over: Polygon[], fit: FloorFit | undefined): void {
  for (const { region, field } of bandShades(band, runs, faces, land, over, fit)) {
    const g = new Container();
    g.label = 'plateau-drop-shade';
    paintRamp(g, { field, clip: null }, { color: 0x000000 });
    const blur = new BlurFilter({ strength: 1, quality: 3, kernelSize: 5 });
    blur.resolution = 1;
    const held = new Container();
    held.label = 'plateau-shade-soft';
    held.filters = [blur];
    held.addChild(g);
    const mask = new Graphics();
    mask.label = 'plateau-shade-mask';
    fillRings(mask, region, { color: 0xffffff });
    const clip = new Container();
    clip.label = 'plateau-shade';
    clip.addChild(held, mask);
    clip.mask = mask;
    // The blur is in screen pixels: kept at SHADE_FADE cells at whatever the zoom is.
    clip.onRender = () => {
      const m = held.worldTransform;
      blur.strength = blurStrengthFor(SHADE_FADE, Math.hypot(m.a, m.b) || 1);
    };
    parent.addChild(clip);
  }
}

/** Which placements `placeBand` will turn into sprites, in the order it adds them. */
function drawnPlacements(placed: WalkPlacement[], art: Map<string, CatalogEntry>): WalkPlacement[] {
  return placed.filter((pl) => {
    const entry = art.get(pl.piece.key);
    return !!entry && resolveTexture(entry.id).width > 1;
  });
}

// ─── Ledge ends ────────────────────────────────────────────

/** A piece whose end lies further than this from the chord of the one before it starts a new run, cells. */
const RUN_BREAK = 0.5;
/** Two pieces in a row turning more than this at their joint meet at a sharp tip, degrees. */
const TIP_TURN_DEG = 100;

/** A small random stream seeded from a point, so a redraw lays the same art. */
function rng(seed: Vec): () => number {
  let h = (Math.imul(Math.round(seed[0] * 100), 73856093) ^ Math.imul(Math.round(seed[1] * 100), 19349663)) >>> 0 || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

const vsub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const vadd = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const vmul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const vdist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Distance from `p` to the segment a–b. */
const segDist = (p: Vec, a: Vec, b: Vec): number => {
  const ab = vsub(b, a);
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return vdist(p, vadd(a, vmul(ab, t)));
};

/**
 * A laid piece's two joints in world units, and its direction of travel at each: its chord
 * turned back by half its turn at the first joint and on by half at the second, as an arc does.
 */
function jointFrame(pl: WalkPlacement): { joints: [Vec, Vec]; tangents: [Vec, Vec] } {
  const joints = jointsOf(pl.piece, pl.at);
  const a = Math.atan2(joints[1][1] - joints[0][1], joints[1][0] - joints[0][0]) - pieceSkew(pl.piece);
  const h = (pl.piece.turnDeg * Math.PI) / 360;
  return { joints, tangents: [[Math.cos(a - h), Math.sin(a - h)], [Math.cos(a + h), Math.sin(a + h)]] };
}

/**
 * The laid ledge split into runs where two pieces in a row do not meet (the end of an open
 * edge). A ring with no break is one closed run.
 */
export function ledgeRuns(placed: WalkPlacement[], closed: boolean): { run: WalkPlacement[]; open: boolean }[] {
  if (placed.length === 0) return [];
  const frames = new Map(placed.map((pl) => [pl, jointFrame(pl)]));
  const near = (p: Vec, pl: WalkPlacement): boolean => segDist(p, ...frames.get(pl)!.joints) <= RUN_BREAK;
  // Two pieces meet where either one's end lies on (or near) the other's chord: a straight
  // centred on a short side laps the bends either end by far more than its joint.
  // Two pieces turning sharper than any bend at their joint are the two runs a sharp tip is
  // laid as, crossing there (caveBandRenderer's layTipRun): each ends on its own end piece,
  // which carries the line on to the tip.
  const sharp = (a: WalkPlacement, b: WalkPlacement): boolean => {
    const ta = frames.get(a)!.tangents[1];
    const tb = frames.get(b)!.tangents[0];
    return ta[0] * tb[0] + ta[1] * tb[1] < Math.cos((TIP_TURN_DEG * Math.PI) / 180);
  };
  // The two sides' rock narrowed into a sharp tip's wedge (caveBandRenderer's wedgeTip) meets there, end to end: one run.
  const tip = (a: WalkPlacement, b: WalkPlacement): boolean => a.narrow?.[1] === 0 && b.narrow?.[0] === 0;
  const meets = (a: WalkPlacement, b: WalkPlacement): boolean => tip(a, b) || (!sharp(a, b) && (near(b.P, a) || near(a.Q, b)));
  const runs: WalkPlacement[][] = [[placed[0]]];
  for (let k = 1; k < placed.length; k++) {
    if (meets(placed[k - 1], placed[k])) runs[runs.length - 1].push(placed[k]);
    else runs.push([placed[k]]);
  }
  if (closed && meets(placed[placed.length - 1], placed[0])) {
    if (runs.length === 1) return [{ run: runs[0], open: false }];
    runs[0] = [...runs.pop()!, ...runs[0]];
  }
  return runs.map((run) => ({ run, open: true }));
}

const laidAt = (piece: CaveKitPiece, A: Vec, B: Vec, branch: string): WalkPlacement => ({
  piece,
  P: A,
  Q: B,
  i: 0,
  nudge: 0,
  branch,
  at: placeOnChord(piece, A, B),
});

/**
 * An open run's two tips: one end piece (picked per run) lapping each tip's last piece by the
 * kit's overlap and running on along the line's direction there. At the head it is mirrored
 * along its length, so it runs back off the line with the same side to the low side. Only at
 * the tips asked for (`head`, `tail`).
 */
function runEnds(run: WalkPlacement[], ends: CaveKitPiece[], head = true, tail = true): WalkPlacement[] {
  if (ends.length === 0) return [];
  const lap = kitOverlap(ends);
  const end = ends[Math.floor(rng(run[0].P)() * ends.length)];
  const c = end.chordCells;
  const first = jointFrame(run[0]);
  const last = jointFrame(run[run.length - 1]);
  const [x0, th] = [first.joints[0], first.tangents[0]];
  const [x1, tt] = [last.joints[1], last.tangents[1]];
  const a1 = vsub(x1, vmul(tt, lap));
  return [
    ...(head ? [laidAt(mirrorPiece(end), vsub(x0, vmul(th, c - lap)), vadd(x0, vmul(th, lap)), 'end')] : []),
    ...(tail ? [laidAt(end, a1, vadd(a1, vmul(tt, c)), 'end')] : []),
  ];
}

/** The low-side normal of a placement: the left of its chord. */
const lowNormal = (pl: WalkPlacement): Vec => {
  const dx = pl.Q[0] - pl.P[0];
  const dy = pl.Q[1] - pl.P[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
};

/**
 * A cliff's ledge laid by the cave walk along `run` with the low side as void: the whole run,
 * straights and corners alike, walked with the measured ledge pieces, every piece at its own
 * size, none stretched to fit an edge. One ring of it at any drop. `run` is a stretch of the
 * run's walk off the walls (`CliffRun.run`), never along its own saved line, so laying it
 * again lays the same rock. A tip that runs on into a wall's rock (`merged`, in `run`'s order,
 * `CliffRun.merged`) is laid as one; a tip at a flight of stairs (`opens`, `CliffRun.opens`) is laid
 * to its end with no painted ending. Nothing when its kit has no pieces.
 */
export function walkCliff(run: EdgeRun, merged: [boolean, boolean] = [false, false], opens: [boolean, boolean] = [false, false], joined?: [WalkPlacement | null, WalkPlacement | null]): WalkPlacement[] {
  const pieces = cliffPieces(cliffArt(run.owner?.edgeArt), run.owner?.edgeArt);
  if (pieces.length === 0) return [];
  const forward = walksForward(run);
  const pts = forward ? run.points : [...run.points].reverse();
  const way = <T>(pair: [T, T]): [T, T] => (forward ? pair : [pair[1], pair[0]]);
  if (run.closed) return layBandRing(pts, [], pieces, 1, true);
  if (!joined) return layBandChain(pts, [], pieces, 1, true, way(merged), way(opens));
  // An entrance's piece at a tip is handed to the walk as a turn, so the run's end piece laps it as
  // it laps its own neighbours (meetTurn): before the run its joint 1 is met, after it its joint 0.
  const [head, tail] = way(joined);
  const meet = (pl: WalkPlacement | null, joint: 0 | 1): WalkPlacement | null => pl && { ...pl, piece: { ...pl.piece, wallJoint: joint } };
  return ownPieces(layBandChain(pts, [], pieces, 1, true, way(merged), way(opens), [meet(head, 0), meet(tail, 1)]));
}

const ownPieceMemo = new WeakMap<WalkPlacement[], WalkPlacement[]>();

/** A walk with the entrance pieces it was handed taken back out: they are drawn on their own (`drawEntrances`). Kept per walk. */
function ownPieces(placed: WalkPlacement[]): WalkPlacement[] {
  let own = ownPieceMemo.get(placed);
  if (!own) ownPieceMemo.set(placed, (own = placed.filter((pl) => pl.branch !== 'entrance')));
  return own;
}

/**
 * Whether a cliff run is walked the way it is drawn. The walk lays rock with the void on its left;
 * band rings run with the outside on the left, which is the low side of a plateau, and a pit's low
 * side is inside, so a pit is walked backwards. A kit measured as cave walls faces its floor side
 * (its void is the rock mass behind the wall), so it is walked the other way: its face looks at the
 * low ground and its rock sits on the high side.
 */
export function walksForward(run: Pick<EdgeRun, 'drop' | 'owner'>): boolean {
  const facesFloor = kitFacesFloor(cliffPieces(cliffArt(run.owner?.edgeArt), run.owner?.edgeArt));
  return run.drop > 0 !== facesFloor;
}

/**
 * The ledge one stretch of a cliff draws: the pieces `placed` by its walk that have art, then an
 * end piece at each tip of an open run, but for a tip that runs on into a wall (`merged`) or stops
 * at a flight of stairs (`opens`).
 */
export function cliffLedge(stretch: CliffRun, placed: WalkPlacement[]): WalkPlacement[] {
  const { run } = stretch;
  const art = cliffArt(run.owner?.edgeArt);
  const walked = drawnPlacements(placed, art);
  const runs = ledgeRuns(walked, run.closed).filter((r) => r.open);
  const bare = bareTips(stretch);
  const capless: [boolean, boolean] = [stretch.merged[0] || bare[0], stretch.merged[1] || bare[1]];
  // A run walked backwards (see walksForward): its head is the stretch's tail.
  const [head, tail] = walksForward(run) ? capless : [capless[1], capless[0]];
  // A measured kit's painted endings are laid by its walk, inside the run (see layExactRun).
  const ends = isMeasuredBandSet(cliffChoice(run.owner?.edgeArt).setId) ? [] : ledgeEndPieces(art, run.owner?.edgeArt);
  const tips = runs.flatMap((r, k) => runEnds(r.run, ends, !(head && k === 0), !(tail && k === runs.length - 1)));
  return [...walked, ...drawnPlacements(tips, art)];
}

/**
 * The tips of a cliff's ledge as drawn (`cliffLedge`) that narrow to a point: each open run's
 * first and last joint where the kit lays no end piece, and a tip that butts a painted cave's
 * rock (`butts`) whatever the kit, so no square end stands against it. A tip that runs on under
 * a walled floor's rock (`merged`) stays square: that rock covers it.
 */
export function cliffFreeTips(stretch: CliffRun, drawn: WalkPlacement[]): ((end: Vec) => boolean) | undefined {
  const { run } = stretch;
  const measured = isMeasuredBandSet(cliffChoice(run.owner?.edgeArt).setId);
  const ends = !measured && ledgeEndPieces(cliffArt(run.owner?.edgeArt), run.owner?.edgeArt).length > 0;
  // The ledge's own pieces: the end pieces laid at its free tips come after them.
  const runs = ledgeRuns(
    drawn.filter((pl) => pl.branch !== 'end'),
    run.closed,
  ).filter((r) => r.open);
  const forward = walksForward(run);
  const walkWay = <T,>(pair: [T, T]): [T, T] => (forward ? pair : [pair[1], pair[0]]);
  const [head, tail] = walkWay(stretch.merged);
  const [buttHead, buttTail] = walkWay(stretch.butts);
  const [openHead, openTail] = walkWay(stretch.opens);
  const [joinHead, joinTail] = walkWay(stretch.joins ?? [false, false]);
  // A free tip narrows unless it ends on a painted ending (a measured kit's, laid by its walk); a
  // tip at a flight of stairs always does, and one at an entrance's piece never does.
  const narrows = (merged: boolean, butts: boolean, tip: WalkPlacement): boolean => (merged ? butts : !ends && tip.branch !== 'ending');
  const tips: Vec[] = runs.flatMap((r, k) => [
    ...(!(joinHead && k === 0) && ((openHead && k === 0) || narrows(head && k === 0, buttHead, r.run[0])) ? [jointFrame(r.run[0]).joints[0]] : []),
    ...(!(joinTail && k === runs.length - 1) && ((openTail && k === runs.length - 1) || narrows(tail && k === runs.length - 1, buttTail, r.run[r.run.length - 1])) ? [jointFrame(r.run[r.run.length - 1]).joints[1]] : []),
  ]);
  return tips.length > 0 ? (p) => tips.some((t) => vdist(p, t) < 1e-6) : undefined;
}

/**
 * One stretch of a cliff: the top-edge ink line along its `top` (on its rock line where it has
 * one), then its ledge (`cliffLedge`) from the pieces `placed` by its walk (`walkCliff`).
 */
function drawCliff(parent: Container, stretch: CliffRun, placed: WalkPlacement[]): CliffSprite[] {
  const run = stretch.top;
  // Drawn the way the walk goes, so a pit's backwards.
  const pts = run.drop > 0 ? run.points : [...run.points].reverse();
  const path = run.closed ? [...pts, pts[0]] : pts;

  if (run.owner?.contourLines !== false) {
    const top = new Graphics();
    top.label = 'plateau-top-line';
    top.poly(path.flat(), false).stroke({ color: INK, width: LINE, alpha: TOP_LINE_ALPHA });
    parent.addChild(top);
  }

  const art = cliffArt(run.owner?.edgeArt);
  // Pieces whose art has not landed take it in place when it does (placeBand).
  const sprites: CliffSprite[] = [];

  const rock = new Container();
  rock.label = 'plateau-cliff';
  const drawn = cliffLedge(stretch, placed);
  // A measured kit's pieces bend to meet at its joints and narrow at a free tip with no end
  // piece; its connectors go over the joints that bend too far for that, above the pieces.
  placeBand(rock, withConnectors(drawn, cliffPieces(art, run.owner?.edgeArt), 1, cliffFreeTips(stretch, drawn)), art, 0xffffff, 0);
  // Art that carries its own light and colour is not shaded: the sun would multiply it dark.
  if (!isColoredSet(cliffChoice(run.owner?.edgeArt).setId)) {
    drawn.forEach((pl, i) => sprites.push({ sprite: rock.children[i] as Sprite, normal: lowNormal(pl) }));
  }

  if (drawn.length === 0) {
    const ink = new Graphics();
    ink.label = 'plateau-cliff-ink';
    ink.poly(path.flat(), false).stroke({ color: INK, width: FALLBACK_EDGE, alpha: 0.85 });
    parent.addChild(ink);
    rock.destroy();
    return sprites;
  }
  parent.addChild(rock);
  return sprites;
}
