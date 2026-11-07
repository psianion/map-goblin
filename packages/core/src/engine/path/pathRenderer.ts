// Draws a layer's paths into its paths sublayer: each path's units laid along its line by
// shared/pathway's layPathUnits, one sprite a unit, at the unit's own size times the width,
// never stretched along the line. The PNG export renders the same sublayer.

import { Container, Sprite } from 'pixi.js';
import type { DungeonLayer, PathwayChild } from '../../store/types';
import { useStore } from '../../store/store';
import { getLayerEntry } from '../sceneGraph';
import { load, resolveTexture } from '../../assets/textureLoader';
import { pathPieceOf, unitSizeOf } from '../../assets/pathKit';
import { layPathUnits, pathwayLine } from '../../shared/pathway';

/** Layers waiting on a unit's art, and the art already asked for. */
const waiting = new Set<string>();
const asked = new Set<string>();

const pathsOf = (layer: DungeonLayer): PathwayChild[] =>
  layer.children.filter((c): c is PathwayChild => c.childType === 'pathway');

function awaitArt(layer: DungeonLayer, ids: string[]): void {
  const missing = ids.filter((id) => !asked.has(id));
  if (missing.length === 0 || waiting.has(layer.id)) return;
  waiting.add(layer.id);
  for (const id of missing) asked.add(id);
  void Promise.all(missing.map((id) => load(id))).then(() => {
    waiting.delete(layer.id);
    const now = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layer.id && l.type === 'dungeon');
    if (now) drawLayerPaths(now);
  });
}

/** One path's units, as sprites in a container of their own. */
function drawPath(path: PathwayChild, missing: string[]): Container | null {
  const entry = pathPieceOf(path.pieceId);
  if (!entry) return null;
  const tex = resolveTexture(entry.id);
  if (tex.width <= 1) {
    missing.push(entry.id);
    return null;
  }
  const unit = unitSizeOf(entry);
  const units = layPathUnits(pathwayLine(path), unit, path.width, path.transitionIn, path.transitionOut);
  const piece = new Container();
  piece.label = `path-${path.id}`;
  const cr = entry.contentRect;
  // World cells per texture pixel, either way: the art at its authored size, as the band's is.
  const perPxX = unit.length / tex.width;
  const perPxY = unit.width / tex.height;
  for (const u of units) {
    const s = new Sprite(tex);
    if (cr) s.anchor.set((entry.naturalWidth / 2 - cr.x) / cr.w, (entry.naturalHeight / 2 - cr.y) / cr.h);
    else s.anchor.set(0.5, 0.5);
    s.position.set(u.x, u.y);
    s.rotation = u.rotation;
    s.scale.set(perPxX * u.scaleAlong, perPxY * u.scaleAcross);
    s.alpha = u.alpha;
    piece.addChild(s);
  }
  return piece;
}

/** Draws a layer's paths, replacing what was drawn. */
export function drawLayerPaths(layer: DungeonLayer): void {
  const host = getLayerEntry(layer.id)?.sublayers?.paths;
  if (!host) return;
  for (const child of host.removeChildren()) child.destroy({ children: true });
  const missing: string[] = [];
  for (const path of pathsOf(layer)) {
    if (!path.visible) continue;
    const piece = drawPath(path, missing);
    if (piece) host.addChild(piece);
  }
  if (missing.length > 0) awaitArt(layer, [...new Set(missing)]);
}

/** What a layer's paths draw from, as a key: each path child's identity. */
export function pathsKey(layer: DungeonLayer): PathwayChild[] {
  return pathsOf(layer);
}
