import type { DrawingTool, PreviewShape } from './DrawingTool';
import { isDoubleClick } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { DungeonLayer, PathwayChild } from '../../store/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddChildCommand } from '../../store/commands';
import { notify } from '../../shared/notify';
import { pathPieceOf } from '../../assets/pathKit';
import { pathwayLine } from '../../shared/pathway';

/**
 * The Path tool: click the nodes (the grid snaps them when Snap is on), Enter or a
 * double-click ends the path, Escape drops it. The path takes the dock's width, smoothness,
 * piece and Curve, and the panel's transitions and Block light; Shift held as it ends bends
 * it, as Curve does. One undo step a path.
 */
export class PathTool implements DrawingTool {
  readonly type = 'path' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private nodes: [number, number][] = [];
  private pointer: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;
  private shift = false;

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (event && event.button !== 0) return;
    this.shift = !!event?.shiftKey;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.nodes.length >= 2 && isDoubleClick(this.lastClick, point, now)) {
      this.finish();
      return;
    }
    this.lastClick = { point, time: now };
    const last = this.nodes[this.nodes.length - 1];
    if (last && Math.hypot(last[0] - point.x, last[1] - point.y) < 1e-6) return;
    this.nodes.push([point.x, point.y]);
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.pointer = point;
    if (event) this.shift = event.shiftKey;
  }

  onPointerUp(): void {}

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    else if (event.key === 'Enter') {
      this.shift = event.shiftKey;
      this.finish();
    }
  }

  /** The path drawn so far as a child, or null with fewer than two nodes or no unit installed. */
  private draft(nodes: [number, number][]): PathwayChild | null {
    if (nodes.length < 2) return null;
    const state = useStore.getState();
    const s = state.tools.settings.path;
    const piece = pathPieceOf(s.pieceId);
    if (!piece) return null;
    return {
      id: crypto.randomUUID(),
      name: 'Path',
      childType: 'pathway',
      visible: true,
      contours: [nodes.map(([x, y]): [number, number] => [x, y])],
      pieceId: piece.id,
      width: s.width,
      smoothness: s.smoothness,
      curve: state.tools.curveMode !== this.shift,
      transitionIn: s.transitionIn,
      transitionOut: s.transitionOut,
      blocksLight: s.blocksLight,
    };
  }

  /** Lands the path on the active layer, one undo step, and starts the next. */
  private finish(): void {
    const nodes = this.nodes;
    this.nodes = [];
    this.lastClick = null;
    if (nodes.length < 2) return;
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.id === state.ui.activeLayerId && l.type === 'dungeon');
    if (!layer) return;
    const child = this.draft(nodes);
    if (!child) {
      notify.warning('No path pieces installed');
      return;
    }
    const n = layer.children.filter((c) => c.childType === 'pathway').length;
    child.name = n === 0 ? 'Path' : `Path ${n + 1}`;
    undoManager.execute(new AddChildCommand('Draw path', layer.id, child));
  }

  getPreview(): PreviewShape | null {
    if (this.nodes.length === 0) return null;
    const nodes: [number, number][] = this.pointer ? [...this.nodes, [this.pointer.x, this.pointer.y]] : this.nodes;
    const draft = this.draft(nodes);
    const line = draft ? pathwayLine(draft) : nodes;
    return { type: 'line', points: line.map(([x, y]) => ({ x, y })) };
  }

  cancel(): void {
    this.nodes = [];
    this.lastClick = null;
    this.pointer = null;
  }

  isActive(): boolean {
    return this.nodes.length > 0;
  }
}
