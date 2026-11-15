// The sundial's arithmetic and its one write (`Sundial.tsx` draws it): where the sun rises on
// screen for a map orientation, through the same `sunAt` the shadows use, the ring's size for
// the canvas area the chrome leaves clear, and the orientation step a drag or the sheet's
// readout takes.

import { useStore } from '@/store/store';
import { SetEnvironmentSettingsCommand } from '@/store/commands';
import { SUN_RISE, sunAt } from '@dnd/core/src/shared/world';
import { runEdit } from '@/editor/families/design/cardWrites';
import { RAIL_W } from '@/editor/surfaces/Rail';
import { SHEET_W } from '@/editor/surfaces/SheetFrame';

/** The sheet's gap from the window's right edge. */
const SHEET_GAP = 12;
/** The ring's diameter is the clear area's smaller side less this. */
const RING_MARGIN = 48;
/** How close to one of the eight compass points the handle snaps onto it, in degrees. */
const SNAP_DEG = 6;

const wrapDeg = (d: number): number => ((d % 360) + 360) % 360;

/** Where the sun rises, in screen degrees (0 right, 90 down), for a map orientation: `sunAt` at sunrise. */
export function riseAngle(orientation: number): number {
  return sunAt(SUN_RISE, { naturalLight: true, orientation }, 'full-moon').azimuth;
}

/** A screen angle onto the nearest compass point when within SNAP_DEG of it. */
export function snapCompass(angle: number): number {
  const a = wrapDeg(angle);
  const near = Math.round(a / 45) * 45;
  return Math.abs(a - near) <= SNAP_DEG ? wrapDeg(near) : a;
}

/** The orientation that puts sunrise at a screen angle (snapped), in whole degrees. */
export function orientationFor(angle: number): number {
  return wrapDeg(Math.round(snapCompass(angle) - riseAngle(0)));
}

const SIDES = ['right', 'lower right', 'bottom', 'lower left', 'left', 'upper left', 'top', 'upper right'] as const;

/** The readout for an orientation: the screen side the sun rises at, to the nearest compass point. */
export function riseLabel(orientation: number): string {
  return `Rise at the ${SIDES[Math.round(wrapDeg(riseAngle(orientation)) / 45) % 8]}`;
}

/** The canvas area the editor's chrome leaves clear, in window pixels. */
export interface ClearArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The clear area when no chrome could be measured: right of the rail, left of the sheet. */
export function fallbackClearArea(viewport: { width: number; height: number }): ClearArea {
  return { left: RAIL_W, top: 0, right: viewport.width - SHEET_W - SHEET_GAP, bottom: viewport.height };
}

/**
 * The ring for a clear area: centred on it, its diameter the area's smaller side less
 * RING_MARGIN. Null when there is no room for one.
 */
export function sundialFrame(area: ClearArea): { cx: number; cy: number; r: number } | null {
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  const d = Math.min(width, height) - RING_MARGIN;
  if (d <= 0) return null;
  return { cx: area.left + width / 2, cy: area.top + height / 2, r: d / 2 };
}

/** Turns the sun to rise at `orientation`; with `coalesce`, a drag folds into one undo step. */
export function turnSun(orientation: number, coalesce?: string): void {
  const before = useStore.getState().mapSettings.orientation;
  const after = wrapDeg(Math.round(orientation));
  if (Object.is(before ?? 0, after)) return;
  runEdit('Environment', [new SetEnvironmentSettingsCommand({ orientation: before }, { orientation: after })], coalesce);
}
