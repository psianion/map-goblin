// src/shared/uvttMapping.ts
import type { WallType } from './types';

export const WALL_TYPE_TO_UVTT: Record<WallType, number> = {
  normal: 0,
  terrain: 1,
  ethereal: 2,
  invisible: 3,
  window: 5,
};

export const DOOR_UVTT_CODE = 4;
export const SECRET_DOOR_UVTT_CODE = 6;

export const UVTT_TO_WALL_TYPE: Record<number, WallType> = {
  0: 'normal',
  1: 'terrain',
  2: 'ethereal',
  3: 'invisible',
  5: 'window',
};
