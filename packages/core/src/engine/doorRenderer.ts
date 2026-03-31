import { Graphics, Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { DoorChild, WallSegment } from '../shared/types';
import type { DungeonStyle } from '../store/types';
import { resolveTexture } from '../assets/textureLoader';

// State color coding (editor overlay)
// L3: Brighter colors for secret states — dark magenta was hard to see
const STATE_COLORS: Record<string, number> = {
  closed: 0x9b59b6,        // purple
  open: 0x2ecc71,          // green
  locked: 0xe74c3c,        // red
  secret_closed: 0xc77dba, // bright magenta (L3)
  secret_open: 0x5dde8f,   // bright green (L3)
};

function getStateColor(door: DoorChild): number {
  const key = door.isSecret ? `secret_${door.state}` : door.state;
  return STATE_COLORS[key] ?? STATE_COLORS.closed;
}

// M7: Guard for zero-length wall segments
function segmentLength(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function renderDoors(
  container: Container,
  doors: DoorChild[],
  walls: WallSegment[],
  style: DungeonStyle,
  _gridCellSize: number,
): void {
  // H3: Door graphics are cleaned up by rebuildDungeonLayer which clears the
  // entire walls sublayer before calling renderTexturedWalls + renderDoors.
  // Do NOT clear the container here — it contains wall texture sprites too.

  const wallMap = new Map(walls.map((w) => [w.id, w]));

  for (const door of doors) {
    if (!door.visible) continue;
    const wall = wallMap.get(door.wallId);
    if (!wall) continue;

    // H1: Always derive angle from wall geometry, never trust door.angle
    const start = wall.points[0] as [number, number];
    const end = wall.points[wall.points.length - 1] as [number, number];

    // M7: Skip zero-length walls — atan2(0,0) produces garbage
    if (segmentLength(start, end) < 0.01) continue;

    const wallAngle = Math.atan2(end[1] - start[1], end[0] - start[0]);

    // Fresh Graphics per door to avoid PixiJS v8 path accumulation
    const g = new Graphics();

    const cx = door.position[0];
    const cy = door.position[1];
    const halfWidth = door.width / 2;
    const wallColor = parseInt(style.wallColor.replace('#', ''), 16);

    if (door.style === 'portal' && door.portalTextureId) {
      renderPortalSprite(container, door, wallAngle);
      continue;
    } else if (door.style === 'archway') {
      renderArchway(g, cx, cy, wallAngle, halfWidth, wallColor);
    } else if (door.style === 'portcullis') {
      renderPortcullis(g, cx, cy, wallAngle, halfWidth, wallColor, door.state);
    } else if (door.style === 'double') {
      renderDoubleDoor(g, cx, cy, wallAngle, halfWidth, wallColor, door.state);
    } else {
      renderSingleDoor(g, cx, cy, wallAngle, halfWidth, wallColor, door.state, door.isSecret);
    }

    container.addChild(g);

    // C2: Skip state dot for secret doors that are closed — invisibility is the point
    // M3: Skip state dot for archways — they are permanent openings, "closed" is meaningless
    if ((door.isSecret && door.state === 'closed') || door.style === 'archway') {
      continue;
    }

    // State indicator dot (separate Graphics to avoid path contamination)
    const dot = new Graphics();
    const stateColor = getStateColor(door);
    dot.circle(cx, cy, 0.1); // 0.1 world units — subtle but scannable
    dot.fill({ color: stateColor });
    container.addChild(dot);
  }
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
    // Closed: thin rectangle flush with wall
    const perpAngle = angle + Math.PI / 2;
    const thickness = halfWidth * 0.12;
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
    // Two thin rectangles side by side
    const perpAngle = angle + Math.PI / 2;
    const thickness = halfWidth * 0.12;
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
  wallAngle: number,
): void {
  if (!door.portalTextureId) return;

  const tex = resolveTexture(door.portalTextureId);
  if (tex.width === 0) return;

  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.position.set(door.position[0], door.position[1]);
  sprite.rotation = wallAngle;

  // Scale sprite to match door width
  const scale = door.width / tex.width;
  sprite.scale.set(scale);

  // Open portals are semi-transparent
  sprite.alpha = door.state === 'open' ? 0.5 : 1.0;

  container.addChild(sprite);
}
