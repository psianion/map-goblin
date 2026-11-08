// The Battlemap layer and the picture on it: what the layer sheet and the image card offer.
// A Battlemap layer is a dungeon layer holding nothing but imported pictures. "Line up grid"
// opens the grid line-up on a picture (detecting its printed grid first); "Replace" swaps the
// picture and keeps its lattice; "Convert to trace" turns it into a trace layer in the same
// place; "Use as Battlemap" moves a picture placed among props onto a Battlemap layer of its
// own. Each change is one undo step on the command layer.

import { Assets, type Texture } from 'pixi.js';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import {
  AddChildCommand,
  AddLayerCommand,
  CompositeCommand,
  RemoveChildCommand,
  RemoveLayerCommand,
  ReorderLayerCommand,
  UpdateChildCommand,
} from '@/store/commands';
import { AddTraceLayerCommand } from '@dnd/core/src/store/layerCommands';
import { createDungeonLayer, createImageLayer } from '@dnd/core/src/store/factories';
import type { AnyChild, AssetChild, Command, DungeonLayer } from '@/store/types';
import { isBattlemapLayer } from '@/editor/models/layerSheetModel';
import { MIN_DETECT_CONFIDENCE, battlemapCells, parseSizeHint } from '@/canvas/battlemapSize';
import { detectGrid, sampleForDetection } from '@/canvas/detectGrid';
import { assetFootprint, startGridCalibration } from '@/canvas/gridCalibration';
import { readPictureFile } from '@/canvas/importImage';

export const BATTLEMAP_LAYER_NAME = 'Battlemap';

const isPicture = (c: AnyChild): c is AssetChild => c.childType === 'asset' && c.objectType === 'image';

/** The picture a Battlemap layer's sheet is about: its first. */
export function battlemapPicture(layer: DungeonLayer): AssetChild | null {
  return layer.children.find(isPicture) ?? null;
}

/** The picture's own pixel size: as imported, or the texture's for a picture saved before 3.9. */
export function picturePx(child: AssetChild): { width: number; height: number } | null {
  if (child.imageSource) return { width: child.imageSource.width, height: child.imageSource.height };
  try {
    const tex = Assets.get<Texture>(child.assetId);
    return tex ? { width: tex.width, height: tex.height } : null;
  } catch {
    return null;
  }
}

/** The sheet's file line: "2520 × 1680 px · 36 × 24 cells", cells to a tenth. */
export function pictureLine(child: AssetChild): string {
  const foot = assetFootprint(child);
  const tenth = (v: number) => String(Math.round(v * 10) / 10);
  const px = picturePx(child);
  const cells = `${tenth(foot.width)} × ${tenth(foot.height)} cells`;
  return px ? `${px.width} × ${px.height} px · ${cells}` : cells;
}

/** The file the picture came from, or its name for one saved before 3.9. */
export const pictureFileName = (child: AssetChild): string => child.imageSource?.fileName ?? child.name;

function findPicture(childId: string): { layer: DungeonLayer; child: AssetChild } | null {
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue;
    const child = layer.children.find((c) => c.id === childId);
    if (child && isPicture(child)) return { layer, child };
  }
  return null;
}

/** The picture's top-left corner and footprint. */
function placeOf(child: AssetChild) {
  const foot = assetFootprint(child);
  return { x: child.position.x - foot.width / 2, y: child.position.y - foot.height / 2, width: foot.width, height: foot.height };
}

/**
 * Open the grid line-up on a placed picture, its printed grid found first from the pixels
 * saved with the map (seeded by a size in its file name). False when the id is no picture.
 */
export async function lineUpPicture(childId: string): Promise<boolean> {
  const found = findPicture(childId);
  if (!found) return false;
  const { child } = found;
  const px = picturePx(child);
  const hint = parseSizeHint(pictureFileName(child));
  let grid = null;
  const src = useStore.getState().assets.customImages[child.assetId];
  if (px && src) {
    try {
      const bitmap = await createImageBitmap(await (await fetch(src)).blob());
      const sample = sampleForDetection(bitmap);
      bitmap.close();
      if (sample) grid = detectGrid(sample, { seed: hint, source: px });
    } catch {
      grid = null;
    }
  }
  return startGridCalibration(childId, {
    cells: hint,
    sourcePx: px,
    grid: grid && grid.confidence >= MIN_DETECT_CONFIDENCE ? grid : null,
  });
}

