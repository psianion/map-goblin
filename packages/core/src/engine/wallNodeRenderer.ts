// Node-based wall renderer — GitHub #19. Replaces the TilingSprite strip path.
//
// Geometry decisions live in wallLayout.ts (pure, unit-tested). This file only
// turns nodes into sprites: resolve the texture, anchor it, rotate it, scale it.

import { Sprite, Container } from 'pixi.js';
import type { DungeonStyle, WallSegment } from '../store/types';
import type { WallEdits } from '../shared/types';
import type { Polygon } from '../types/geometry';
import * as textureLoader from '../assets/textureLoader';
import { resolveTexture } from '../assets/textureLoader';
import {
  getWallPieces,
  type WallCategory,
  type TextureEntry,
} from '../assets/textureManifest';
import {
  layoutWall,
  applyWallEdits,
  nodeSpriteScale,
  type WallPieceSpec,
  type WallNode,
} from './wallLayout';

export interface DoorGap {
  wallId: string;
  position: [number, number];
  width: number;
}

/**
 * Band thickness of a set, in px — the straights' content height. Pieces that
 * carry no contentRect (corners, endings) are scaled against this so their arms
 * match the straights they join.
 */
function referenceBandPx(setId: WallCategory): number {
  const straights = getWallPieces(setId, 'straight');
  const longest = [...straights].sort(
    (a, b) => (b.contentRect?.w ?? b.naturalWidth) - (a.contentRect?.w ?? a.naturalWidth),
  )[0];
  return longest?.contentRect?.h ?? longest?.naturalHeight ?? 200;
}

function toSpec(entry: TextureEntry, role: WallPieceSpec['role'], bandPx: number): WallPieceSpec {
  // resolveTexture trims to contentRect when one exists, so a piece that has one
  // is measured by its own content. One that does not arrives as a full padded
  // tile and is scaled against the set's band instead.
  const cr = entry.contentRect;
  return {
    id: entry.id,
    role,
    lengthPx: cr?.w ?? entry.naturalWidth,
    thicknessPx: cr?.h ?? bandPx,
    authoredTurn: role === 'corner' ? Math.PI / 2 : undefined,
  };
}

/**
 * Every piece the layout engine may place, for one wall set.
 *
 * Deliberately excluded (see spec §3.3):
 * - `Corner_D/E/F` (2x2, 3x3) — inconsistent authoring origins inside their
 *   tiles, so they cannot be placed by tile centre. Manual swaps only.
 * - `Connector_DIAG` — a diagonal run, not a rock; wrong shape for a fan.
 * - `Joint_A/B` — cross and tee, for wall intersections, which this pass does
 *   not detect.
 * - `path` — the 8x1 seamless strip the old renderer tiled.
 */
export function buildPieceSpecs(setId: WallCategory): WallPieceSpec[] {
  const bandPx = referenceBandPx(setId);
  const specs: WallPieceSpec[] = [];

  for (const e of getWallPieces(setId, 'straight')) {
    specs.push(toSpec(e, 'straight', bandPx));
  }
  for (const e of getWallPieces(setId, 'connector')) {
    if (e.id.includes('diag')) continue;
    specs.push(toSpec(e, 'rock', bandPx));
  }
  for (const e of getWallPieces(setId, 'corner')) {
    if ((e.gridSize ?? '1x1') !== '1x1') continue;
    specs.push(toSpec(e, 'corner', bandPx));
  }
  for (const e of getWallPieces(setId, 'ending')) {
    specs.push(toSpec(e, 'ending', bandPx));
  }
  return specs;
}

/**
 * Stable per-wall seed so a wall re-renders identically across sessions.
 * Exported because the node overlay must reproduce the exact same layout the
 * renderer drew — a different seed would put the handles on different stones.
 */
