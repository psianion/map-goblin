import { Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { DoorChild } from '../shared/types';
import type { ResolvedDoor } from '../shared/wallResolve';
import type { DungeonStyle } from '../store/types';
import { resolveTexture } from '../assets/textureLoader';
import { getAssetPackManager } from './assetPackInstance';

/**
 * Draw every resolved door. Position and angle come from the resolver — the
 * copies on the child are authored intent, and a door on a floor-ring edge has
 * no wall of its own to re-derive them from (H1 used to do that here, off the
 * hinted standalone wall only; the resolver now does it for both wall kinds,
 * per-segment rather than end-to-end, so this is the single source).
 */
export function renderDoors(
  container: Container,
  doors: ResolvedDoor[],
  style: DungeonStyle,
  _gridCellSize: number,
): void {
  // H3: Door graphics are cleaned up by rebuildDungeonLayer which clears the
  // entire walls sublayer before calling renderTexturedWalls + renderDoors.
  // Do NOT clear the container here — it contains wall texture sprites too.

  for (const resolved of doors) {
    renderResolvedDoor(container, resolved, style);
  }
}

/**
 * One door's art into `container`. Split out of `renderDoors` so the door tool's
 * placement ghost draws through the same path a committed door does — a preview
 * that reimplemented the glyph dispatch would drift from it on the first style
 * that changed. Callers wanting a ghost tint or fade set them on the container
 * they pass, not here.
 */
export function renderResolvedDoor(
  container: Container,
  resolved: ResolvedDoor,
  style: DungeonStyle,
): void {
  const { door, position, angle: wallAngle } = resolved;
  if (!door.visible) return;

  // Fresh Graphics per door to avoid PixiJS v8 path accumulation
  const g = new Graphics();

  const cx = position[0];
  const cy = position[1];
  const halfWidth = door.width / 2;

  if (resolved.detached) {
    renderDetachedMarker(g, cx, cy, wallAngle, halfWidth);
    container.addChild(g);
    return;
  }

  // Door art carries its own state: closed art and open art are different
  // drawings. Locked used to be painted on top in red and every door wore a
  // coloured status dot, which meant the map was scattered with editor
  // symbology that no player-facing view wants. Locked and secret now read from
  // the selection's properties panel instead of from the art.
  const wallColor = parseInt(style.wallColor.replace('#', ''), 16);

  // A portal carries its own authored texture, so it never consults the door
  // pack. Every other style tries the pack first and falls back to its glyph.
  if (door.style === 'portal' && door.portalTextureId) {
    renderPortalSprite(container, door, position, wallAngle);
    g.destroy();
    return;
  }

  // The band the door has to sit in. A standalone wall may carry its own width;
  // a floor-ring edge has none of its own, so the style's is the wall's. Same
  // rule `renderNodeWalls` uses to scale the stones, so the door is thick enough
  // to fill the hole they left.
  const wallWidth = resolved.wall?.width || style.wallWidth;

  const drewSprite = renderDoorSprite(container, door, position, wallAngle, wallWidth);
  if (!drewSprite) {
    if (door.style === 'archway') {
      renderArchway(g, cx, cy, wallAngle, halfWidth, wallColor);
    } else if (door.style === 'portcullis') {
      renderPortcullis(g, cx, cy, wallAngle, halfWidth, wallColor, door.state);
    } else if (door.style === 'double') {
      renderDoubleDoor(g, cx, cy, wallAngle, halfWidth, wallColor, door.state);
    } else {
      renderSingleDoor(g, cx, cy, wallAngle, halfWidth, wallColor, door.state, door.isSecret);
    }
  }

  if (drewSprite) {
    g.destroy();
  } else {
    container.addChild(g);
  }
}

/**
 * Pack that door sprites are looked up in. The full set of entry IDs a pack
 * must provide to replace the glyphs — this list is the contract, nothing else
 * is consulted:
 *
 *   door-single-closed     door-single-open
 *   door-double-closed     door-double-open
 *   door-portcullis-closed door-portcullis-open
 *   door-archway-open
 *
 * No `door-archway-closed`: an archway is a permanent opening (occlusion always
 * treats it as passable), so a closed archway — which the store does allow —
 * still renders as the open art. Locked needs no art: it is not drawn at all,
 * it reads from the properties panel. Secret reuses whatever its state maps to
 * at 0.35 alpha. Portals are excluded; they carry an authored `portalTextureId`
 * instead.
 *
 * No installed pack ships these yet, so `getTextureOrNull` returns null and
 * every door falls back to the Graphics glyphs below. Dropping the entries into
 * a pack manifest is the whole switch-over — nothing else here changes.
 * (`getTextureOrNull`, not `resolveTexture`: a miss must be a quiet null, not a
 * magenta placeholder plastered over the map.)
 */
const DOOR_SPRITE_PACK = 'dungeon-classic';

/** Where an entry's paint actually is, and which way round it was drawn. */
export interface DoorSpriteMeta {
  /** Opaque content rect, as fractions of the texture's own canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Extra rotation that puts the content's long axis along the wall. */
  rotate?: number;
}

/**
 * The opaque content of each door entry.
 *
 * Door art is authored on a padded grid cell — a single door is 49px of paint in
 * a 200px square — so measuring the sprite by its texture is measuring mostly
 * nothing. Fitting the *canvas* to the door's width is what made a default-width
 * door render as a hairline: the paint was a fifth of what was being scaled.
 *
 * Fractions, not pixels, so the table still holds if a pack ships the same art
 * at a different resolution. It lives here rather than in the manifest because
 * the pack's `ManifestEntry` has no content-rect field to put it in.
 *
 * An entry with no row here is used whole, which is right for art that was
 * authored tight and is no worse than the alternative for art that was not.
 */
const SPRITE_META: Record<string, DoorSpriteMeta> = {
  // 200x200 canvas, 200x49 of paint at (0,76).
  'door-single-closed': { x: 0, y: 0.38, w: 1, h: 0.245 },
  // 400x200, 281x81 at (60,59).
  'door-single-open': { x: 0.15, y: 0.295, w: 0.7025, h: 0.405 },
  // 400x200, 400x54 at (0,73).
  'door-double-closed': { x: 0, y: 0.365, w: 1, h: 0.27 },
  // 600x200, 481x81 at (60,59).
  'door-double-open': { x: 0.1, y: 0.295, w: 481 / 600, h: 0.405 },
  // 400x200, 400x54 at (0,73).
  'door-portcullis-closed': { x: 0, y: 0.365, w: 1, h: 0.27 },
  // 200x400, 27x212 at (87,94). Authored as an upright 1x2 arch, so its paint is
  // a vertical sliver — quarter-turned here so the 212px side runs along the wall.
  'door-archway-open': { x: 0.435, y: 0.235, w: 0.135, h: 0.53, rotate: Math.PI / 2 },
};

const WHOLE_CANVAS: DoorSpriteMeta = { x: 0, y: 0, w: 1, h: 1 };

export interface DoorSpriteFit {
  /** Sub-frame of the texture canvas holding the paint, in px. */
  frame: { x: number; y: number; w: number; h: number };
  scaleX: number;
  scaleY: number;
  rotate: number;
}

/**
 * Trimmed frame and per-axis scale for one door sprite. Pure, so the two rules
 * that were wrong are checkable without a GPU:
 *
 * - along the wall the sprite spans exactly `doorWidth`, measured on the paint
 *   rather than on the canvas it was authored in;
 * - across the wall it is never thinner than the wall it plugs. A uniform scale
 *   tied thickness to width, so narrowing a door thinned it toward nothing;
 *   here width and thickness are independent and thickness has a floor. It may
 *   still come out thicker, when the art's own proportions at that length ask
 *   for it — a wide door is allowed to look like a wide door.
 */
export function doorSpriteFit(
  entryId: string,
  texW: number,
  texH: number,
  doorWidth: number,
  wallWidth: number,
): DoorSpriteFit {
  const meta = SPRITE_META[entryId] ?? WHOLE_CANVAS;
  const frame = { x: meta.x * texW, y: meta.y * texH, w: meta.w * texW, h: meta.h * texH };
  const rotate = meta.rotate ?? 0;
  // Only the quarter turn in the table exists, and it swaps the axes.
  const turned = rotate !== 0;
  const alongPx = turned ? frame.h : frame.w;
  const acrossPx = turned ? frame.w : frame.h;
  const along = alongPx > 0 ? doorWidth / alongPx : 0;
  const across = acrossPx > 0 ? Math.max(wallWidth / acrossPx, along) : along;
  return {
    frame,
    scaleX: turned ? across : along,
    scaleY: turned ? along : across,
    rotate,
  };
}

/**
 * Trimmed views of the pack's door textures, keyed by full entry id — same
 * lifetime and same swap-on-pack-reinstall caveat as `textureLoader`'s.
 */
const trimmedCache = new Map<string, Texture>();

function trimmed(entryId: string, tex: Texture, frame: DoorSpriteFit['frame']): Texture {
  const cached = trimmedCache.get(entryId);
  if (cached) return cached;
  // Offset by the texture's own frame: an entry packed into an atlas is already
  // a window onto a larger source, and the content rect is relative to that
  // window, not to the atlas.
  const base = tex.frame ?? { x: 0, y: 0 };
  const sub = new Texture({
    source: tex.source,
    frame: new Rectangle(base.x + frame.x, base.y + frame.y, frame.w, frame.h),
  });
  trimmedCache.set(entryId, sub);
  return sub;
}

function renderDoorSprite(
  container: Container,
  door: DoorChild,
  position: [number, number],
  wallAngle: number,
  wallWidth: number,
): boolean {
  const spriteState =
    door.style === 'archway' || door.state === 'open' ? 'open' : 'closed';
  const entryId = `${DOOR_SPRITE_PACK}:door-${door.style}-${spriteState}`;
  const tex = getAssetPackManager().getTextureOrNull(entryId);
  if (!tex || tex.width <= 1) return false;

  const fit = doorSpriteFit(
    `door-${door.style}-${spriteState}`, tex.width, tex.height, door.width, wallWidth,
  );

  const sprite = new Sprite(trimmed(entryId, tex, fit.frame));
  sprite.anchor.set(0.5);
  sprite.position.set(position[0], position[1]);
  sprite.rotation = wallAngle + fit.rotate;
  sprite.scale.set(fit.scaleX, fit.scaleY);
  // Secret art stays faded — that is fog semantics, not a status glyph.
  sprite.alpha = door.isSecret ? 0.35 : 1;
  container.addChild(sprite);
  return true;
}

// Stroke width proportional to wall — thin enough to read as a symbol, not a filled shape.
// 1 world unit = 1 grid cell. Typical wallWidth = 0.4–0.5. Door glyphs use ~15% of that.
const GLYPH_STROKE = 0.06;

// L1: Fixed glyph color for open-state arcs — avoids near-black on light floors
const OPEN_ARC_COLOR = 0x555555;

function renderSingleDoor(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, color: number, state: string, isSecret: boolean,
): void {
  if (isSecret && state === 'closed') {
    // Dashed line matching wall (blends in) — just a faint line
    g.moveTo(cx - Math.cos(angle) * halfWidth, cy - Math.sin(angle) * halfWidth);
    g.lineTo(cx + Math.cos(angle) * halfWidth, cy + Math.sin(angle) * halfWidth);
    g.stroke({ color, width: GLYPH_STROKE, alpha: 0.4 });
    return;
  }

  if (state === 'open') {
    // L4: Quarter-circle (90°) arc showing door swing — pivot at hinge end
    const pivotX = cx - Math.cos(angle) * halfWidth;
    const pivotY = cy - Math.sin(angle) * halfWidth;
    const arcRadius = halfWidth * 2;
    const perpAngle = angle + Math.PI / 2;
    const startX = pivotX + Math.cos(perpAngle) * arcRadius;
    const startY = pivotY + Math.sin(perpAngle) * arcRadius;
    g.moveTo(startX, startY);
    // L4: Full 90° arc (Math.PI/2) instead of 45° (Math.PI/4)
    g.arc(pivotX, pivotY, arcRadius, perpAngle, perpAngle - Math.PI / 2, true);
    // L1: Use fixed glyph color, not potentially-dark wallColor
    g.stroke({ color: OPEN_ARC_COLOR, width: GLYPH_STROKE, alpha: 0.7 });
  } else {
    // Closed: thin rectangle flush with wall. Floored so a width-1 door does
    // not anti-alias into invisibility at editor zoom, leaving only the state
    // dot to read as "a purple circle on the wall".
    const perpAngle = angle + Math.PI / 2;
    const thickness = Math.max(halfWidth * 0.12, 0.09);
    const x1 = cx - Math.cos(angle) * halfWidth;
    const y1 = cy - Math.sin(angle) * halfWidth;
    const x2 = cx + Math.cos(angle) * halfWidth;
    const y2 = cy + Math.sin(angle) * halfWidth;
    // Draw a thin filled rectangle along the wall
    g.moveTo(x1 - Math.cos(perpAngle) * thickness, y1 - Math.sin(perpAngle) * thickness);
    g.lineTo(x2 - Math.cos(perpAngle) * thickness, y2 - Math.sin(perpAngle) * thickness);
    g.lineTo(x2 + Math.cos(perpAngle) * thickness, y2 + Math.sin(perpAngle) * thickness);
    g.lineTo(x1 + Math.cos(perpAngle) * thickness, y1 + Math.sin(perpAngle) * thickness);
    g.closePath();
    g.fill({ color, alpha: 0.8 });
  }
}

// Detached marker: a door whose wall or floor was deleted out from under it.
// Grey reads as "inert", but grey alone would be one more state colour, so the
// shape carries the meaning: the bar is broken in the middle and ringed. That
// silhouette matches no other door glyph (solid bar, arc, two bars, faint line,
// two caps, portcullis bars), so it survives greyscale and low zoom.
const DETACHED_COLOR = 0x8a8a8a;

function renderDetachedMarker(
  g: Graphics, cx: number, cy: number, angle: number, halfWidth: number,
): void {
  // Two stubs along the door axis with a gap where the wall should have been.
  const stub = halfWidth * 0.45;
  for (const sign of [-1, 1]) {
    const ex = cx + Math.cos(angle) * halfWidth * sign;
    const ey = cy + Math.sin(angle) * halfWidth * sign;
    g.moveTo(ex, ey);
    g.lineTo(ex - Math.cos(angle) * stub * sign, ey - Math.sin(angle) * stub * sign);
  }
  g.stroke({ color: DETACHED_COLOR, width: GLYPH_STROKE, alpha: 0.9 });
  // Hollow ring in the gap — the badge, not a filled state dot.
  g.circle(cx, cy, halfWidth * 0.3);
  g.stroke({ color: DETACHED_COLOR, width: GLYPH_STROKE * 0.8, alpha: 0.9 });
}

function renderDoubleDoor(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, color: number, state: string,
): void {
  if (state === 'open') {
    // Two mirrored quarter-circle arcs
    const perpAngle = angle + Math.PI / 2;
    // Left leaf — hinge at left end, swings perpendicular
    const lPivotX = cx - Math.cos(angle) * halfWidth;
    const lPivotY = cy - Math.sin(angle) * halfWidth;
    const lStartX = lPivotX + Math.cos(perpAngle) * halfWidth;
    const lStartY = lPivotY + Math.sin(perpAngle) * halfWidth;
    g.moveTo(lStartX, lStartY);
    g.arc(lPivotX, lPivotY, halfWidth, perpAngle, angle, true);
    // L1: Use fixed glyph color for open arcs
    g.stroke({ color: OPEN_ARC_COLOR, width: GLYPH_STROKE, alpha: 0.7 });
    // Right leaf — hinge at right end, swings opposite
    const rPivotX = cx + Math.cos(angle) * halfWidth;
    const rPivotY = cy + Math.sin(angle) * halfWidth;
    const rEndAngle = perpAngle + Math.PI;
    const rStartX = rPivotX + Math.cos(rEndAngle) * halfWidth;
    const rStartY = rPivotY + Math.sin(rEndAngle) * halfWidth;
    g.moveTo(rStartX, rStartY);
    g.arc(rPivotX, rPivotY, halfWidth, rEndAngle, angle + Math.PI, true);
    // L1: Use fixed glyph color for open arcs
    g.stroke({ color: OPEN_ARC_COLOR, width: GLYPH_STROKE, alpha: 0.7 });
  } else {
    // Two thin rectangles side by side, thickness floored like the single door
    const perpAngle = angle + Math.PI / 2;
    const thickness = Math.max(halfWidth * 0.12, 0.09);
    // M5: Increase gap so two door leaves are visually distinct (was 0.05, now 0.15)
    const gap = halfWidth * 0.15;
    for (const sign of [-1, 1]) {
      const startX = cx + (sign < 0 ? -Math.cos(angle) * halfWidth : Math.cos(angle) * gap);
      const startY = cy + (sign < 0 ? -Math.sin(angle) * halfWidth : Math.sin(angle) * gap);
      const endX = cx + (sign < 0 ? -Math.cos(angle) * gap : Math.cos(angle) * halfWidth);
      const endY = cy + (sign < 0 ? -Math.sin(angle) * gap : Math.sin(angle) * halfWidth);
      g.moveTo(startX - Math.cos(perpAngle) * thickness, startY - Math.sin(perpAngle) * thickness);
      g.lineTo(endX - Math.cos(perpAngle) * thickness, endY - Math.sin(perpAngle) * thickness);
      g.lineTo(endX + Math.cos(perpAngle) * thickness, endY + Math.sin(perpAngle) * thickness);
      g.lineTo(startX + Math.cos(perpAngle) * thickness, startY + Math.sin(perpAngle) * thickness);
      g.closePath();
      g.fill({ color, alpha: 0.8 });
    }
  }
}

function renderPortcullis(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, _color: number, state: string,
): void {
  const barCount = 5;
  const perpAngle = angle + Math.PI / 2;
  // M2: Increase bar length from 0.35 to 0.5 for better visibility
  const barLength = halfWidth * 0.5;
  // L5: Open-state shift uses perpendicular which doesn't mean "up" on diagonals.
  // This is acceptable for V1 — a proper fix would require screen-space "up" direction.
  const yShift = state === 'open' ? -halfWidth * 0.4 : 0;
  for (let i = 0; i < barCount; i++) {
    const t = (i / (barCount - 1)) * 2 - 1; // -1 to +1
    const bx = cx + Math.cos(angle) * halfWidth * t;
    const by = cy + Math.sin(angle) * halfWidth * t;
    g.moveTo(
      bx + Math.cos(perpAngle) * barLength + Math.cos(perpAngle) * yShift,
      by + Math.sin(perpAngle) * barLength + Math.sin(perpAngle) * yShift,
    );
    g.lineTo(
      bx - Math.cos(perpAngle) * barLength + Math.cos(perpAngle) * yShift,
      by - Math.sin(perpAngle) * barLength + Math.sin(perpAngle) * yShift,
    );
  }
  g.stroke({ color: 0x666666, width: GLYPH_STROKE * 0.8 });
  // Horizontal crossbar
  const crossY = yShift;
  g.moveTo(
    cx - Math.cos(angle) * halfWidth + Math.cos(perpAngle) * crossY,
    cy - Math.sin(angle) * halfWidth + Math.sin(perpAngle) * crossY,
  );
  g.lineTo(
    cx + Math.cos(angle) * halfWidth + Math.cos(perpAngle) * crossY,
    cy + Math.sin(angle) * halfWidth + Math.sin(perpAngle) * crossY,
  );
  g.stroke({ color: 0x666666, width: GLYPH_STROKE * 0.6 });
}

function renderArchway(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, color: number,
): void {
  const perpAngle = angle + Math.PI / 2;
  // M6: Increase cap size from 0.25 to 0.35 for visibility at low zoom
  const capSize = halfWidth * 0.35;
  for (const sign of [-1, 1]) {
    const ex = cx + Math.cos(angle) * halfWidth * sign;
    const ey = cy + Math.sin(angle) * halfWidth * sign;
    g.moveTo(ex - Math.cos(perpAngle) * capSize, ey - Math.sin(perpAngle) * capSize);
    g.lineTo(ex + Math.cos(perpAngle) * capSize, ey + Math.sin(perpAngle) * capSize);
  }
  g.stroke({ color, width: GLYPH_STROKE * 1.2 });
}

/**
 * Render a portal door as a sprite from a pack texture.
 * Portal sprites are positioned at the door location and rotated to match the wall angle.
 * Supports open/closed state via alpha (open = semi-transparent).
 */
function renderPortalSprite(
  container: Container,
  door: DoorChild,
  position: [number, number],
  wallAngle: number,
): void {
  if (!door.portalTextureId) return;

  const tex = resolveTexture(door.portalTextureId);
  if (tex.width === 0) return;

  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.position.set(position[0], position[1]);
  sprite.rotation = wallAngle;

  // Scale sprite to match door width
  const scale = door.width / tex.width;
  sprite.scale.set(scale);

  // Open portals are semi-transparent
  sprite.alpha = door.state === 'open' ? 0.5 : 1.0;

  container.addChild(sprite);
}
