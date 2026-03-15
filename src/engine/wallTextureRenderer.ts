import { Sprite, Container, TilingSprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { DungeonStyle, WallSegment } from '@/store/types';
import type { Polygon } from '@/types/geometry';
import * as textureLoader from '@/assets/textureLoader';
import { getWallStripTexture, getWallPieces, type WallCategory } from '@/assets/textureManifest';

/**
 * Render a single wall segment as a TilingSprite rotated to follow the edge.
 *
 * With contentRect trimming, texture.height = content pixels (no padding).
 * tileScale = wallWidth / texture.height maps one texture repeat to wallWidth.
 * Uniform X/Y keeps stone/wood detail proportional at any width.
 */
function renderWallSegment(
  parent: Container,
  x1: number, y1: number,
  x2: number, y2: number,
  wallWidth: number,
  texture: Texture,
  tileScaleVal: number,
  tintColor: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return;

  const angle = Math.atan2(dy, dx);

  const ts = new TilingSprite({
    texture,
    width: length,
    height: wallWidth,
    tileScale: { x: tileScaleVal, y: tileScaleVal },
  });
  // Center the wall strip on the edge line
  ts.position.set(0, -wallWidth / 2);
  ts.tint = tintColor;

  const seg = new Container();
  seg.position.set(x1, y1);
  seg.rotation = angle;
  seg.addChild(ts);
  parent.addChild(seg);
}

/**
 * Render textured walls into the walls Container.
 * If no wallTextureSetId: renders nothing (invisible walls).
 */
export function renderTexturedWalls(
  wallsContainer: Container,
  polygons: Polygon[],
  standaloneWalls: WallSegment[],
  style: DungeonStyle,
): void {
  wallsContainer.removeChildren();

  if (!style.wallTextureSetId) return;

  const setId = style.wallTextureSetId as WallCategory;
  const stripEntry = getWallStripTexture(setId);
  if (!stripEntry) return;

  const stripTexture = textureLoader.getSync(stripEntry.id);
  if (!stripTexture || stripTexture.width === 0) return;

  const tintColor = parseInt(style.wallTextureTint.replace('#', ''), 16) || 0xffffff;
  const wallWidth = style.wallWidth;

  // tileScale: wallWidth / texture.height.
  // With contentRect applied, texture.height = content height (no padding).
  // One texture repeat fills exactly wallWidth world units.
  // Uniform X/Y keeps stone/wood detail proportional.
  const tileScaleVal = wallWidth / stripTexture.height;

  // ── Auto-walls: one segment per polygon edge ──
  for (const poly of polygons) {
    if (poly.length < 2) continue;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      renderWallSegment(wallsContainer, x1, y1, x2, y2, wallWidth, stripTexture, tileScaleVal, tintColor);
    }
  }

  // ── Standalone walls ──
  for (const wall of standaloneWalls) {
    if (wall.points.length < 2) continue;
    const w = wall.width || wallWidth;
    const standaloneTS = w / stripTexture.height;
    for (let i = 0; i < wall.points.length - 1; i++) {
      const [x1, y1] = wall.points[i];
      const [x2, y2] = wall.points[i + 1];
      renderWallSegment(wallsContainer, x1, y1, x2, y2, w, stripTexture, standaloneTS, tintColor);
    }
  }

  // ── Corner overlay sprites at polygon junctions ──
  // Pass stripTexture.height (content height after trim) as the reference arm width.
  // Corner pieces have the same arm thickness as the straight strip in the FA pack.
  renderCornerOverlays(wallsContainer, polygons, setId, style, tintColor, stripTexture.height);

  // ── Ending overlay sprites on standalone wall endpoints ──
  renderEndingOverlays(wallsContainer, standaloneWalls, setId, style, tintColor, stripTexture.height);
}

/**
 * Select the best corner piece for a given angle.
 * - Sharp corners (~90°): use 1x1 pieces (A/B/C — sharp L-shape)
 * - Obtuse/diagonal (>100°): use 2x2+ pieces (D/E — rounded) when available
 * - Very obtuse (>140°): use 3x3 pieces (F — large rounded) when available
 */
function selectCornerTexture(
  setId: WallCategory,
  _wallWidth: number,
  angleDeg: number,
): { tex: import('pixi.js').Texture; entry: import('@/assets/textureManifest').TextureEntry } | null {
  const pieces = getWallPieces(setId, 'corner');
  if (pieces.length === 0) return null;

  // Load all available corner textures
  const loaded: { entry: typeof pieces[0]; tex: import('pixi.js').Texture; gridSize: string }[] = [];
  for (const entry of pieces) {
    const tex = textureLoader.getSync(entry.id);
    if (tex && tex.width > 0) {
      loaded.push({ entry, tex, gridSize: entry.gridSize ?? '1x1' });
    }
  }
  if (loaded.length === 0) return null;

  // Select by angle:
  // Sharp corners (< 100°) → 1x1 pieces (sharp L-shape)
  // Medium angles (100°–140°) → 2x2 pieces (rounded) if available
  // Obtuse angles (> 140°) → 3x3 pieces (large rounded) if available
  let targetSize: string;
  if (angleDeg <= 100) {
    targetSize = '1x1';
  } else if (angleDeg <= 140) {
    targetSize = '2x2';
  } else {
    targetSize = '3x3';
  }

  // Find matching size, fall back to nearest available
  const exact = loaded.filter((p) => p.gridSize === targetSize);
  if (exact.length > 0) {
    return { tex: exact[0].tex, entry: exact[0].entry };
  }

  // Fallback: use first loaded (smallest / 1x1)
  return { tex: loaded[0].tex, entry: loaded[0].entry };
}

