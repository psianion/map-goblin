import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { AddChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import type { LightChild, DungeonLayer, AssetChild } from '../../store/types';
import { LIGHT_RADIUS_FT } from '../../store/lightPresets';

/** How far one R press turns the next light's cone. */
const CONE_TURN = 45;

/** Feet snapped to the radius step and held inside the range the card and dock use. */
const clampFt = (ft: number): number =>
  Math.min(LIGHT_RADIUS_FT.max, Math.max(LIGHT_RADIUS_FT.min, Math.round(ft / LIGHT_RADIUS_FT.step) * LIGHT_RADIUS_FT.step));

const plainR = (e: KeyboardEvent): boolean =>
  e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey;

function countLightsInLayer(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'light').length;
}

/** Within 0.5 cells of an asset's centre attaches the light to it — nearest wins. */
const ATTACH_RADIUS = 0.5;

function findAttachTarget(layer: DungeonLayer, point: Point): AssetChild | undefined {
  let best: AssetChild | undefined;
  let bestDist = ATTACH_RADIUS;
  for (const c of layer.children) {
    if (c.childType !== 'asset') continue;
    const dx = c.position.x - point.x;
    const dy = c.position.y - point.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

const placedListeners = new Set<() => void>();

/** Called after the Light tool places a light (the v2 editor turns its lit preview on). */
export function onLightPlaced(fn: () => void): () => void {
  placedListeners.add(fn);
  return () => placedListeners.delete(fn);
}

export class LightTool implements DrawingTool {
  readonly type = 'light' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private cursorPoint: Point | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const defaults = store.tools.settings.lightDefaults;
    const attachTarget = findAttachTarget(activeLayer, point);

    const child: LightChild = {
      id: crypto.randomUUID(),
      name: `Light ${countLightsInLayer(activeLayer) + 1}`,
      childType: 'light',
      visible: true,
      color: defaults.color,
      radius: defaults.radius,
      featherRadius: defaults.featherRadius,
      intensity: defaults.intensity,
      falloff: defaults.falloff,
      position: { x: point.x, y: point.y },
      ...(attachTarget ? { attachedTo: attachTarget.id } : {}),
      // The preset's optional fields (store/lightPresets.ts), only the ones it set.
      ...(defaults.cone ? { cone: { ...defaults.cone } } : {}),
      ...(defaults.animation ? { animation: { ...defaults.animation } } : {}),
      ...(defaults.throughWalls ? { throughWalls: true } : {}),
      ...(defaults.nightOnly ? { nightOnly: { ...defaults.nightOnly } } : {}),
      ...(defaults.darkness ? { darkness: true } : {}),
      ...(defaults.darkness && defaults.darkvisionSees ? { darkvisionSees: true } : {}),
    };

    undoManager.execute(new AddChildCommand('Place light', activeLayerId, child));
    for (const fn of placedListeners) fn();
  }

  onPointerMove(point: Point): void {
    this.cursorPoint = point;
  }

  onPointerUp(_point: Point): void {
    // no-op — single-click tool
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
      return;
    }
    // R turns the next light's cone (Shift+R the other way); a full circle has nothing to turn.
    if (plainR(event)) {
      const store = useStore.getState();
      const cone = store.tools.settings.lightDefaults.cone;
      if (!cone || cone.angle >= 360) return;
      const turned = cone.direction + (event.shiftKey ? -CONE_TURN : CONE_TURN);
      store.updateLightDefaults({ cone: { ...cone, direction: ((turned % 360) + 360) % 360 } });
    }
  }

  /** R is this tool's (rotate cone) while it is out, not the Rectangle shortcut's. */
  ownsKey(event: KeyboardEvent): boolean {
    return plainR(event);
  }

  /**
   * Wheel sizes the next light: bright radius, Shift+Wheel dim, one 5 ft step a notch (up
   * grows). Bright never passes dim — pushing one past the other carries the other with it.
   */
  onWheel(e: WheelEvent): boolean {
    // Shift+wheel arrives as a horizontal scroll in some browsers.
    const delta = e.deltaY || e.deltaX;
    if (delta === 0) return true;
    const store = useStore.getState();
    const d = store.tools.settings.lightDefaults;
    const ftPerCell = store.mapSettings.cellScale.value || 5;
    const step = delta < 0 ? LIGHT_RADIUS_FT.step : -LIGHT_RADIUS_FT.step;
    const bright = clampFt(d.featherRadius * ftPerCell);
    const dim = clampFt(d.radius * ftPerCell);
    const cells = (ft: number): number => ft / ftPerCell;
    if (e.shiftKey) {
      const v = clampFt(dim + step);
      store.updateLightDefaults(v < bright ? { radius: cells(v), featherRadius: cells(v) } : { radius: cells(v) });
    } else {
      const v = clampFt(bright + step);
      store.updateLightDefaults(v > dim ? { featherRadius: cells(v), radius: cells(v) } : { featherRadius: cells(v) });
    }
    return true;
  }

  getPreview(): PreviewShape | null {
    if (!this.cursorPoint) return null;
    return {
      type: 'circle',
      points: [this.cursorPoint],
    };
  }

  cancel(): void {
    this.cursorPoint = null;
  }

  isActive(): boolean {
    return false;
  }
}
