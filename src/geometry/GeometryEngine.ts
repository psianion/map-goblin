export type { Polygon } from '@/types/geometry';
import type { Polygon } from '@/types/geometry';

export interface GeometryEngine {
  union(subjects: Polygon[], clips: Polygon[]): Polygon[];
  difference(subjects: Polygon[], clips: Polygon[]): Polygon[];
  intersection(subjects: Polygon[], clips: Polygon[]): Polygon[];
  inflate(paths: Polygon[], delta: number): Polygon[];
  simplify(paths: Polygon[], epsilon: number): Polygon[];
}
