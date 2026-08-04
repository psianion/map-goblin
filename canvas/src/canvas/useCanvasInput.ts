import { useEffect, type RefObject } from 'react';
import type { RenderEngine } from '../engine/RenderEngine';
import type { ToolManager } from '../engine/tools/ToolManager';
import type { SnapIndicator } from './snapIndicator';
import type { DimensionHud } from './dimensionHud';
import type { Point } from '../types/geometry';
import { handleImageImport } from './importImage';
import { handleShortcut } from '@/shortcuts/defaultShortcuts';
import { cursorWorldPosition } from './cursorPosition';
import { useStore } from '../store/store';
import { cancelZoomAnimationRef } from '@/components/toolbar/zoomToFitRef';
import { wallNodeAt } from '@/engine/wallNodeOverlay';
import {
  beginNodeDrag,
  nudgeWallNode,
  endNodeDrag,
  cancelNodeDrag,
  isDraggingNode,
  toggleNodeEditAt,
  exitNodeEdit,
  handleNodeKey,
} from './wallNodeEdit';
import { outlineHitAt } from '@/engine/shapeNodeOverlay';
import {
  applyOutlineEdit,
  beginOutlineDrag,
  updateOutlineDrag,
  endOutlineDrag,
  cancelOutlineDrag,
  isDraggingOutline,
  toggleShapeNodeEditAt,
  exitShapeNodeEdit,
} from '@/engine/shapeNodeEdit';

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

let _dimensionHud: DimensionHud | null = null;

