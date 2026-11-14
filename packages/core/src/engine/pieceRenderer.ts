// Draws one floor piece at its own place in the layer's stack: its fill, and round it the
// dressing that is paint only, so a piece drawn later simply covers it with no extra geometry.
//
// A piece is painted to its own region (its outer ring less its own holes), never to the
// layer's floor union: that is what lets the piece under a hole show through it. In order:
// a water piece's shore band outside its outline; the fill, crisp or with a natural soft edge
// and faded where a soft erase went (softPiece.ts; the dressing below keeps to the outline,
// fades or not); over water its bank shade, shallow line, waterline and falls; a floor's
// painted border (`edgePaint`); and a ground piece's rock rim (`ground` with `edgeMaterial`).
// Wall art is not drawn here: stone walls stand in the walls sublayer and a walled cave's
// rock in the materials sublayer, above every piece.

import { Container, Graphics, Texture } from 'pixi.js';
import type { DungeonLayer, DungeonStyle, PieceFade, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { bandSetArt } from '../assets/packCatalog';
import { isWaterMaterial } from '../assets/materialKit';
import { resolveTexture } from '../assets/textureLoader';
import { pieceRings } from '../shared/pieces';
import { borderWidthOf, wobbleSeed } from '../shared/plateauShade';
import { bandFillColor, drawOutlineBand } from './caveBandRenderer';
import { armLateTextureRebuild, fillPolygonsWithHoles, paintTiled, shapeFloorFill, type TiledLook } from './floorWallRenderer';
import { drawFalls, drawShore, drawWaterEdge, waterEdgeOf, type WaterEdge } from './material/materialRenderer';
import { innerBandLayers, paintSoftTiled } from './softEdge';
import { paintSoftPiece, softPieceReady } from './softPiece';
import { bakedFades } from '../shared/pieceFades';

/** What a layer's pieces are drawn against, worked out once a rebuild. */
export interface PieceCtx {
  layer: DungeonLayer;
  style: DungeonStyle;
  /** What a piece with no texture of its own paints with: its level's floor texture. */
  floorFallback: string | undefined;
  /** Every water piece's outline on the layer: a shore stops where water meets water. */
  water: Polygon[];
  /** A floor's paint-only overshoot (`DungeonStyle.floorBleed`), cells. */
  bleedOf(shape: ShapeChild): number;
  /** The walled floors' union was filled in one colour already: their own fills are skipped. */
  unionFilled: boolean;
  /** The ids of the pieces drawn with an edge mask, for `pruneSoftMasks`. */
  soft: Set<string>;
  /** A walled floor's painted border is drawn by the caller, over the walled extras: skipped here. */
  bordersOverExtras?: boolean;
}

function area(ring: Polygon): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return a / 2;
}

const outlines = new WeakMap<ShapeChild, Polygon[]>();

/**
 * A piece's region as rings wound the way Clipper winds them and the fills read them: its
 * outer ring positive, its holes negative. Kept per piece: immer hands out a new object
 * exactly when the piece changed.
 */
export function pieceOutline(shape: ShapeChild): Polygon[] {
  const hit = outlines.get(shape);
  if (hit) return hit;
  const [outer, ...holes] = pieceRings(shape);
  const out: Polygon[] = [];
  if (outer && outer.length >= 3) {
    out.push(area(outer) >= 0 ? outer : [...outer].reverse());
    for (const h of holes) if (h.length >= 3) out.push(area(h) < 0 ? h : [...h].reverse());
  }
  outlines.set(shape, out);
  return out;
}

const fadesOf = new WeakMap<ShapeChild, PieceFade[]>();

/** A piece's fades where its outline is drawn: its transform applied. Kept per piece, as its outline is. */
export function pieceFades(shape: ShapeChild): PieceFade[] {
  const hit = fadesOf.get(shape);
  if (hit) return hit;
  const out = bakedFades(shape) ?? [];
  fadesOf.set(shape, out);
  return out;
}

/** Whether a piece is water: filled with a floor texture tagged `water`. */
export function isWaterPiece(shape: Pick<ShapeChild, 'textureId'>): boolean {
  return !!shape.textureId && isWaterMaterial(shape.textureId);
}

/** The edge a water piece draws; null for any other piece. */
export function pieceWaterEdge(shape: ShapeChild): WaterEdge | null {
  if (!shape.textureId) return null;
  return waterEdgeOf({ material: shape.textureId, shore: shape.shore, shoreWidth: shape.shoreWidth, shallowLine: shape.shallowLine, height: shape.height });
}

/** How a piece's texture is laid: the floor's own scale, turn, offset, tint and opacity. */
function lookOf(shape: ShapeChild): TiledLook {
  const tint = shape.textureTint && shape.textureTint.toLowerCase() !== '#ffffff' ? parseInt(shape.textureTint.replace('#', ''), 16) : NaN;
  const alpha = Math.min(1, Math.max(0, shape.opacity ?? 1));
  return {
    scale: shape.textureScale || 1,
    rotation: shape.textureFillRotation,
    offsetX: shape.textureOffsetX ?? 0,
    offsetY: shape.textureOffsetY ?? 0,
    tint: Number.isNaN(tint) ? undefined : tint,
    alpha: alpha < 1 ? alpha : undefined,
  };
}

