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
  gridCellSize: number,
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
    dot.circle(cx, cy, gridCellSize * 0.12);
    dot.fill({ color: stateColor });
    container.addChild(dot);
  }
}

function renderSingleDoor(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, color: number, state: string, isSecret: boolean,
): void {
  if (isSecret && state === 'closed') {
    // Dashed line matching wall (blends in)
    g.moveTo(cx - Math.cos(angle) * halfWidth, cy - Math.sin(angle) * halfWidth);
    g.lineTo(cx + Math.cos(angle) * halfWidth, cy + Math.sin(angle) * halfWidth);
    g.stroke({ color, width: 2, alpha: 0.5 });
    return;
  }

  if (state === 'open') {
    // Arc showing door swing — pivot at one end of the door
    const pivotX = cx - Math.cos(angle) * halfWidth;
    const pivotY = cy - Math.sin(angle) * halfWidth;
    const arcRadius = halfWidth * 2;
    // Move to arc start point to prevent connecting line from origin
    const startX = pivotX + Math.cos(angle) * arcRadius;
    const startY = pivotY + Math.sin(angle) * arcRadius;
    g.moveTo(startX, startY);
    g.arc(pivotX, pivotY, arcRadius, angle, angle + Math.PI / 4);
    g.stroke({ color, width: 1.5, alpha: 0.6 });
  } else {
    // Closed: thick line along wall
    g.moveTo(cx - Math.cos(angle) * halfWidth, cy - Math.sin(angle) * halfWidth);
    g.lineTo(cx + Math.cos(angle) * halfWidth, cy + Math.sin(angle) * halfWidth);
    g.stroke({ color, width: 3, alpha: 0.8 });
  }
}

function renderDoubleDoor(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, color: number, state: string,
): void {
  if (state === 'open') {
    const offset = halfWidth * 0.5;
    // Left leaf arc
    const lPivotX = cx - Math.cos(angle) * offset;
    const lPivotY = cy - Math.sin(angle) * offset;
    const lStartX = lPivotX + Math.cos(angle) * halfWidth;
    const lStartY = lPivotY + Math.sin(angle) * halfWidth;
    g.moveTo(lStartX, lStartY);
    g.arc(lPivotX, lPivotY, halfWidth, angle, angle + Math.PI / 4);
    g.stroke({ color, width: 1.5, alpha: 0.6 });
    // Right leaf arc
    const rPivotX = cx + Math.cos(angle) * offset;
    const rPivotY = cy + Math.sin(angle) * offset;
    const rStartAngle = angle + Math.PI;
    const rStartX = rPivotX + Math.cos(rStartAngle) * halfWidth;
    const rStartY = rPivotY + Math.sin(rStartAngle) * halfWidth;
    g.moveTo(rStartX, rStartY);
    g.arc(rPivotX, rPivotY, halfWidth, rStartAngle, rStartAngle - Math.PI / 4, true);
    g.stroke({ color, width: 1.5, alpha: 0.6 });
  } else {
    // Two parallel lines
    const perpAngle = angle + Math.PI / 2;
    const gap = halfWidth * 0.05;
    for (const sign of [-1, 1]) {
      const ox = Math.cos(perpAngle) * gap * sign;
      const oy = Math.sin(perpAngle) * gap * sign;
      g.moveTo(cx - Math.cos(angle) * halfWidth + ox, cy - Math.sin(angle) * halfWidth + oy);
      g.lineTo(cx + Math.cos(angle) * halfWidth + ox, cy + Math.sin(angle) * halfWidth + oy);
    }
    g.stroke({ color, width: 2, alpha: 0.8 });
  }
}

function renderPortcullis(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, _color: number, state: string,
): void {
  const barCount = 4;
  const yOffset = state === 'open' ? -halfWidth * 0.5 : 0;
  const perpAngle = angle + Math.PI / 2;
  for (let i = 0; i < barCount; i++) {
    const t = (i / (barCount - 1)) * 2 - 1;
    const bx = cx + Math.cos(angle) * halfWidth * t;
    const by = cy + Math.sin(angle) * halfWidth * t;
    g.moveTo(
      bx + Math.cos(perpAngle) * halfWidth * 0.3 + Math.cos(perpAngle) * yOffset,
      by + Math.sin(perpAngle) * halfWidth * 0.3 + Math.sin(perpAngle) * yOffset,
    );
    g.lineTo(
      bx - Math.cos(perpAngle) * halfWidth * 0.3 + Math.cos(perpAngle) * yOffset,
      by - Math.sin(perpAngle) * halfWidth * 0.3 + Math.sin(perpAngle) * yOffset,
    );
  }
  g.stroke({ color: 0x444444, width: 2 });
}

function renderArchway(
  g: Graphics, cx: number, cy: number, angle: number,
  halfWidth: number, color: number,
): void {
  const perpAngle = angle + Math.PI / 2;
  const capSize = halfWidth * 0.2;
  for (const sign of [-1, 1]) {
    const ex = cx + Math.cos(angle) * halfWidth * sign;
    const ey = cy + Math.sin(angle) * halfWidth * sign;
    g.moveTo(ex - Math.cos(perpAngle) * capSize, ey - Math.sin(perpAngle) * capSize);
    g.lineTo(ex + Math.cos(perpAngle) * capSize, ey + Math.sin(perpAngle) * capSize);
  }
  g.stroke({ color, width: 2 });
}