/**
 * The picture as a trace layer, where it was and as big: Original fit with its placement, at
 * the bottom of its level. The picture leaves its layer, and a Battlemap layer it leaves empty
 * goes too. One undo step; null when the id is no picture.
 */
export function convertToTraceCommand(childId: string): Command | null {
  const found = findPicture(childId);
  if (!found) return null;
  const { layer, child } = found;
  const trace = { ...createImageLayer(layer.levelId, child.assetId, pictureFileName(child)), fit: 'original' as const, placement: placeOf(child) };
  const commands: Command[] = [new AddTraceLayerCommand(trace), new RemoveChildCommand('Convert to trace', layer.id, child.id)];
  const empty =
    layer.children.length === 1 && (layer.standaloneWalls?.length ?? 0) === 0 && !layer.water && (layer.materials?.length ?? 0) === 0;
  if (empty) commands.push(new RemoveLayerCommand('Convert to trace', layer.id));
  return new CompositeCommand('Convert to trace', commands);
}

/**
 * A picture placed among props, onto a locked Battlemap layer of its own at the bottom of its
 * level: its top-left on the map origin, sized from a size in its file name or 70 px a cell,
 * ready for the line-up. One undo step; null when the id is no picture or already on one.
 */
export function moveToBattlemapCommand(childId: string): { command: Command; childId: string } | null {
  const found = findPicture(childId);
  if (!found || isBattlemapLayer(found.layer)) return null;
  const { layer, child } = found;
  const px = picturePx(child);
  const foot = assetFootprint(child);
  let width = foot.width;
  let height = foot.height;
  if (px) {
    width = battlemapCells(px, parseSizeHint(pictureFileName(child))).width;
    height = (width * px.height) / px.width;
  }
  const scale = child.scale || 1;
  const moved: AssetChild = {
    ...structuredClone(child),
    rotation: 0,
    width: width / scale,
    height: height / scale,
    position: { x: width / 2, y: height / 2 },
  };
  const target: DungeonLayer = { ...createDungeonLayer(BATTLEMAP_LAYER_NAME, layer.levelId), locked: true };
  const layers = useStore.getState().layers;
  // At the bottom of the level, above the background, as the trace sits.
  const bottom = layers.findIndex((l) => l.type !== 'background' && l.levelId === layer.levelId);
  const label = 'Use as battlemap';
  const commands: Command[] = [
    new RemoveChildCommand(label, layer.id, child.id),
    new AddLayerCommand(label, target),
    ...(bottom >= 0 ? [new ReorderLayerCommand(label, layers.length, bottom)] : []),
    new AddChildCommand(label, target.id, moved),
  ];
  return { command: new CompositeCommand(label, commands), childId: child.id };
}

/**
 * Swap the picture for `file`, keeping its lattice: the same top-left corner and width, so a
 * new version of the same map (another resolution, a night variant) stays on the grid. One
 * undo step. Throws for a file that is not an image.
 */
export async function replacePicture(childId: string, file: File): Promise<boolean> {
  const found = findPicture(childId);
  if (!found) return false;
  const { layer, child } = found;
  const picture = await readPictureFile(file);
  const place = placeOf(child);
  const scale = child.scale || 1;
  const height = (place.width * picture.imageSource.height) / picture.imageSource.width;
  const before = { assetId: child.assetId, imageSource: child.imageSource, position: { ...child.position }, height: child.height };
  const after = {
    assetId: picture.assetId,
    imageSource: picture.imageSource,
    position: { x: child.position.x, y: place.y + height / 2 },
    height: height / scale,
  };
  undoManager.execute(new UpdateChildCommand('Replace image', layer.id, child.id, before, after));
  return true;
}

/** Card and sheet: "Use as Battlemap". Moves the picture, then opens the line-up on it. */
export function moveToBattlemap(childId: string): void {
  const move = moveToBattlemapCommand(childId);
  if (!move) return;
  undoManager.execute(move.command);
  void lineUpPicture(move.childId);
}

/** Card and sheet: "Convert to trace". */
export function convertToTrace(childId: string): void {
  const cmd = convertToTraceCommand(childId);
  if (cmd) undoManager.execute(cmd);
}

/** Whether the picture sits on a Battlemap layer, for the card's Use as. */
export function onBattlemapLayer(childId: string): boolean {
  const found = findPicture(childId);
  return !!found && isBattlemapLayer(found.layer);
}
