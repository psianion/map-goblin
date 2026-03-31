/**
 * Catmull-Rom spline interpolation and path polygon generation.
 *
 * Uses centripetal parameterization (alpha=0.5 by default) to avoid
 * cusps and self-intersections. Phantom points are reflected at the
 * endpoints so the curve passes through the first and last control points.
 */

type Vec2 = [number, number];

/**
 * Compute the knot value t for centripetal Catmull-Rom.
 * t_{i+1} = t_i + |P_{i+1} - P_i|^alpha
 */
function knotValue(prev: number, a: Vec2, b: Vec2, alpha: number): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  return prev + Math.pow(dist, alpha);
}

/**
 * Interpolate a single Catmull-Rom segment between P1 and P2,
 * given surrounding points P0, P3 and knot values t0..t3.
 */
function interpolateSegment(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2,
  t0: number, t1: number, t2: number, t3: number,
  numPoints: number,
): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = t1 + (t2 - t1) * (i / numPoints);

    // Barry and Goldman's pyramidal evaluation
    const dt10 = t1 - t0 || 1e-10;
    const dt21 = t2 - t1 || 1e-10;
    const dt32 = t3 - t2 || 1e-10;
    const dt20 = t2 - t0 || 1e-10;
    const dt31 = t3 - t1 || 1e-10;

    const a1x = ((t1 - t) / dt10) * p0[0] + ((t - t0) / dt10) * p1[0];
    const a1y = ((t1 - t) / dt10) * p0[1] + ((t - t0) / dt10) * p1[1];

    const a2x = ((t2 - t) / dt21) * p1[0] + ((t - t1) / dt21) * p2[0];
    const a2y = ((t2 - t) / dt21) * p1[1] + ((t - t1) / dt21) * p2[1];

    const a3x = ((t3 - t) / dt32) * p2[0] + ((t - t2) / dt32) * p3[0];
    const a3y = ((t3 - t) / dt32) * p2[1] + ((t - t2) / dt32) * p3[1];

    const b1x = ((t2 - t) / dt20) * a1x + ((t - t0) / dt20) * a2x;
    const b1y = ((t2 - t) / dt20) * a1y + ((t - t0) / dt20) * a2y;

    const b2x = ((t3 - t) / dt31) * a2x + ((t - t1) / dt31) * a3x;
    const b2y = ((t3 - t) / dt31) * a2y + ((t - t1) / dt31) * a3y;

    const cx = ((t2 - t) / dt21) * b1x + ((t - t1) / dt21) * b2x;
    const cy = ((t2 - t) / dt21) * b1y + ((t - t1) / dt21) * b2y;

    result.push([cx, cy]);
  }
  return result;
}

/**
 * Create a phantom point by reflecting the neighbor across the endpoint.
 * phantom = 2 * endpoint - neighbor
 */
function reflectPoint(endpoint: Vec2, neighbor: Vec2): Vec2 {
  return [
    2 * endpoint[0] - neighbor[0],
    2 * endpoint[1] - neighbor[1],
  ];
}

/**
 * Interpolate a Catmull-Rom spline through the given control points.
 *
 * @param controls - Array of [x, y] control points (minimum 2)
 * @param segmentsPerSpan - Number of interpolated points per span (default 16)
 * @param alpha - Parameterization: 0 = uniform, 0.5 = centripetal, 1 = chordal (default 0.5)
 * @returns Array of interpolated [x, y] points including the last control point
 */
export function interpolateCatmullRom(
  controls: Vec2[],
  segmentsPerSpan: number = 16,
  alpha: number = 0.5,
): Vec2[] {
  if (controls.length < 2) return controls.length === 1 ? [[...controls[0]]] : [];
  if (controls.length === 2) {
    // Linear interpolation for 2 points
    const result: Vec2[] = [];
    for (let i = 0; i <= segmentsPerSpan; i++) {
      const t = i / segmentsPerSpan;
      result.push([
        controls[0][0] + t * (controls[1][0] - controls[0][0]),
        controls[0][1] + t * (controls[1][1] - controls[0][1]),
      ]);
    }
    return result;
  }

  // Pad with phantom points at both ends
  const padded: Vec2[] = [
    reflectPoint(controls[0], controls[1]),
    ...controls,
    reflectPoint(controls[controls.length - 1], controls[controls.length - 2]),
  ];

  const result: Vec2[] = [];
  const numSpans = padded.length - 3; // controls.length - 1

  for (let i = 0; i < numSpans; i++) {
    const p0 = padded[i];
    const p1 = padded[i + 1];
    const p2 = padded[i + 2];
    const p3 = padded[i + 3];

    const t0 = 0;
    const t1 = knotValue(t0, p0, p1, alpha);
    const t2 = knotValue(t1, p1, p2, alpha);
    const t3 = knotValue(t2, p2, p3, alpha);

    const segPoints = interpolateSegment(p0, p1, p2, p3, t0, t1, t2, t3, segmentsPerSpan);
    result.push(...segPoints);
  }

  // Add the final control point
  result.push([...controls[controls.length - 1]]);

  return result;
}

/**
 * Compute the unit perpendicular (left-hand normal) at a point on the path.
 * Given direction from prev to next, returns the CCW perpendicular.
 */
function perpendicular(prev: Vec2, next: Vec2): Vec2 {
  const dx = next[0] - prev[0];
  const dy = next[1] - prev[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1e-10;
  // Left-hand normal: (-dy, dx) normalized
  return [-dy / len, dx / len];
}

/**
 * Generate a closed polygon outline for a path with variable width.
 *
 * The polygon traces the left edge forward, then the right edge backward,
 * forming a closed contour suitable for filling or masking.
 *
 * @param points - Interpolated path centerline points
 * @param widths - Half-width at each point. If shorter than points, the last value is repeated.
 *                 A single number can be passed as a one-element array for uniform width.
 * @returns Closed polygon as [x, y][] (left forward + right backward)
 */
export function generatePathPolygon(
  points: Vec2[],
  widths: number[],
): Vec2[] {
  if (points.length < 2) return [];

  const left: Vec2[] = [];
  const right: Vec2[] = [];

  for (let i = 0; i < points.length; i++) {
    const w = i < widths.length ? widths[i] : widths[widths.length - 1];

    // Determine perpendicular direction
    let perp: Vec2;
    if (i === 0) {
      perp = perpendicular(points[0], points[1]);
    } else if (i === points.length - 1) {
      perp = perpendicular(points[i - 1], points[i]);
    } else {
      // Average of incoming and outgoing perpendiculars for smooth joins
      const p1 = perpendicular(points[i - 1], points[i]);
      const p2 = perpendicular(points[i], points[i + 1]);
      const ax = p1[0] + p2[0];
      const ay = p1[1] + p2[1];
      const alen = Math.sqrt(ax * ax + ay * ay) || 1e-10;
      perp = [ax / alen, ay / alen];
    }

    left.push([points[i][0] + perp[0] * w, points[i][1] + perp[1] * w]);
    right.push([points[i][0] - perp[0] * w, points[i][1] - perp[1] * w]);
  }

  // Close: left forward, then right backward
  return [...left, ...right.reverse()];
}