export function setDimensionHud(hud: DimensionHud | null): void {
  _dimensionHud = hud;
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
  // A synthetic event can target `document`, which has no tagName.
  const tag = el.tagName?.toLowerCase();
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
    let isPanToolDragging = false;
    let panToolLastX = 0;
    let panToolLastY = 0;

    // Wall node handle drag — intercepted ahead of the tool manager, the same
    // way pan-tool dragging is below. Node editing is a mode on a selected wall
    // rather than its own tool, so there is no DrawingTool to route it through.
    /**
     * The nodes this gesture is moving — the whole selection when the stone
     * grabbed was part of one, otherwise just that stone. Captured on press so
     * the set cannot change under a drag in flight.
     */
    let draggingNodeTs: number[] = [];
    let nodeDragLast: Point | null = null;
    /** Where an outline vertex/edge drag began, for the edge-drag offset. */
    let outlineDragStart: Point | null = null;

    /**
     * Push the dimension readout at the last known cursor. Called after every
     * input the tools see, not just moves: a chain commits on Enter or a
     * double-click and cancels on Escape, none of which move the pointer, and
     * the readout has to go away with the preview it was measuring.
     */
    const syncHud = (): void => {
      const active = _toolManager?.getActivePreview() ?? null;
      const world = cursorWorldPosition.current;
      if (!active || !world) {
        _dimensionHud?.hide();
        return;
      }
      // The canvas runs the full window width and the side panels float on
      // top of it, so the usable right edge is the panel's, not the canvas's.
      const panel = document.querySelector('[data-chrome="right"]');
      _dimensionHud?.update(
        active.toolType,
        active.preview,
        engine.worldToScreen(world.x, world.y),
        panel?.getBoundingClientRect().left ?? canvasEl.clientWidth,
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      canvasEl.setPointerCapture(e.pointerId);
      // Pan tool: left-click starts panning
      if (e.button === 0 && useStore.getState().tools.activeTool === 'pan') {
        isPanToolDragging = true;
        panToolLastX = e.clientX;
        panToolLastY = e.clientY;
        canvasEl.style.cursor = 'grabbing';
        return;
      }
      const rect0 = canvasEl.getBoundingClientRect();
      const rawWorld = engine.screenToWorld(e.clientX - rect0.left, e.clientY - rect0.top);

      if (e.button === 0 && useStore.getState().tools.nodeEditWallId) {
        // Hit test the unsnapped point: handles are where they are, and the
        // grid snap would drag the pick off a node sitting between divisions.
        const hit = wallNodeAt(rawWorld, engine.stage().scale.x);
        if (hit) {
          // Shift picks stones for a group move; it never starts one, so the
          // selection can be built up without nudging anything.
          if (e.shiftKey) {
            useStore.getState().toggleNodeSelection(hit.t);
            return;
          }
          const picked = useStore.getState().tools.selectedNodeTs;
          const inGroup = picked.some((t) => Math.abs(t - hit.t) < 1e-9);
          // Grabbing a stone outside the selection replaces it, which is what
          // keeps single-stone editing exactly as it was.
          if (!inGroup) useStore.getState().selectNode(hit.t);
          draggingNodeTs = inGroup ? [...picked] : [hit.t];
          nodeDragLast = rawWorld;
          beginNodeDrag(draggingNodeTs);
          return;
        }
        // Clicking away from any handle clears the selection but stays in mode.
        useStore.getState().selectNode(null);
      }

      if (e.button === 0 && useStore.getState().tools.shapeNodeEditId) {
        // Unsnapped, same as wall nodes: handles sit where they sit, and the
        // grid would drag the pick off one that lies between divisions.
        const hit = outlineHitAt(rawWorld, engine.stage().scale.x);
        if (hit?.kind === 'insert') {
          useStore.getState().selectVertex(null);
          applyOutlineEdit({ kind: 'insert', index: hit.index, x: hit.x, y: hit.y }, 'Add vertex');
          return;
        }
        if (hit) {
          useStore.getState().selectVertex(hit.kind === 'vertex' ? hit.index : null);
          if (beginOutlineDrag(hit.kind === 'vertex' ? 'vertex' : 'edge', hit.index)) {
            outlineDragStart = rawWorld;
            return;
          }
        }
        useStore.getState().selectVertex(null);
      }

      const snapped = applyMiddleware(rawWorld);
      cursorWorldPosition.current = snapped;
      _toolManager?.onPointerDown(snapped, e);
      syncHud();
    };

    const onPointerMove = (e: PointerEvent) => {
      // Pan tool drag
      if (isPanToolDragging) {
        cancelZoomAnimationRef.current?.();
        const dx = e.clientX - panToolLastX;
        const dy = e.clientY - panToolLastY;
        panToolLastX = e.clientX;
        panToolLastY = e.clientY;
        const stage = engine.stage();
        stage.position.x += dx;
        stage.position.y += dy;
        return;
      }
      const rect = canvasEl.getBoundingClientRect();

      // Node handle drag — accumulate the delta as a nudge on that node.
      if (draggingNodeTs.length > 0 && nodeDragLast) {
        const w = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        // One delta for every picked stone, so a group keeps its shape.
        nudgeWallNode(draggingNodeTs, w.x - nodeDragLast.x, w.y - nodeDragLast.y);
        nodeDragLast = w;
        return;
      }

      // Outline vertex/edge drag — the floor and its walls follow live.
      if (isDraggingOutline() && outlineDragStart) {
        const w = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        updateOutlineDrag(w, { x: w.x - outlineDragStart.x, y: w.y - outlineDragStart.y });
        return;
      }

      // Process coalesced events for smooth high-DPI/stylus input.
      // An empty list has to mean "just this move", same as the method being
      // missing: a pointer event that did not come from the real input stack
      // reports no coalesced history, and dropping it lost the move entirely —
      // tools that build their state on move (the scatter brush) then saw a
      // click with nothing behind it.
      const coalesced = e.getCoalescedEvents?.();
      const coalescedEvents = coalesced?.length ? coalesced : [e];
      for (const ce of coalescedEvents) {
        const world = engine.screenToWorld(ce.clientX - rect.left, ce.clientY - rect.top);
        const snapped = applyMiddleware(world);
        _toolManager?.onPointerMove(snapped, ce);
      }
      // Snap indicator + cursor use the final event only
      const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const snapped = applyMiddleware(world);
      cursorWorldPosition.current = snapped;
      _snapIndicator?.show(engine.worldToScreen(snapped.x, snapped.y));

      // Dimension readout while a drawing tool has a live preview.
      syncHud();

      // Update cursor for gizmo handle hover (non-pan tools only)
      if (useStore.getState().tools.activeTool !== 'pan') {
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const gizmoCursor = _toolManager?.getHoverCursor(sx, sy) ?? null;
        canvasEl.style.cursor = gizmoCursor ?? _toolManager?.getCursor() ?? 'default';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isPanToolDragging) {
        isPanToolDragging = false;
        canvasEl.style.cursor = 'grab';
        return;
      }
      if (draggingNodeTs.length > 0) {
        draggingNodeTs = [];
        nodeDragLast = null;
        endNodeDrag();
        return;
      }
      if (isDraggingOutline()) {
        outlineDragStart = null;
        endOutlineDrag();
        return;
      }
      const rect = canvasEl.getBoundingClientRect();
      const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const snapped = applyMiddleware(world);
      cursorWorldPosition.current = snapped;
      _toolManager?.onPointerUp(snapped, e);
      syncHud();
    };

    // A touch or stylus gesture can be taken away mid-drag. Both node drags
    // write straight to the store, and the outline one also collapses its
    // contributing shapes for the preview — without this the layer is left in
    // that half-finished state with no undo entry that reaches it.
    const onPointerCancel = () => {
      if (draggingNodeTs.length > 0) {
        draggingNodeTs = [];
        nodeDragLast = null;
        cancelNodeDrag();
      }
      if (isDraggingOutline()) {
        outlineDragStart = null;
        cancelOutlineDrag();
      }
      // The tool manager never heard about this gesture ending — without this
      // an active drawing tool (chain, drag, freehand stroke) is left mid-flight,
      // and an unguarded onPointerUp downstream could commit it.
      _toolManager?.cancelActive();
    };

    // Double-click with the select tool to expose nodes: a wall's sprite nodes
    // if the click landed on one, otherwise the floor outline's vertices.
    const onDoubleClick = (e: MouseEvent) => {
      if (useStore.getState().tools.activeTool !== 'select') return;
      const rect = canvasEl.getBoundingClientRect();
      const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (toggleNodeEditAt(world) || toggleShapeNodeEditAt(world)) e.preventDefault();
    };

    // Enter commits a chain, Escape cancels it, and a tool shortcut switches
    // away from it — all of them retire the preview the readout is measuring.
    const onKeyDown = (e: KeyboardEvent) => {
      handleKeyDown(e);
      syncHud();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip shortcuts when focus is in a text input (e.g. hex color field)
      // Exception: allow Ctrl/Cmd combos (Ctrl+S, Ctrl+Z, etc.) to still work
      if (isTextInput(e.target as Element) && !e.ctrlKey && !e.metaKey) return;

      // Escape leaves node editing before anything else claims it, so it does
      // not also cancel whatever drawing tool happens to be selected.
      if (e.key === 'Escape' && useStore.getState().tools.nodeEditWallId) {
        // Mid-drag it abandons the gesture and stays in edit mode, matching the
        // outline handles below. Leaving outright would strand the half-dragged
        // stone: the drag writes straight to the store, and endNodeDrag can no
        // longer resolve the run once edit mode is gone.
        if (isDraggingNode()) {
          draggingNodeTs = [];
          nodeDragLast = null;
          cancelNodeDrag();
        } else {
          exitNodeEdit();
        }
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape' && useStore.getState().tools.shapeNodeEditId) {
        // Mid-drag Escape abandons the gesture but stays in edit mode; a second
        // one leaves. Rolling the drag back first also undoes the collapse it
        // performed for the preview.
        if (isDraggingOutline()) {
          outlineDragStart = null;
          cancelOutlineDrag();
        } else {
          exitShapeNodeEdit();
        }
        e.preventDefault();
        return;
      }

      // Delete removes the selected vertex, ahead of the global table where
      // Delete means "delete the selected shape".
      {
        const tools = useStore.getState().tools;
        if (
          tools.shapeNodeEditId &&
          tools.selectedVertex !== null &&
          (e.key === 'Delete' || e.key === 'Backspace') &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          applyOutlineEdit({ kind: 'delete', index: tools.selectedVertex }, 'Delete vertex');
          useStore.getState().selectVertex(null);
          e.preventDefault();
          return;
        }
      }

      // Rotate / resize / delete the selected node, ahead of the global
      // shortcut table: Delete is bound there to the shape selection, and with
      // a node selected it has to mean this node.
      {
        const tools = useStore.getState().tools;
        if (
          tools.nodeEditWallId &&
          tools.selectedNodeT !== null &&
          !e.ctrlKey &&
          !e.metaKey &&
          handleNodeKey(e.key, tools.selectedNodeT)
        ) {
          e.preventDefault();
          return;
        }
      }

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
      cancelZoomAnimationRef.current?.();
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
      cancelZoomAnimationRef.current?.();
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

    // ─── Tool switch + base cursor ──────────────────────────
    // Immediately switch tool (and destroy gizmo) when activeTool changes in store,
    // then apply the new tool's base cursor. Gizmo-hover overrides happen in onPointerMove.
    // Without the switch, the SelectTool gizmo persists visually until the next pointer event.
    const applyActiveTool = (type: string): void => {
      _toolManager?.switchTool(type);
      canvasEl.style.cursor = type === 'pan' ? 'grab' : (_toolManager?.getCursor() ?? 'default');
    };
    applyActiveTool(useStore.getState().tools.activeTool);
    const unsubToolSwitch = useStore.subscribe(
      (s) => s.tools.activeTool,
      applyActiveTool,
    );

    const containerEl = containerRef.current;
    const onPointerLeave = () => {
      cursorWorldPosition.current = null;
      _dimensionHud?.hide();
    };

    canvasEl.addEventListener('dblclick', onDoubleClick);
    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('pointercancel', onPointerCancel);
    canvasEl.addEventListener('mousedown', onMiddleDown);
    canvasEl.addEventListener('mousemove', onMouseMove);
    canvasEl.addEventListener('mouseup', onMouseUp);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    canvasEl.addEventListener('dragover', onDragOver);
    canvasEl.addEventListener('drop', onDrop as unknown as EventListener);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste as unknown as EventListener);
    containerEl?.addEventListener('pointerleave', onPointerLeave);

    return () => {
      unsubToolSwitch();
      canvasEl.style.cursor = '';
      canvasEl.removeEventListener('dblclick', onDoubleClick);
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('pointerup', onPointerUp);
      canvasEl.removeEventListener('pointercancel', onPointerCancel);
      canvasEl.removeEventListener('mousedown', onMiddleDown);
      // Unmount mid-drag leaves the same half-finished state a cancel does.
      onPointerCancel();
      canvasEl.removeEventListener('mousemove', onMouseMove);
      canvasEl.removeEventListener('mouseup', onMouseUp);
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('dragover', onDragOver);
      canvasEl.removeEventListener('drop', onDrop as unknown as EventListener);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('paste', onPaste as unknown as EventListener);
      containerEl?.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [containerRef, engine]);
}
