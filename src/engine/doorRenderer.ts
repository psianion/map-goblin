import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { DoorChild, WallSegment } from '@/shared/types';
import type { DungeonStyle } from '@/store/types';

// State color coding (editor overlay)
const STATE_COLORS: Record<string, number> = {
  closed: 0x9b59b6,        // purple
  open: 0x2ecc71,          // green
  locked: 0xe74c3c,        // red
  secret_closed: 0x8e44ad, // dark magenta
  secret_open: 0x27ae60,   // dark green
};

function getStateColor(door: DoorChild): number {
  const key = door.isSecret ? `secret_${door.state}` : door.state;
  return STATE_COLORS[key] ?? STATE_COLORS.closed;
}

export function renderDoors(
  container: Container,
  doors: DoorChild[],
  walls: WallSegment[],
  style: DungeonStyle,
  _gridCellSize: number,
): void {
  const wallMap = new Map(walls.map((w) => [w.id, w]));

  for (const door of doors) {
    if (!door.visible) continue;
    const wall = wallMap.get(door.wallId);
    if (!wall) continue;

    // Fresh Graphics per door to avoid PixiJS v8 path accumulation
    const g = new Graphics();

    const cx = door.position[0];
    const cy = door.position[1];
    const angle = door.angle;
    const halfWidth = door.width / 2;
    const wallColor = parseInt(style.wallColor.replace('#', ''), 16);

    if (door.style === 'archway') {
      renderArchway(g, cx, cy, angle, halfWidth, wallColor);
    } else if (door.style === 'portcullis') {
      renderPortcullis(g, cx, cy, angle, halfWidth, wallColor, door.state);
    } else if (door.style === 'double') {
      renderDoubleDoor(g, cx, cy, angle, halfWidth, wallColor, door.state);
    } else {
      renderSingleDoor(g, cx, cy, angle, halfWidth, wallColor, door.state, door.isSecret);
    }

    container.addChild(g);

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
    // Quarter-circle arc showing door swing — pivot at hinge end
    const pivotX = cx - Math.cos(angle) * halfWidth;
    const pivotY = cy - Math.sin(angle) * halfWidth;
    const arcRadius = halfWidth * 2;
    const perpAngle = angle + Math.PI / 2;
    const startX = pivotX + Math.cos(perpAngle) * arcRadius;
    const startY = pivotY + Math.sin(perpAngle) * arcRadius;
    g.moveTo(startX, startY);
    g.arc(pivotX, pivotY, arcRadius, perpAngle, angle, true);
    g.stroke({ color, width: GLYPH_STROKE, alpha: 0.7 });
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
    g.stroke({ color, width: GLYPH_STROKE, alpha: 0.7 });
    // Right leaf — hinge at right end, swings opposite
    const rPivotX = cx + Math.cos(angle) * halfWidth;
    const rPivotY = cy + Math.sin(angle) * halfWidth;
    const rEndAngle = perpAngle + Math.PI;
    const rStartX = rPivotX + Math.cos(rEndAngle) * halfWidth;
    const rStartY = rPivotY + Math.sin(rEndAngle) * halfWidth;
    g.moveTo(rStartX, rStartY);
    g.arc(rPivotX, rPivotY, halfWidth, rEndAngle, angle + Math.PI, true);
    g.stroke({ color, width: GLYPH_STROKE, alpha: 0.7 });
  } else {
    // Two thin rectangles side by side
    const perpAngle = angle + Math.PI / 2;
    const thickness = halfWidth * 0.12;
    const gap = halfWidth * 0.04;
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
  const barLength = halfWidth * 0.35;
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
  const capSize = halfWidth * 0.25;
  for (const sign of [-1, 1]) {
    const ex = cx + Math.cos(angle) * halfWidth * sign;
    const ey = cy + Math.sin(angle) * halfWidth * sign;
    g.moveTo(ex - Math.cos(perpAngle) * capSize, ey - Math.sin(perpAngle) * capSize);
    g.lineTo(ex + Math.cos(perpAngle) * capSize, ey + Math.sin(perpAngle) * capSize);
  }
  g.stroke({ color, width: GLYPH_STROKE * 1.2 });
}
