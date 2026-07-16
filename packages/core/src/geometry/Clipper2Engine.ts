import type { Polygon } from './GeometryEngine';
import type { MainModule, PathsD } from 'clipper2-wasm/dist/clipper2z';

/**
 * Precision parameter for Clipper2 PathD operations.
 * 2 = round to 2 decimal places. Sufficient for grid-aligned world coords.
 */
const PRECISION = 2;

let _clipper: MainModule | null = null;

/**
 * Set the WASM module reference. Called by initClipper() after WASM loads.
 */
export function setClipperModule(mod: MainModule): void {
  _clipper = mod;
}

function getClipper(): MainModule {
  if (!_clipper) throw new Error('Clipper2 WASM not initialized — call initClipper() first');
  return _clipper;
}

/** Convert our Polygon[] to Clipper2 PathsD. Caller must delete() the result. */
function toPathsD(polygons: Polygon[]): PathsD {
  const C = getClipper();
  const paths = new C.PathsD();
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    const flat: number[] = [];
    for (const [x, y] of poly) {
      flat.push(x, y);
    }
    const path = C.MakePathD(flat);
    paths.push_back(path);
    path.delete();
  }
  return paths;
}

/** Convert Clipper2 PathsD back to our Polygon[]. Does NOT delete the input. */
function fromPathsD(paths: PathsD): Polygon[] {
  const result: Polygon[] = [];
  for (let i = 0; i < paths.size(); i++) {
    const path = paths.get(i);
    const poly: Polygon = [];
    for (let j = 0; j < path.size(); j++) {
      const pt = path.get(j);
      poly.push([pt.x, pt.y]);
    }
    if (poly.length >= 3) result.push(poly);
  }
  return result;
}

class Clipper2EngineImpl {
  union(subjects: Polygon[], clips: Polygon[]): Polygon[] {
    if (!_clipper) return [...subjects, ...clips];
    const C = _clipper;
    const subj = toPathsD(subjects);
    const clip = toPathsD(clips);
    const result = C.UnionD(subj, clip, C.FillRule.NonZero, PRECISION);
    const out = fromPathsD(result);
    subj.delete();
    clip.delete();
    result.delete();
    return out;
  }

  difference(subjects: Polygon[], clips: Polygon[]): Polygon[] {
    if (!_clipper) return subjects;
    const C = _clipper;
    const subj = toPathsD(subjects);
    const clip = toPathsD(clips);
    const result = C.DifferenceD(subj, clip, C.FillRule.NonZero, PRECISION);
    const out = fromPathsD(result);
    subj.delete();
    clip.delete();
    result.delete();
    return out;
  }

  intersection(subjects: Polygon[], clips: Polygon[]): Polygon[] {
    if (!_clipper) return [];
    const C = _clipper;
    const subj = toPathsD(subjects);
    const clip = toPathsD(clips);
    const result = C.IntersectD(subj, clip, C.FillRule.NonZero, PRECISION);
    const out = fromPathsD(result);
    subj.delete();
    clip.delete();
    result.delete();
    return out;
  }

  inflate(paths: Polygon[], delta: number): Polygon[] {
    if (!_clipper) return paths;
    const C = _clipper;
    const input = toPathsD(paths);
    const result = C.InflatePathsD(
      input, delta,
      C.JoinType.Round, C.EndType.Polygon,
      2,    // miterLimit
      0.25, // arcTolerance
      PRECISION,
    );
    const out = fromPathsD(result);
    input.delete();
    result.delete();
    return out;
  }

  /**
   * Offset an OPEN polyline into a closed corridor polygon (round caps).
   * EndType.Polygon treats input as a closed ring — a 2-point or
   * near-collinear polyline has ~zero area and offsets to nothing, so open
   * paths must use EndType.Round instead.
   */
  inflateOpen(paths: Polygon[], delta: number): Polygon[] {
    if (!_clipper) return paths;
    const C = _clipper;
    const input = toPathsD(paths);
    const result = C.InflatePathsD(
      input, delta,
      C.JoinType.Round, C.EndType.Round,
      2,    // miterLimit
      0.25, // arcTolerance
      PRECISION,
    );
    const out = fromPathsD(result);
    input.delete();
    result.delete();
    return out;
  }

  simplify(paths: Polygon[], epsilon: number): Polygon[] {
    if (!_clipper) return paths;
    const C = _clipper;
    const input = toPathsD(paths);
    const result = C.SimplifyPathsD(input, epsilon, false);
    const out = fromPathsD(result);
    input.delete();
    result.delete();
    return out;
  }
}

export const clipper2Engine = new Clipper2EngineImpl();
