// Ray-casting point-in-polygon — a local copy rather than importing
// engine/hitTest.ts, which drags core's own store singleton into the
// properties bundle for one boolean check. Shared by ZoneProperties and
// PrepPanel's inert-badge mirror of the same rule.
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false
  const [px, py] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}
