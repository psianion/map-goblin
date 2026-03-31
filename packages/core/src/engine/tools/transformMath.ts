export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  translate: [number, number];
  rotate: number;
  scale: [number, number];
}

const MIN_SIZE = 1;
const SNAP_ANGLE_RAD = Math.PI / 12; // 15 degrees

export function computeBoundingBox(points: [number, number][]): BoundingBox {
  if (points.length === 0) return { x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, MIN_SIZE),
    height: Math.max(maxY - minY, MIN_SIZE),
  };
}

export function applyTransformToPoints(
  points: [number, number][],
  t: Transform,
): [number, number][] {
  return points.map(([x, y]) => {
    // Scale
    const sx = x * t.scale[0];
    const sy = y * t.scale[1];
    // Rotate around origin
    const cos = Math.cos(t.rotate);
    const sin = Math.sin(t.rotate);
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    // Translate
    return [rx + t.translate[0], ry + t.translate[1]] as [number, number];
  });
}

export function constrainProportions(
  newWidth: number,
  newHeight: number,
  origWidth: number,
  origHeight: number,
): { width: number; height: number } {
  const aspect = origWidth / origHeight;
  // Use whichever dimension changed more
  if (Math.abs(newWidth - origWidth) > Math.abs(newHeight - origHeight)) {
    return { width: newWidth, height: newWidth / aspect };
  }
  return { width: newHeight * aspect, height: newHeight };
}

export function rotatePoint(
  x: number,
  y: number,
  pivotX: number,
  pivotY: number,
  angle: number,
): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - pivotX;
  const dy = y - pivotY;
  return [
    pivotX + dx * cos - dy * sin,
    pivotY + dx * sin + dy * cos,
  ];
}

export function snapValueToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function snapAngle(angle: number): number {
  return Math.round(angle / SNAP_ANGLE_RAD) * SNAP_ANGLE_RAD;
}

export function clampScale(s: number): number {
  return Math.max(0.01, s);
}