/**
 * Place corner sprites at polygon vertices where two edges meet at an angle.
 * Selects the corner variant based on the angle at each vertex:
 *   ~90° → 1x1 sharp L-shape
 *   ~135° → 2x2 rounded corner
 *   >140° → 3x3 large rounded corner
 */
function renderCornerOverlays(
  container: Container,
  polygons: Polygon[],
  setId: WallCategory,
  style: DungeonStyle,
  tintColor: number,
  stripContentHeight: number,
): void {
  const ANGLE_THRESHOLD_RAD = 30 * (Math.PI / 180);
  const spriteScale = style.wallWidth / stripContentHeight;

  for (const poly of polygons) {
    const n = poly.length;
    if (n < 3) continue;

    for (let i = 0; i < n; i++) {
      const prev = poly[(i - 1 + n) % n];
      const curr = poly[i];
      const next = poly[(i + 1) % n];

      const dx1 = prev[0] - curr[0];
      const dy1 = prev[1] - curr[1];
      const dx2 = next[0] - curr[0];
      const dy2 = next[1] - curr[1];

      const dot = dx1 * dx2 + dy1 * dy2;
      const cross = dx1 * dy2 - dy1 * dx2;
      const angle = Math.abs(Math.atan2(cross, dot));
      const angleDeg = angle * (180 / Math.PI);

      if (angle > ANGLE_THRESHOLD_RAD && angle < (Math.PI - ANGLE_THRESHOLD_RAD)) {
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);
        if (len1 < 0.001 || len2 < 0.001) continue;

        // Select corner piece based on this vertex's angle
        const selected = selectCornerTexture(setId, style.wallWidth, angleDeg);
        if (!selected) continue;

        const bisectX = dx1 / len1 + dx2 / len2;
        const bisectY = dy1 / len1 + dy2 / len2;
        const bisectAngle = Math.atan2(bisectY, bisectX);

        const sprite = new Sprite(selected.tex);
        sprite.anchor.set(0.5);
        sprite.position.set(curr[0], curr[1]);
        sprite.rotation = bisectAngle - Math.PI / 4;
        sprite.scale.set(spriteScale);
        sprite.tint = tintColor;
        container.addChild(sprite);
      }
    }
  }
}

/**
 * Place ending sprites at standalone wall endpoints.
 */
function renderEndingOverlays(
  container: Container,
  standaloneWalls: WallSegment[],
  setId: WallCategory,
  style: DungeonStyle,
  tintColor: number,
  stripContentHeight: number,
): void {
  const endingPieces = getWallPieces(setId, 'ending');
  if (endingPieces.length === 0) return;

  const endingEntry = endingPieces[0];
  const endingTex = textureLoader.getSync(endingEntry.id);
  if (!endingTex || endingTex.width === 0) return;

  for (const wall of standaloneWalls) {
    if (wall.points.length < 2) continue;
    const w = wall.width || style.wallWidth;
    const spriteScale = w / stripContentHeight;

    // First point
    const [x0, y0] = wall.points[0];
    const [x1, y1] = wall.points[1];
    const startSprite = new Sprite(endingTex);
    startSprite.anchor.set(0.5);
    startSprite.position.set(x0, y0);
    startSprite.rotation = Math.atan2(y0 - y1, x0 - x1);
    startSprite.scale.set(spriteScale);
    startSprite.tint = tintColor;
    container.addChild(startSprite);

    // Last point
    const last = wall.points.length - 1;
    const [xL, yL] = wall.points[last];
    const [xP, yP] = wall.points[last - 1];
    const endSprite = new Sprite(endingTex);
    endSprite.anchor.set(0.5);
    endSprite.position.set(xL, yL);
    endSprite.rotation = Math.atan2(yL - yP, xL - xP);
    endSprite.scale.set(spriteScale);
    endSprite.tint = tintColor;
    container.addChild(endSprite);
  }
}

/**
 * Preload all textures needed for wall rendering.
 */
export function preloadWallTextures(style: DungeonStyle): Promise<boolean> {
  if (!style.wallTextureSetId) return Promise.resolve(false);
  const setId = style.wallTextureSetId as WallCategory;

  const promises: Promise<unknown>[] = [];

  const strip = getWallStripTexture(setId);
  if (strip) promises.push(textureLoader.load(strip.id));

  // Preload ALL corner variants (selector picks best at render time)
  const corners = getWallPieces(setId, 'corner');
  for (const entry of corners) {
    promises.push(textureLoader.load(entry.id));
  }

  // Preload endings
  const endings = getWallPieces(setId, 'ending');
  for (const entry of endings) {
    promises.push(textureLoader.load(entry.id));
  }

  if (promises.length === 0) return Promise.resolve(false);
  return Promise.all(promises).then(() => true).catch(() => false);
}
