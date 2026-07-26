import { basename, dirname } from 'node:path';
import { detectAssetType } from './detect.js';
import type { AssetType, GridSize, ToolType } from '../types.js';

const GRID_PIXELS = 200;

/** Tool assignments per asset type */
const TYPE_TOOLS: Record<AssetType, ToolType[]> = {
  floor: ['floor-fill'],
  wall: ['wall'],
  pattern: ['floor-fill'],
  edge: ['floor-fill'],
  object: ['stamp'],
  scatter: ['scatter'],
  path: ['path'],
  portal: ['stamp'],
  'light-mask': ['stamp'],
};

export interface ParsedFilename {
  material: string;
  variant: string;
  folder: string;
}

export function parseFilename(filepath: string): ParsedFilename {
  const folder = dirname(filepath) === '.' ? '' : dirname(filepath).split('/').pop() ?? '';
  const name = basename(filepath).replace(/\.[^.]+$/, '');

  // Pattern: material-name-VARIANT (e.g., stone-cobble-A)
  const match = name.match(/^(.+)-([A-Z])$/);
  if (match) {
    return { material: match[1]!, variant: match[2]!, folder };
  }

  return { material: name, variant: 'A', folder };
}

export interface AutoTagInput {
  filename: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  dominantColor: string;
}

export interface AutoTagResult {
  type: AssetType;
  material: string;
  gridSize: GridSize;
  variant: string;
  tint: string;
  tool: ToolType[];
  transparency: boolean;
}

export function autoTag(input: AutoTagInput): AutoTagResult {
  const parsed = parseFilename(input.filename);
  const type = detectAssetType({
    width: input.width,
    height: input.height,
    folder: parsed.folder,
  });

  const gw = Math.max(1, Math.round(input.width / GRID_PIXELS));
  const gh = Math.max(1, Math.round(input.height / GRID_PIXELS));
  const gridSize = `${gw}x${gh}` as GridSize;

  return {
    type,
    material: parsed.material,
    gridSize,
    variant: parsed.variant,
    tint: input.dominantColor,
    tool: TYPE_TOOLS[type],
    transparency: input.hasAlpha,
  };
}
