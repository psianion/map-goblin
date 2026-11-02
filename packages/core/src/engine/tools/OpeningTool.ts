// The Opening tool (S): stairs, ramps and ladders through a cliff, placed the way the door
// tool hangs doors on walls. Hover a raised floor's edge (anything but a wall) and a ghost of
// the next opening rides it; click places it there, selected. Over a placed opening a click
// selects it and a drag slides it along the ring, one undo step per gesture. Delete removes
// the selected (or hovered) opening.

import { Container } from 'pixi.js';
import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { DungeonLayer, OpeningToolSettings } from '../../store/types';
import type { OpeningChild } from '../../shared/types';
import { edgeOf, layerPlateaus, openingFrame, ownHeight, ringParamAt } from '../../shared/plateaus';
import { addOpening, removeOpening } from '../../store/plateauCommands';
import { UpdateChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { blockedLayerReason, noEditableLayerMessage } from './layerGuard';
import { drawOpening } from '../plateauRenderer';
import { nextAuthoredName } from './DoorTool';
import { DOOR_MIN_HIT_RADIUS } from '../hitTest';

/** How far from a cliff edge the pointer may be and still place on it, in cells. */
export const OPENING_SNAP = 0.75;
const GHOST_ALPHA = 0.55;
const DRAG_SLOP = 0.15;

export const OPENING_DEFAULTS: OpeningToolSettings = { kind: 'stairs', width: 2 };

/** The tool's settings with their defaults filled in. */
export function openingSettings(): OpeningToolSettings {
  return { ...OPENING_DEFAULTS, ...useStore.getState().tools.settings.opening };
}

export const OPENING_LABEL: Record<OpeningChild['kind'], string> = { stairs: 'Stairs', ramp: 'Ramp', ladder: 'Ladder' };

/**
 * The raised floor edge nearest (x, y) within `reach`: the floor's id and the fraction of its
 * outline there. Only floors with a height and an edge other than a wall take openings.
 */
export function cliffSnap(
  layer: Pick<DungeonLayer, 'children'>,
  x: number,
  y: number,
  reach = OPENING_SNAP,
): { shapeId: string; t: number; dist: number } | null {
  let best: { shapeId: string; t: number; dist: number } | null = null;
  for (const info of layerPlateaus(layer).infos.values()) {
    if (ownHeight(info.shape) === 0 || edgeOf(info.shape) === 'wall' || info.outline.length < 3) continue;
    const hit = ringParamAt(info.outline, x, y);
    if (hit.dist <= reach && (!best || hit.dist < best.dist)) best = { shapeId: info.shape.id, t: hit.t, dist: hit.dist };
  }
  return best;
}

/** The opening under (x, y), nearest first: within its half-width of where it sits. */
export function openingAt(layer: DungeonLayer, x: number, y: number): OpeningChild | null {
  let best: OpeningChild | null = null;
  let bestDist = Infinity;
  for (const c of layer.children) {
    if (c.childType !== 'opening' || !c.visible) continue;
    const frame = openingFrame(layer, c);
    if (!frame) continue;
    const d = Math.hypot(frame.position[0] - x, frame.position[1] - y);
    if (d <= Math.max(c.width / 2, DOOR_MIN_HIT_RADIUS) && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function activeDungeonLayer(): DungeonLayer | undefined {
  const store = useStore.getState();
  return store.layers.find((l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon');
}

export class OpeningTool implements DrawingTool {
  readonly type = 'opening' as const;
  readonly cursor = 'crosshair';
  /** Opening under the cursor: what a click selects and Delete removes when nothing is selected. */
  hoveredId: string | null = null;

  private ghost: Container;
  private ghostKey: string | null = null;
  private snap: { shapeId: string; t: number } | null = null;
  /** The opening a press landed on, where it was, and whether the press became a slide. */
  private pressed: { id: string; layerId: string; from: number; at: Point; sliding: boolean } | null = null;

  constructor(previewContainer: Container) {
    this.ghost = new Container();
    this.ghost.label = 'openingGhost';
    this.ghost.alpha = GHOST_ALPHA;
    previewContainer.addChild(this.ghost);
  }

  onPointerDown(point: Point): void {
    const layer = activeDungeonLayer();
    if (!layer) {
      notify.warning(noEditableLayerMessage());
      return;
    }
    const hit = openingAt(layer, point.x, point.y);
    if (hit) {
      useStore.getState().setSelectedIds([hit.id]);
      this.pressed = { id: hit.id, layerId: layer.id, from: hit.t, at: point, sliding: false };
      this.clearGhost();
      return;
    }
    const reason = blockedLayerReason(layer);
    if (reason) {
      notify.warning(reason);
      return;
    }
    const snap = cliffSnap(layer, point.x, point.y);
    if (!snap) {
      notify.info('Openings go on the edge of a raised floor with a cliff, slope or no edge');
      return;
    }
    const settings = openingSettings();
    const opening: OpeningChild = {
      id: crypto.randomUUID(),
      name: nextAuthoredName(layer.children, OPENING_LABEL[settings.kind]),
      childType: 'opening',
      visible: true,
      kind: settings.kind,
      shapeId: snap.shapeId,
      t: snap.t,
      width: settings.width,
      ...(settings.kind === 'stairs' && settings.artId ? { artId: settings.artId } : {}),
    };
    undoManager.execute(addOpening(layer.id, opening));
    this.clearGhost();
    useStore.getState().setSelectedIds([opening.id]);
  }

  onPointerMove(point: Point): void {
    const layer = activeDungeonLayer();
    if (!layer) return;
    const p = this.pressed;
    if (p) {
      if (!p.sliding && Math.hypot(point.x - p.at.x, point.y - p.at.y) <= DRAG_SLOP) return;
      const opening = layer.children.find((c): c is OpeningChild => c.id === p.id && c.childType === 'opening');
      if (!opening) return;
      if (!p.sliding && blockedLayerReason(layer)) {
        notify.warning(blockedLayerReason(layer)!);
        this.pressed = null;
        return;
      }
      p.sliding = true;
      // Slide along the opening's own floor: the nearest point of that ring, however far.
      const info = layerPlateaus(layer).infos.get(opening.shapeId);
      if (info) useStore.getState().updateChild(layer.id, p.id, { t: ringParamAt(info.outline, point.x, point.y).t });
      return;
    }
    this.hoveredId = openingAt(layer, point.x, point.y)?.id ?? null;
    const snap = this.hoveredId || layer.locked ? null : cliffSnap(layer, point.x, point.y);
    this.snap = snap ? { shapeId: snap.shapeId, t: snap.t } : null;
    this.updateGhost(layer);
  }

  onPointerUp(): void {
    const p = this.pressed;
    this.pressed = null;
    if (!p?.sliding) return;
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === p.layerId && l.type === 'dungeon');
    const opening = layer?.children.find((c): c is OpeningChild => c.id === p.id && c.childType === 'opening');
    if (!layer || !opening || opening.t === p.from) return;
    const to = opening.t;
    // Rewind the live slide, then replay it as one undo step.
    useStore.getState().updateChild(layer.id, p.id, { t: p.from });
    undoManager.execute(new UpdateChildCommand('Move opening', layer.id, p.id, { t: p.from }, { t: to }));
  }

  private updateGhost(layer: DungeonLayer): void {
    if (!this.snap) {
      this.clearGhost();
      return;
    }
    const s = openingSettings();
    const key = `${this.snap.shapeId}:${this.snap.t.toFixed(3)}:${s.kind}:${s.width}:${s.artId ?? ''}`;
    if (key === this.ghostKey) return;
    this.clearGhost();
    const frame = openingFrame(layer, this.snap);
    if (!frame) return;
    const g = drawOpening({ id: 'ghost', kind: s.kind, width: s.width, artId: s.artId }, frame);
    if (g) this.ghost.addChild(g);
    this.ghostKey = key;
  }

  private clearGhost(): void {
    for (const child of this.ghost.removeChildren()) child.destroy({ children: true });
    this.ghostKey = null;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const layer = activeDungeonLayer();
    if (!layer) return;
    const store = useStore.getState();
    const selected = store.selection.selectedIds.find((id) => layer.children.some((c) => c.id === id && c.childType === 'opening'));
    const target = selected ?? this.hoveredId;
    if (!target) return;
    const reason = blockedLayerReason(layer);
    if (reason) {
      notify.warning(reason);
      return;
    }
    const cmd = removeOpening(target);
    if (!cmd) return;
    undoManager.execute(cmd);
    if (selected) store.setSelectedIds([]);
    this.hoveredId = null;
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  getHoverCursor(): string | null {
    if (this.pressed?.sliding) return 'grabbing';
    return this.hoveredId ? 'move' : null;
  }

  cancel(): void {
    const p = this.pressed;
    if (p?.sliding) useStore.getState().updateChild(p.layerId, p.id, { t: p.from });
    this.pressed = null;
    this.snap = null;
    this.hoveredId = null;
    this.clearGhost();
  }

  isActive(): boolean {
    return this.pressed?.sliding ?? false;
  }
}
