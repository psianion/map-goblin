import { useEffect, type RefObject } from 'react';
import type { RenderEngine } from '@/engine/RenderEngine';
import type { ToolManager } from '@/engine/tools/ToolManager';
import type { SnapIndicator } from './snapIndicator';
import type { Point } from '@/types/geometry';
import { handleImageImport } from './importImage';
import { handleShortcut } from '@/shortcuts/defaultShortcuts';

type InputMiddleware = (point: Point) => Point;

const middlewareStack: InputMiddleware[] = [];
let _toolManager: ToolManager | null = null;
let _snapIndicator: SnapIndicator | null = null;

export function registerInputMiddleware(fn: InputMiddleware): () => void {
  middlewareStack.push(fn);
  return () => {
    const idx = middlewareStack.indexOf(fn);
    if (idx >= 0) middlewareStack.splice(idx, 1);
  };
}

export function setToolManager(manager: ToolManager | null): void {
  _toolManager = manager;
}

export function setSnapIndicator(indicator: SnapIndicator | null): void {
  _snapIndicator = indicator;
}

function applyMiddleware(point: Point): Point {
  let p = point;
  for (const fn of middlewareStack) {
    p = fn(p);
  }
  return p;
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

export function useCanvasInput(
  containerRef: RefObject<HTMLDivElement | null>,
  engine: RenderEngine | null,
): void {
  useEffect(() => {
    const canvasEl = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvasEl || !engine) return;

    // ─── Pointer events ───────────────────────────────────────
    const onPointerDown = (e: PointerEvent) => {
      canvasEl.setPointerCapture(e.pointerId);
      const world = engine.screenToWorld(e.clientX - canvasEl.getBoundingClientRect().left, e.clientY - canvasEl.getBoundingClientRect().top);
      const snapped = applyMiddleware(world);
      _toolManager?.onPointerDown(snapped, e);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const snapped = applyMiddleware(world);
      _toolManager?.onPointerMove(snapped, e);
      _snapIndicator?.show(engine.worldToScreen(snapped.x, snapped.y));
    };

    const onPointerUp = (e: PointerEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const snapped = applyMiddleware(world);
      _toolManager?.onPointerUp(snapped, e);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const combo = [
        e.ctrlKey || e.metaKey ? 'ctrl' : '',
        e.shiftKey ? 'shift' : '',
        e.altKey ? 'alt' : '',
        e.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join('+');
      if (handleShortcut(combo)) {
        e.preventDefault();
        return;
      }
      _toolManager?.onKeyDown(e);
    };

    // ─── Pan and zoom ─────────────────────────────────────────
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;

    const onMiddleDown = (e: MouseEvent) => {
      if (e.button === 1) {
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        e.preventDefault();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - lastPanX;
      const dy = e.clientY - lastPanY;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      const stage = engine.stage();
      stage.position.x += dx;
      stage.position.y += dy;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1) isPanning = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const stage = engine.stage();
      const rect = canvasEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const oldZoom = stage.scale.x;
      const newZoom = Math.max(10, Math.min(100, oldZoom * zoomFactor));

      stage.position.x = mx - (mx - stage.position.x) * (newZoom / oldZoom);
      stage.position.y = my - (my - stage.position.y) * (newZoom / oldZoom);
      stage.scale.set(newZoom);
    };

    // ─── Image drag-and-drop ──────────────────────────────────
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) await handleImageImport(file, engine);
    };

    // ─── Clipboard paste ──────────────────────────────────────
    const onPaste = async (e: ClipboardEvent) => {
      if (isTextInput(document.activeElement)) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      if (file) await handleImageImport(file, engine);
    };

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('mousedown', onMiddleDown);
    canvasEl.addEventListener('mousemove', onMouseMove);
    canvasEl.addEventListener('mouseup', onMouseUp);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    canvasEl.addEventListener('dragover', onDragOver);
    canvasEl.addEventListener('drop', onDrop as unknown as EventListener);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste as unknown as EventListener);

    return () => {
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('pointerup', onPointerUp);
      canvasEl.removeEventListener('mousedown', onMiddleDown);
      canvasEl.removeEventListener('mousemove', onMouseMove);
      canvasEl.removeEventListener('mouseup', onMouseUp);
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('dragover', onDragOver);
      canvasEl.removeEventListener('drop', onDrop as unknown as EventListener);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('paste', onPaste as unknown as EventListener);
    };
  }, [containerRef, engine]);
}
