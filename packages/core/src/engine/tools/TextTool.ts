import { Text, type Container } from 'pixi.js';
import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { findBindTarget, labelFor, labelStyle } from '../../shared/labelStyles';
import { LABEL_FONT_FAMILY } from '../labelMetrics';
import type { DungeonLayer, TextChild } from '../../store/types';

/** The size range the label tool's settings and the label card offer, in world units. */
export const LABEL_SIZE_RANGE = { min: 0.2, max: 6, step: 0.1 } as const;

function countLabels(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'text').length;
}

/**
 * The label the tool placed last, and how deep the undo stack stood right after: while both
 * still hold, the place is the top undo step and Esc in the card may take it back.
 */
let placed: { id: string; depth: number } | null = null;
/** The label whose card should take focus once, when it mounts. */
let focusFor: string | null = null;

/** Whether `id` is the label just placed, its place still the last undo step. */
export function isFreshLabel(id: string): boolean {
  return placed !== null && placed.id === id && undoManager.size() === placed.depth;
}

/**
 * Take back the label just placed, by undoing its place, when it still shows its style's
 * default text. Returns whether it did.
 */
export function removeFreshLabel(child: TextChild): boolean {
  if (!isFreshLabel(child.id) || child.bound || child.text !== labelStyle(child.style).text) return false;
  placed = null;
  undoManager.undo();
  return true;
}

/** How long the status bar says why a click placed nothing, ms. */
export const LABEL_MISS_MS = 2000;

/** Why the last click placed nothing (a binding style with nothing to bind to), or null. */
let miss: string | null = null;
let missTimer: ReturnType<typeof setTimeout> | null = null;
const missListeners = new Set<() => void>();

/** The status bar's line for a Label click that found nothing to follow, while it shows. */
export function labelMiss(): string | null {
  return miss;
}

/** Called whenever `labelMiss()` changes. Returns the unsubscribe. */
export function subscribeLabelMiss(fn: () => void): () => void {
  missListeners.add(fn);
  return () => missListeners.delete(fn);
}

function setMiss(next: string | null): void {
  if (missTimer) clearTimeout(missTimer);
  missTimer = next ? setTimeout(() => setMiss(null), LABEL_MISS_MS) : null;
  if (miss === next) return;
  miss = next;
  for (const fn of missListeners) fn();
}

/** True once for the label just placed: its card focuses the text field on that mount only. */
export function takeLabelFocus(id: string): boolean {
  if (focusFor !== id) return false;
  focusFor = null;
  return true;
}

/**
 * Place a map label. Single click, like the light tool.
 *
 * The label lands selected, in the picked style, and the card's text field takes the typing.
 * Typing directly on the canvas would need an in-world text editor (caret, selection, IME),
 * a great deal of machinery for a feature whose text is usually a couple of words.
 */
export class TextTool implements DrawingTool {
  readonly type = 'text' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  /** "Aa" at the next label's size and weight under the cursor, in the shared preview layer. */
  private ghost: Text | null = null;

  private previewContainer: Container | undefined;

  constructor(previewContainer?: Container) {
    this.previewContainer = previewContainer;
  }

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const settings = store.tools.settings.label;
    // A Room name, Number pin or Door tag with nothing to follow places nothing, and says why.
    const binds = labelStyle(settings?.style).binds;
    if (binds && !findBindTarget(binds, point, store.layers, activeLayerId)) {
      setMiss(binds === 'door' ? 'Click on a door to tag it' : 'Click inside a room to name it');
      return;
    }
    setMiss(null);
    const child: TextChild = {
      id: crypto.randomUUID(),
      name: `Label ${countLabels(activeLayer) + 1}`,
      ...labelFor(settings?.style, point, store.layers, activeLayerId, {
        fontSize: settings?.fontSize,
        color: settings?.color,
      }),
    };

    // Selected first and handed to the step as its "before", so redo brings it back selected.
    const before = [...store.selection.selectedIds];
    store.setSelectedIds([child.id]);
    focusFor = child.id;
    undoManager.execute(new AddChildCommand('Place label', activeLayerId, child), { selectionBefore: before });
    placed = { id: child.id, depth: undoManager.size() };
  }

  onPointerMove(point: Point): void {
    if (!this.previewContainer) return;
    const store = useStore.getState();
    const settings = store.tools.settings.label;
    const style = labelStyle(settings?.style);
    const layer = store.layers.find((l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon');
    if (!this.ghost) {
      this.ghost = new Text({ text: 'Aa', style: { fontFamily: LABEL_FONT_FAMILY, fontSize: 100 }, resolution: 2 });
      this.ghost.anchor.set(0.5);
      this.ghost.alpha = 0.55;
      this.ghost.label = 'labelGhost';
      this.previewContainer.addChild(this.ghost);
    }
    const g = this.ghost;
    g.style.fontWeight = style.weight === 'bold' ? 'bold' : 'normal';
    g.style.fill = settings?.color ?? (style.color === 'ink' ? (layer?.style.wallColor ?? '#222222') : style.color);
    g.scale.set((settings?.fontSize ?? style.fontSize) / 100);
    g.position.set(point.x, point.y);
    g.visible = true;
  }

  onPointerUp(_point: Point): void {}

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  /** `ToolManager.switchTool` cancels the outgoing tool, so this is also the tool-exit clear. */
  cancel(): void {
    if (this.ghost) this.ghost.visible = false;
    setMiss(null);
  }

  isActive(): boolean {
    return false;
  }
}