export function seedForPoints(points: [number, number][]): number {
  let h = 0x811c9dc5;
  for (const [x, y] of points) {
    h ^= Math.round(x * 16) | 0; h = Math.imul(h, 0x01000193);
    h ^= Math.round(y * 16) | 0; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function placeNodes(
  parent: Container,
  nodes: WallNode[],
  specById: Map<string, WallPieceSpec>,
  wallWidth: number,
  tint: number,
): void {
  for (const node of nodes) {
    const spec = specById.get(node.pieceId);
    if (!spec) continue;
    const tex = resolveTexture(node.pieceId);
    if (tex.width === 0) continue;

    const sprite = new Sprite(tex);
    // 0.5 lands on the visible stone for straights and rocks: resolveTexture
    // hands those back already trimmed to contentRect, so the anchor is the
    // stone's own centre and a resize grows it evenly in every direction rather
    // than off one end. Corners and endings carry no contentRect and arrive as
    // full padded tiles, where 0.5 is the authored attachment point — the vertex
    // for an elbow, the wall end for a cap — which is the point they should grow
    // about anyway, so it stays correct for them too.
    sprite.anchor.set(0.5);
    sprite.position.set(node.x, node.y);
    sprite.rotation = node.angle;
    const [sx, sy] = nodeSpriteScale(node, spec, wallWidth);
    sprite.scale.set(sx, sy);
    sprite.tint = tint;
    parent.addChild(sprite);
  }
}

/** Drop nodes that fall inside a door opening. */
function withoutDoorGaps(nodes: WallNode[], gaps: DoorGap[]): WallNode[] {
  if (gaps.length === 0) return nodes;
  return nodes.filter((n) =>
    !gaps.some((g) => Math.hypot(n.x - g.position[0], n.y - g.position[1]) < g.width / 2),
  );
}

/**
 * Render walls as composed sprite nodes.
 * No wallTextureSetId means invisible walls, same as before.
 */
export function renderNodeWalls(
  wallsContainer: Container,
  polygons: Polygon[],
  standaloneWalls: WallSegment[],
  style: DungeonStyle,
  doorGaps: DoorGap[] = [],
  /** Hand edits for floor rings, keyed by ring index. */
  floorEdits: Record<string, WallEdits> = {},
): void {
  wallsContainer.removeChildren();
  if (!style.wallTextureSetId) return;

  const setId = style.wallTextureSetId as WallCategory;
  const specs = buildPieceSpecs(setId);
  if (specs.length === 0) return;

  const specById = new Map(specs.map((s) => [s.id, s]));
  const tint = parseInt(style.wallTextureTint.replace('#', ''), 16) || 0xffffff;
  const wallWidth = style.wallWidth;

  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (poly.length < 3) continue;
    const auto = layoutWall(poly, true, specs, { wallWidth, seed: seedForPoints(poly) });
    // A floor ring's stones are hand-editable too; its edits live on the layer
    // because the ring itself is recomputed from the shapes every time.
    const nodes = applyWallEdits(auto, floorEdits[String(i)]);
    placeNodes(wallsContainer, nodes, specById, wallWidth, tint);
  }

  for (const wall of standaloneWalls) {
    if (wall.points.length < 2) continue;
    const w = wall.width || wallWidth;
    const auto = layoutWall(wall.points, false, specs, {
      wallWidth: w,
      seed: seedForPoints(wall.points),
    });
    // Auto-layout first, then the DM's manual adjustments on top. Walls with no
    // edits — the common case — pass straight through.
    const nodes = applyWallEdits(auto, wall);
    const gaps = doorGaps.filter((g) => g.wallId === wall.id);
    placeNodes(wallsContainer, withoutDoorGaps(nodes, gaps), specById, w, tint);
  }
}

/** Preload every piece the layout engine can place. */
export function preloadWallTextures(style: DungeonStyle): Promise<boolean> {
  if (!style.wallTextureSetId) return Promise.resolve(false);
  const specs = buildPieceSpecs(style.wallTextureSetId as WallCategory);
  if (specs.length === 0) return Promise.resolve(false);
  return Promise.all(specs.map((s) => textureLoader.load(s.id)))
    .then(() => true)
    .catch(() => false);
}