/** A texture the piece's dressing needs: itself when loaded, else null with a re-bake armed for when it lands. */
function artOf(layerId: string, id: string) {
  const tex = resolveTexture(id);
  if (tex.width > 1) return tex;
  armLateTextureRebuild(layerId, id);
  return null;
}

/** A floor's painted border: its texture in a band just inside its own outline, ragged and soft on its inner side. Paint only. */
export function drawPieceBorder(host: Container, layerId: string, shape: ShapeChild): void {
  const tex = artOf(layerId, shape.edgePaint!);
  if (!tex) return;
  const band = new Container();
  band.label = `floor-border-${shape.id}`;
  paintSoftTiled(band, innerBandLayers(pieceRings(shape), borderWidthOf(shape.edgePaintWidth), wobbleSeed(shape.id)), tex);
  host.addChild(band);
}

/** Draws `shape` into `host`, after what it holds. */
export function drawPiece(host: Container, shape: ShapeChild, ctx: PieceCtx): void {
  const outline = pieceOutline(shape);
  if (outline.length === 0) return;
  const { layer } = ctx;
  const piece = new Container();
  piece.label = `piece-${shape.id}`;

  // A patch from an older map that was painted on floors shows only where the floors are.
  if (shape.keptToFloors && layer.mergedFloor && layer.mergedFloor.length > 0) {
    const mask = new Graphics();
    fillPolygonsWithHoles(mask, layer.mergedFloor, { color: 0xffffff });
    piece.addChild(mask);
    piece.mask = mask;
  }

  const edge = pieceWaterEdge(shape);
  if (edge?.shore && resolveTexture(edge.shore.textureId).width <= 1) armLateTextureRebuild(layer.id, edge.shore.textureId);
  const shored = edge ? drawShore(piece, outline, edge, ctx.water) : false;

  if (!(ctx.unionFilled && !shape.ground)) {
    const fill = shapeFloorFill(shape, ctx.style, ctx.floorFallback);
    const bleed = ctx.bleedOf(shape);
    // A walled floor's edge is its wall's: softness is for ground.
    const soft = shape.ground ? Math.max(0, shape.soft ?? 0) : 0;
    const look = lookOf(shape);
    // Soft erases fade the fill through its mask, whatever the piece; with no GL they are not drawn.
    const fades = shape.fades && shape.fades.length > 0 && softPieceReady() ? pieceFades(shape) : [];
    const key = { layerId: layer.id, pieceId: shape.id, shape: [shape.contours, shape.tangents, shape.transform, shape.fades] };
    if (fill.kind === 'texture' && ((soft > 0 && !shored) || fades.length > 0)) {
      // Water with a shore stays crisp against it; anything else soft blends at its edge.
      if (paintSoftPiece(piece, key, outline, fill.texture, look, shored ? 0 : soft, fades)) ctx.soft.add(shape.id);
    } else if (fill.kind === 'solid' && fades.length > 0) {
      // A plain colour faded: the same mask over a white tile tinted the colour.
      if (fill.waitFor) armLateTextureRebuild(layer.id, fill.waitFor);
      if (paintSoftPiece(piece, key, outline, Texture.WHITE, { scale: 1, tint: fill.color, alpha: look.alpha }, 0, fades)) ctx.soft.add(shape.id);
    } else {
      // Grown by the bleed: a dropped ring would be a hole in the floor, so every ring Clipper hands back is drawn.
      const grown = bleed > 0 ? clipper2Engine.inflate(outline, bleed) : outline;
      const region = grown.length > 0 ? grown : outline;
      if (fill.kind === 'texture') {
        paintTiled(piece, region, fill.texture, { ...look, holes: true });
      } else {
        // Texture not loaded yet: re-bake when it lands.
        if (fill.waitFor) armLateTextureRebuild(layer.id, fill.waitFor);
        const g = new Graphics();
        fillPolygonsWithHoles(g, region, { color: fill.color });
        g.alpha = look.alpha ?? 1;
        piece.addChild(g);
      }
    }
  }

  if (edge) {
    drawWaterEdge(piece, outline, edge, shored);
    drawFalls(piece, layer, outline);
  }
  if (shape.edgePaint && !(ctx.bordersOverExtras && !shape.ground)) drawPieceBorder(piece, layer.id, shape);
  if (shape.ground && shape.edgeMaterial) {
    // The rock rim of a ground piece: the band walk a cave gets, with no wall behind it.
    for (const e of bandSetArt(shape.edgeMaterial).values()) artOf(layer.id, e.id);
    drawOutlineBand(piece, outline, shape.edgeMaterial, bandFillColor({ floorColor: ctx.style.floorColor, textureId: shape.textureId }));
  }
  host.addChild(piece);
}
