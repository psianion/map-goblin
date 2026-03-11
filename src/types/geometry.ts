export interface Point {
  x: number;
  y: number;
}

export type Polygon = [number, number][];

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}
