// Moving the camera by hand.
//
// The camera *is* `stage.position` / `stage.scale` (renderLoop step 1), so this is a thin
// input layer over that transform — no viewport library, no camera state of its own. Wheel
// and keys zoom, drag pans, and every gesture is local: nothing here touches the wire, so
// one seat moving its own screen can never move anybody else's.
//
// Ordering matters more than the arithmetic. Tokens and doors listen on the *canvas* in the
// capture phase and `stopPropagation()` when they take a press (modules/tokens/drag.ts,
// modules/doors/DoorRenderer.ts); this listens on the canvas's *parent* in the bubble phase,
// so a left press that arrives here is one nothing else claimed — the map itself.

import type { Container } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { computeMapWorldBounds } from '@dnd/core/src/engine/export/exportPipeline';
import { useStore } from '@dnd/core/src/store/store';
import type { DungeonLayer, Layer } from '@dnd/core/src/store/types';
import { useSessionStore } from '../session/store';
import { MAX_ZOOM } from './camera';

/** The editor's zoom floor, and the floor here too when the map is small enough to clear it. */
const MIN_ZOOM = 10;
/** One wheel notch. The editor's factor, so a scene framed in canvas feels the same here. */
const WHEEL_STEP = 1.1;
/** One `+`/`-` press. Coarser than a notch — a key press should be worth making. */
const KEY_STEP = 1.25;
/** Fit leaves a little air around the map instead of butting it against the edges. */
const FIT_MARGIN = 0.9;

interface Extent {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Whether there is anything on this map to point a camera at.
 *
 * Asked separately because `computeMapWorldBounds` answers a map with nothing on it with a
 * 10×10 box around the origin — a sensible default for an *export*, and a trap for a camera:
 * a seat that framed it landed at zoom ~54 on empty origin, nowhere near where the map
 * actually is. The three sources are the three that function measures.
 */
function hasGeometry(layers: Layer[]): boolean {
  if (!isPlayerSeat() && useStore.getState().mapSettings.terrain?.bounds) return true;
  return layers.some((layer) => {
    if (layer.type !== 'dungeon') return false;
    const dl = layer as DungeonLayer;
    if (dl.mergedFloor?.length) return true;
    return dl.children.some((c) => c.childType === 'water' && c.visible);
  });
}

/**
 * A player's camera frames what they have revealed, nothing more. Their layers are already
 * the server's cut, but `mapSettings.terrain.bounds` rides the document unredacted (the
 * splat bitmap needs it to draw the terrain inside revealed rooms) — so it must not feed a
 * player's fit, or one painted hill leaks the whole map's extent into their zoom floor.
 */
const isPlayerSeat = (): boolean => useSessionStore.getState().you?.role !== 'dm';

// ponytail: the bounds are recomputed per gesture rather than cached — a walk over
// mergedFloor's points, microseconds beside the frame it precedes, and a cache would have to
// be invalidated on every reveal. Cache it the day a map makes this show up in a profile.
function mapExtent(): Extent | null {
  const { layers } = useStore.getState();
  if (!hasGeometry(layers)) return null;
  const b = computeMapWorldBounds(layers, isPlayerSeat() ? null : undefined);
  if (!Number.isFinite(b.minX) || !Number.isFinite(b.maxX)) return null;
  return {
    cx: (b.minX + b.maxX) / 2,
    cy: (b.minY + b.maxY) / 2,
    // Collinear or single-point content would otherwise demand infinite zoom.
    w: Math.max(b.maxX - b.minX, 1),
    h: Math.max(b.maxY - b.minY, 1),
  };
}

const zoomThatFits = (e: Extent, width: number, height: number): number =>
  Math.min(MAX_ZOOM, Math.min(width / e.w, height / e.h) * FIT_MARGIN);

/**
 * The zoom floor: far enough out to hold the whole map, and no further — past that you only
 * get a smaller map in more emptiness. A map small enough that fitting it means zooming *in*
 * keeps the editor's floor instead, so a single revealed room is never a locked camera.
 */
export function minZoom(engine: RenderEngine): number {
  const extent = mapExtent();
  if (!extent) return MIN_ZOOM;
  const { width, height } = engine.viewport();
  return Math.min(zoomThatFits(extent, width, height), MIN_ZOOM);
}

/**
 * Centre the map in the viewport at the zoom that fits it. False when there is no geometry
 * yet: a player seat is handed a document stripped to what it has revealed, and the floor
 * union the bounds are measured from can arrive a beat after the document does. Framing on
 * nothing is what leaves a joining player parked at the default zoom over empty space.
 */
export function fitMap(engine: RenderEngine): boolean {
  const extent = mapExtent();
  if (!extent) return false;
  const { width, height } = engine.viewport();
  const zoom = zoomThatFits(extent, width, height);
  const stage = engine.stage();
  stage.scale.set(zoom);
  stage.position.set(width / 2 - extent.cx * zoom, height / 2 - extent.cy * zoom);
  return true;
}

/**
 * Scale about a point in viewport space, leaving the world point under it exactly where it
 * is. This is the whole of "zoom towards the cursor", which is why it is exported: it is the
 * one piece of arithmetic here that can be wrong without looking wrong.
 */
export function zoomAbout(
  stage: Container,
  sx: number,
  sy: number,
  factor: number,
  min: number,
  max: number,
): void {
  const from = stage.scale.x;
  const to = Math.min(max, Math.max(min, from * factor));
  if (to === from) return;
  stage.position.x = sx - (sx - stage.position.x) * (to / from);
  stage.position.y = sy - (sy - stage.position.y) * (to / from);
  stage.scale.set(to);
}

/** Keys belong to whoever is typing, not to the camera. */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Wire wheel/drag/keyboard camera control to a container. Returns the detach.
 *
 * ponytail: no touch pinch. The gesture is two pointers of bookkeeping for a seat nobody has
 * asked for yet; add it here when a tablet turns up at a table.
 */
export function attachCameraInput(engine: RenderEngine, container: HTMLElement): () => void {
  const stage = engine.stage();
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    // Middle drags the map always; left only because nothing above claimed the press.
    if (e.button !== 0 && e.button !== 1) return;
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    container.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!panning) return;
    stage.position.x += e.clientX - lastX;
    stage.position.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onPointerUp = (e: PointerEvent) => {
    panning = false;
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    // Non-passive, and preventDefault first: over the map a wheel is a zoom, never a page
    // scroll and never the browser's own zoom (trackpad pinch arrives here as ctrl+wheel).
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    zoomAbout(
      stage,
      e.clientX - rect.left,
      e.clientY - rect.top,
      e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP,
      minZoom(engine),
      MAX_ZOOM,
    );
  };

  // Zoom about the viewport centre, for a seat that is not driving a mouse (PRODUCT §A11y).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const { width, height } = engine.viewport();
    const factor =
      e.key === '+' || e.key === '='
        ? KEY_STEP
        : e.key === '-' || e.key === '_'
          ? 1 / KEY_STEP
          : 0;
    if (factor) {
      e.preventDefault();
      zoomAbout(stage, width / 2, height / 2, factor, minZoom(engine), MAX_ZOOM);
      return;
    }
    // The way back from anywhere — the same view the table opened on.
    if (e.key === '0') {
      e.preventDefault();
      fitMap(engine);
    }
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
  };
}
