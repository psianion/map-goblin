// The base ground: what every square of the map's frame is covered by before anything is
// drawn on it. A floor texture tiled to the world like a floor's fill, or a plain colour,
// with the map's line grid over it (the frame is built map, and lines mean built map). Not a
// child of any layer, so nothing selects or erases it; the shown level's own ground wins
// over the map's. Redrawn only when what it is drawn from changes.

import { Container, Graphics, TilingSprite } from 'pixi.js';
import { useStore } from '../store/store';
import type { WorldBounds } from '../shared/mapBounds';
import { baseGroundOf } from '../shared/pieces';
import { shownLevelId } from '../store/selectors';
import { unitTexture } from '../assets/textureLoader';
import { deskSubdividesGrid, getEditorDesk } from './editorDesk';
import { gridDivision, gridLineSet, gridStrokes } from './imageGridRenderer';

/** Texture pixels per cell, as a floor's fill lays them. */
const PX_PER_GRID_CELL = 200;
/** The grid's ink over the ground. */
const GRID_INK = 0x000000;

let lastKey = '';

function parseColor(hex: string | undefined): number {
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : NaN;
  return Number.isNaN(n) ? 0xffffff : n;
}

/**
 * Draws the shown level's base ground over `frame` into `host`. Called every frame; it
 * returns at once unless the ground, the frame, the grid or the texture's arrival changed.
 */
export function syncMapGround(host: Container, frame: WorldBounds | null): void {
  const state = useStore.getState();
  const level = state.levels.find((l) => l.id === shownLevelId(state));
  const ground = frame ? baseGroundOf(state.mapSettings, level) : null;
  if (!ground || !frame) {
    if (lastKey !== '') {
      for (const child of host.removeChildren()) child.destroy({ children: true });
      lastKey = '';
    }
    return;
  }
  // unitTexture: a variant sheet fills with its one unit, in scale with a floor's fill.
  const texture = ground.textureId ? unitTexture(ground.textureId).texture : null;
  const textured = !!texture && texture.width > 1;
  const division = state.grid.visible ? (deskSubdividesGrid(getEditorDesk()) ? gridDivision(state.grid) : 1) : 0;
  const key = `${ground.textureId ?? ''}|${ground.color ?? ''}|${textured}|${frame.minX},${frame.minY},${frame.maxX},${frame.maxY}|${division}`;
  if (key === lastKey && host.children.length > 0) return;
  lastKey = key;
  for (const child of host.removeChildren()) child.destroy({ children: true });

  const width = frame.maxX - frame.minX;
  const height = frame.maxY - frame.minY;
  if (!(width > 0) || !(height > 0)) return;
  if (textured && texture) {
    const tileScale = 1 / PX_PER_GRID_CELL;
    const ts = new TilingSprite({ texture, width, height, tileScale: { x: tileScale, y: tileScale } });
    ts.position.set(frame.minX, frame.minY);
    // Anchored to the world origin, so a ground piece of the same texture tiles on with no seam.
    ts.tilePosition.set(-frame.minX / tileScale, -frame.minY / tileScale);
    ts.label = 'mapGround-fill';
    host.addChild(ts);
  } else {
    // A plain colour, and what a texture that has not loaded yet stands in with.
    const g = new Graphics();
    g.rect(frame.minX, frame.minY, width, height).fill({ color: parseColor(ground.color) });
    g.label = 'mapGround-fill';
    host.addChild(g);
  }
  if (division > 0) {
    const lines = gridLineSet(Math.ceil(frame.minX), Math.floor(frame.maxX), Math.ceil(frame.minY), Math.floor(frame.maxY), division);
    host.addChild(...gridStrokes(GRID_INK, lines));
  }
}
