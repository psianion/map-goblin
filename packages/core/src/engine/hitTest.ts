import type { AnyChild, ShapeChild, AssetChild, LightChild, DungeonLayer } from '../store/types';

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInShape(shape: ShapeChild, point: [number, number]): boolean {
  let p: [number, number] = point;
  if (shape.transform) {
    const t = shape.transform;
    let [x, y] = [point[0] - t.translate[0], point[1] - t.translate[1]];
    const cos = Math.cos(-t.rotate);
    const sin = Math.sin(-t.rotate);
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
    x /= t.scale[0];
    y /= t.scale[1];
    p = [x, y];
  }
  // Must be inside outer ring
  if (!pointInPolygon(p, shape.contours[0])) return false;
  // Must NOT be inside any hole ring
  for (let i = 1; i < shape.contours.length; i++) {
    if (pointInPolygon(p, shape.contours[i])) return false;
  }
  return true;
}

export function pointInAsset(asset: AssetChild, point: [number, number]): boolean {
  const halfW = (asset.width * asset.scale) / 2;
  const halfH = (asset.height * asset.scale) / 2;
  const cx = asset.position.x;
  const cy = asset.position.y;
  let [px, py] = [point[0] - cx, point[1] - cy];
  if (asset.rotation !== 0) {
    const cos = Math.cos(-asset.rotation);
    const sin = Math.sin(-asset.rotation);
    [px, py] = [px * cos - py * sin, px * sin + py * cos];
  }
  return Math.abs(px) <= halfW && Math.abs(py) <= halfH;
}

export function pointInLight(light: LightChild, point: [number, number]): boolean {
  const dx = point[0] - light.position.x;
  const dy = point[1] - light.position.y;
  const hitRadius = 0.5;
  return dx * dx + dy * dy <= hitRadius * hitRadius;
}

export function hitTestChildren(children: AnyChild[], point: [number, number]): AnyChild | null {
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (!child.visible) continue;
    switch (child.childType) {
      case 'shape':
        if (pointInShape(child, point)) return child;
        break;
      case 'asset':
        if (pointInAsset(child, point)) return child;
        break;
      case 'light':
        if (pointInLight(child, point)) return child;
        break;
    }
  }
  return null;
}

export function hitTestAllLayers(
  layers: DungeonLayer[],
  point: [number, number],
): { child: AnyChild; layerId: string } | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible || layer.locked) continue;
    const hit = hitTestChildren(layer.children, point);
    if (hit) return { child: hit, layerId: layer.id };
  }
  return null;
}

/**
 * Returns the axis-aligned bounding box of a child in world space.
 */
export function getChildBounds(child: AnyChild): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (child.childType) {
    case 'shape': {
      let points = child.contours[0];
      if (child.transform) {
        const t = child.transform;
        const cos = Math.cos(t.rotate);
        const sin = Math.sin(t.rotate);
        points = points.map(([px, py]): [number, number] => {
          const sx = px * t.scale[0];
          const sy = py * t.scale[1];
          return [
            cos * sx - sin * sy + t.translate[0],
            sin * sx + cos * sy + t.translate[1],
          ];
        });
      }
      if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = points[0][0];
      let maxX = points[0][0];
      let minY = points[0][1];
      let maxY = points[0][1];
      for (const [px, py] of points) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'asset': {
      const halfW = (child.width * child.scale) / 2;
      const halfH = (child.height * child.scale) / 2;
      if (child.rotation !== 0) {
        // Compute rotated AABB
        const cos = Math.abs(Math.cos(child.rotation));
        const sin = Math.abs(Math.sin(child.rotation));
        const rw = halfW * cos + halfH * sin;
        const rh = halfW * sin + halfH * cos;
        return {
          x: child.position.x - rw,
          y: child.position.y - rh,
          width: rw * 2,
          height: rh * 2,
        };
      }
      return {
        x: child.position.x - halfW,
        y: child.position.y - halfH,
        width: halfW * 2,
        height: halfH * 2,
      };
    }
    case 'light': {
      return {
        x: child.position.x - child.radius,
        y: child.position.y - child.radius,
        width: child.radius * 2,
        height: child.radius * 2,
      };
    }
    case 'door': {
      const halfW = child.width / 2;
      return {
        x: child.position[0] - halfW,
        y: child.position[1] - halfW,
        width: child.width,
        height: child.width,
      };
    }
  }
}

/**
 * Returns the union AABB of multiple children's bounds.
 */
export function unionChildBounds(
  children: AnyChild[],
): { x: number; y: number; width: number; height: number } | null {
  if (children.length === 0) return null;
  const first = getChildBounds(children[0]);
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (let i = 1; i < children.length; i++) {
    const b = getChildBounds(children[i]);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Returns true if two AABBs intersect.
 */
export function boundsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
