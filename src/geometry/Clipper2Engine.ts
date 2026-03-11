import type { Polygon } from './GeometryEngine';

/**
 * Clipper2 WASM geometry engine stub.
 * Full implementation requires browser environment (WASM).
 */
class Clipper2EngineImpl {
  union(subjects: Polygon[], _clips: Polygon[]): Polygon[] { return subjects; }
  difference(subjects: Polygon[], _clips: Polygon[]): Polygon[] { return subjects; }
  intersection(_subjects: Polygon[], _clips: Polygon[]): Polygon[] { return []; }
  inflate(paths: Polygon[], _delta: number): Polygon[] { return paths; }
  simplify(paths: Polygon[], _epsilon: number): Polygon[] { return paths; }
}

export const clipper2Engine = new Clipper2EngineImpl();
