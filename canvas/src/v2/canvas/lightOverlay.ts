import { Container, Graphics, Text } from 'pixi.js';
import { useStore } from '@/store/store';
import type { AnyChild, LightChild, MapBuilderStore } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { undoManager } from '@/store/undoManager';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { dashSpine } from '@dnd/core/src/engine/wallNodeRenderer';
import { setLightFields } from '@dnd/core/src/store/lightCommands';
import { LIGHT_RADIUS_FT } from '@dnd/core/src/store/lightPresets';
import { cursorWorldPosition } from '@/canvas/cursorPosition';
import { clampFt, coneOf, soleLight, toFt } from '../editor/lightModel';
import { overlayLayers } from './roomOverlay';

/*
 * The v2 editor's light overlay (board 8): what a DM needs to shape a light by hand.
 * Editor only (this file lives in the canvas package; the table never draws it).
 *
 *  - The selected light: its bright and dim rings in ink with a paper halo, a square handle
 *    on each ring's east point, and the distance each reads in feet beside it. A cone draws
 *    the lit arc of each ring solid and the rest dotted, the wedge's two edges, and a round
 *    direction handle on a stem past the dim ring. A darkness source is one dashed ring with
 *    one handle.
 *  - The Light tool in hand: faint dashed rings of the next light, following the pointer.
 *
 * Built like the prop overlay (propOverlay.ts): one root in the engine's screen-space overlay
 * with the world camera copied onto it every frame, drawn in world units, redrawn only when
 * its own keys move (the selected light, the tool, the next light's reach, the zoom once it
 * settles). The ghost follows the pointer by moving, never by redrawing, so a pointermove
 * that changes nothing costs nothing: `stats()` counts the redraws for the tests.
 */

const LINE_PX = 1.5;
const THIN_PX = 1;
const HALO_PX = 1;
const HALO_COLOR = 0xffffff;
const HALO_ALPHA = 0.45;
/** Half a square ring handle, px. */
const HANDLE_HALF = 4;
/** The direction knob: its radius, and its stem from just past the dim ring. */
const KNOB_R = 5;
const STEM_FROM_PX = 6;
const STEM_TO_PX = 30;
/** A press this close to a handle (px) takes it. */
const HIT_PX = 8;
const ZOOM_SETTLE_MS = 140;
/** Arc steps per full turn when an arc is cut into dashes. */
const ARC_STEPS = 128;

// ─── Model (pure) ──────────────────────────────────────────────────────────

export interface LightOverlayRing {
  /** Centre, world units. */
  x: number;
  y: number;
  /** Bright and dim edges, cells. */
  bright: number;
  dim: number;
  /** Degrees; null for a full circle. */
  cone: { angle: number; direction: number } | null;
  dark: boolean;
}

export interface LightOverlayModel {
  /** The light selected on its own, or null. */
  selected: (LightOverlayRing & { id: string }) | null;
  /** The next light's reach while the Light tool is in hand (drawn at the pointer), or null. */
  ghost: { bright: number; dim: number; dark: boolean } | null;
}

function ringOf(light: LightChild): LightOverlayRing {
  const cone = coneOf(light);
  return {
    x: light.position.x,
    y: light.position.y,
    bright: light.featherRadius,
    dim: light.radius,
    cone: cone.angle >= 360 ? null : cone,
    dark: !!light.darkness,
  };
}

/** What the overlay draws for `state`. Pure: no Pixi, no engine. */
export function lightOverlayModel(state: MapBuilderStore): LightOverlayModel {
  const sole = soleLight(state);
  const shown = sole && overlayLayers(state).some((l) => l.id === sole.layer.id) && sole.light.visible !== false;
  const d = state.tools.settings.lightDefaults;
  return {
    selected: shown ? { id: sole.light.id, ...ringOf(sole.light) } : null,
    ghost: state.tools.activeTool === 'light' ? { bright: d.featherRadius, dim: d.radius, dark: !!d.darkness } : null,
  };
}

/** What a redraw depends on, by identity. Never `layers` itself, which any edit rewrites. */
function overlayKeys(s: MapBuilderStore): unknown[] {
  const sole = soleLight(s);
  return [
    sole?.light ?? null,
    s.tools.activeTool,
    s.tools.settings.lightDefaults,
    s.ui.activeLevelId,
    s.ui.solo,
    s.mapSettings.cellScale,
  ];
}

/** Where a ring handle or the direction knob sits, world units, at `zoom` px per unit. */
export function handlePoints(r: LightOverlayRing, zoom: number) {
  const knob = r.cone
    ? (() => {
        const a = (r.cone.direction * Math.PI) / 180;
        const reach = r.dim + STEM_TO_PX / zoom;
        return { x: r.x + reach * Math.cos(a), y: r.y + reach * Math.sin(a) };
      })()
    : null;
  return {
    bright: r.dark ? null : { x: r.x + r.bright, y: r.y },
    dim: { x: r.x + r.dim, y: r.y },
    knob,
  };
}

export type LightHandle = 'bright' | 'dim' | 'direction';

/** The handle under world point `p` for the selected ring, or null. */
export function handleAt(r: LightOverlayRing, p: { x: number; y: number }, zoom: number): LightHandle | null {
  const h = handlePoints(r, zoom);
  const near = (q: { x: number; y: number } | null) => !!q && Math.hypot(q.x - p.x, q.y - p.y) * zoom <= HIT_PX;
  if (near(h.knob)) return 'direction';
  // Equal radii: the dim handle answers (it is drawn on top).
  if (near(h.dim)) return 'dim';
  if (near(h.bright)) return 'bright';
  return null;
}

/**
 * The light fields a drag of `handle` to world point `p` writes, in feet steps for the
 * rings (bright never passes dim: either drags the other with it) and whole degrees for
 * the direction.
 */
export function dragPatch(
  light: LightChild,
  handle: LightHandle,
  p: { x: number; y: number },
  ftPerCell: number,
): Partial<LightChild> {
  const dx = p.x - light.position.x;
  const dy = p.y - light.position.y;
  if (handle === 'direction') {
    const cone = coneOf(light);
    const deg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    return { cone: { angle: cone.angle, direction: ((deg % 360) + 360) % 360 } };
  }
  const ft = clampFt(Math.hypot(dx, dy) * ftPerCell, LIGHT_RADIUS_FT);
  const cells = ft / ftPerCell;
  const bright = toFt(light.featherRadius, ftPerCell);
  const dim = toFt(light.radius, ftPerCell);
  if (handle === 'bright') return ft > dim ? { featherRadius: cells, radius: cells } : { featherRadius: cells };
  // A darkness source's one handle keeps equal edges equal.
  if (light.darkness && bright === dim) return { radius: cells, featherRadius: cells };
  return ft < bright ? { radius: cells, featherRadius: cells } : { radius: cells };
}

// ─── Drawing ───────────────────────────────────────────────────────────────

function hexToNum(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

function palette(): { ink: number; paper: number; key: string } {
  const desk = getEditorDesk();
  const ink = desk?.ink ?? '#1b1b1b';
  const paper = desk?.sheet ?? '#fbfbfb';
  return { ink: hexToNum(ink, 0x1b1b1b), paper: hexToNum(paper, 0xfbfbfb), key: `${ink}${paper}` };
}

/** Points along an arc, degrees clockwise from east. */
function arcPoints(x: number, y: number, r: number, a0: number, a1: number): [number, number][] {
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / 360) * ARC_STEPS));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return out;
}

function polyline(g: Graphics, pts: [number, number][]): void {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
}

/** Counters for the performance contract. */
export interface LightOverlayStats {
  redraws: number;
  /** Wall-clock ms spent in redraws, summed. */
  ms: number;
}

export interface LightOverlayHandle {
  destroy(): void;
  /** A press at canvas px (sx, sy): true when a ring or direction handle took it. */
  pressAt(sx: number, sy: number): boolean;
  stats(): LightOverlayStats;
}

function makeChip(): { root: Container; bg: Graphics; text: Text } {
  const root = new Container();
  const bg = new Graphics();
  const text = new Text({ text: '', style: { fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 11, fill: 0x1b1b1b } });
  text.position.set(6, 1);
  root.addChild(bg, text);
  return { root, bg, text };
}

/**
 * Mount the light overlay over the engine's world and keep it in step with the store.
 * Call once from the canvas host in the v2 editor; `destroy` on teardown.
 */
export function mountLightOverlay(engine: RenderEngine): LightOverlayHandle {
  const root = new Container();
  root.label = 'lightOverlay';
  root.eventMode = 'none';
  const lines = new Graphics();
  const ghost = new Graphics();
  const marks = new Container();
  const handles = new Graphics();
  const chips = [makeChip(), makeChip()];
  marks.addChild(handles, chips[0].root, chips[1].root);
  root.addChild(lines, ghost, marks);
  engine.overlay().addChild(root);
  const stats: LightOverlayStats = { redraws: 0, ms: 0 };

  const follow = (): void => {
    const world = engine.stage();
    if (root.position.x !== world.position.x || root.position.y !== world.position.y) root.position.copyFrom(world.position);
    if (root.scale.x !== world.scale.x || root.scale.y !== world.scale.y) root.scale.copyFrom(world.scale);
  };
  follow();
  const ticker = engine.ticker?.();
  ticker?.add(follow);

  const zoomNow = (): number => engine.stage().scale.x || 20;
  let settledZoom = zoomNow();
  let lastZoom = settledZoom;
  let zoomMovedAt = 0;
  let dirty = true;
  let pal = palette();
  let model: LightOverlayModel = { selected: null, ghost: null };

  /** Handles and chips are drawn in px about their own origin and placed in world units. */
  const placeMarks = (zoom: number): void => {
    const sel = model.selected;
    marks.visible = !!sel;
    if (!sel) return;
    const h = handlePoints(sel, zoom);
    marks.position.set(sel.x, sel.y);
    marks.scale.set(1 / zoom);
    handles.clear();
    const square = (p: { x: number; y: number } | null) => {
      if (!p) return;
      const sx = (p.x - sel.x) * zoom;
      const sy = (p.y - sel.y) * zoom;
      handles.rect(sx - HANDLE_HALF, sy - HANDLE_HALF, 2 * HANDLE_HALF, 2 * HANDLE_HALF).fill({ color: 0xffffff }).stroke({ color: pal.ink, width: 1.3 });
    };
    square(h.bright);
    square(h.dim);
    if (h.knob) {
      handles.circle((h.knob.x - sel.x) * zoom, (h.knob.y - sel.y) * zoom, KNOB_R).fill({ color: 0xffffff }).stroke({ color: pal.ink, width: 1.3 });
    }
    // The distances, beside each ring's handle.
    const ftPerCell = useStore.getState().mapSettings.cellScale.value || 5;
    const readouts = sel.dark ? [sel.dim] : [sel.bright, sel.dim];
    chips.forEach((c, i) => {
      const r = readouts[i];
      c.root.visible = r !== undefined && !(i === 1 && readouts[0] === r);
      if (!c.root.visible) return;
      c.text.text = `${toFt(r, ftPerCell)} ft`;
      const w = c.text.width + 12;
      c.bg.clear().roundRect(0, 0, w, 18, 4).fill({ color: 0xffffff, alpha: 0.94 }).stroke({ color: pal.ink, width: 1, alpha: 0.25 });
      c.text.style.fill = pal.ink;
      c.root.position.set(r * zoom + 6, -30);
    });
  };

  const inked = (draw: () => void, width: number, alpha = 1): void => {
    const zoom = settledZoom;
    draw();
    lines.stroke({ color: HALO_COLOR, width: (width + 2 * HALO_PX) / zoom, alpha: HALO_ALPHA });
    draw();
    lines.stroke({ color: pal.ink, width: width / zoom, alpha });
  };

  const drawSelected = (sel: LightOverlayRing): void => {
    const zoom = settledZoom;
    const { x, y } = sel;
    if (sel.dark) {
      const pts = arcPoints(x, y, sel.dim, 0, 360);
      inked(() => dashSpine(lines, pts, 5 / zoom, 4 / zoom), LINE_PX);
      return;
    }
    if (!sel.cone) {
      for (const r of [sel.bright, sel.dim]) {
        if (r <= 0) continue;
        inked(() => lines.circle(x, y, r), LINE_PX);
      }
      return;
    }
    const a0 = sel.cone.direction - sel.cone.angle / 2;
    const a1 = sel.cone.direction + sel.cone.angle / 2;
    for (const r of [sel.bright, sel.dim]) {
      if (r <= 0) continue;
      const rest = arcPoints(x, y, r, a1, a0 + 360);
      inked(() => dashSpine(lines, rest, 1.5 / zoom, 4 / zoom), THIN_PX, 0.55);
      inked(() => polyline(lines, arcPoints(x, y, r, a0, a1)), LINE_PX);
    }
    const edge = (deg: number): [number, number][] => {
      const a = (deg * Math.PI) / 180;
      return [
        [x, y],
        [x + sel.dim * Math.cos(a), y + sel.dim * Math.sin(a)],
      ];
    };
    inked(() => {
      polyline(lines, edge(a0));
      polyline(lines, edge(a1));
    }, THIN_PX);
    const a = (sel.cone.direction * Math.PI) / 180;
    const from = sel.dim + STEM_FROM_PX / zoom;
    const to = sel.dim + (STEM_TO_PX - KNOB_R) / zoom;
    inked(() => polyline(lines, [
      [x + from * Math.cos(a), y + from * Math.sin(a)],
      [x + to * Math.cos(a), y + to * Math.sin(a)],
    ]), THIN_PX);
  };

  const drawGhost = (g: NonNullable<LightOverlayModel['ghost']>): void => {
    const zoom = settledZoom;
    ghost.clear();
    for (const r of g.dark ? [g.dim] : [g.bright, g.dim]) {
      if (r <= 0) continue;
      const pts = arcPoints(0, 0, r, 0, 360);
      dashSpine(ghost, pts, 4 / zoom, 4 / zoom);
      ghost.stroke({ color: HALO_COLOR, width: (THIN_PX + 2 * HALO_PX) / zoom, alpha: HALO_ALPHA });
      dashSpine(ghost, pts, 4 / zoom, 4 / zoom);
      ghost.stroke({ color: pal.ink, width: THIN_PX / zoom, alpha: 1 });
    }
    ghost.alpha = 0.55;
  };

  const redraw = (): void => {
    const started = performance.now();
    stats.redraws++;
    pal = palette();
    model = lightOverlayModel(useStore.getState());
    lines.clear();
    if (model.selected) drawSelected(model.selected);
    if (model.ghost) drawGhost(model.ghost);
    else ghost.clear();
    placeMarks(zoomNow());
    stats.ms += performance.now() - started;
  };

  const unsubscribe = useStore.subscribe(overlayKeys, () => {
    dirty = true;
  }, {
    equalityFn: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });

  /** The ghost sits under the pointer: a move, never a redraw. */
  const placeGhost = (): void => {
    const at = cursorWorldPosition.current;
    ghost.visible = !!model.ghost && !!at;
    if (ghost.visible && at && (ghost.position.x !== at.x || ghost.position.y !== at.y)) ghost.position.set(at.x, at.y);
  };

  let rafId = 0;
  const tick = (): void => {
    rafId = requestAnimationFrame(tick);
    if (!ticker) follow();
    const zoom = zoomNow();
    const now = performance.now();
    if (zoom !== lastZoom) {
      // Mid-zoom the handles stay screen-sized (a re-place, not a redraw).
      lastZoom = zoom;
      zoomMovedAt = now;
      placeMarks(zoom);
    } else if (zoom !== settledZoom && now - zoomMovedAt >= ZOOM_SETTLE_MS) {
      settledZoom = zoom;
      dirty = true;
    }
    if (palette().key !== pal.key) dirty = true;
    if (dirty) {
      dirty = false;
      redraw();
    }
    placeGhost();
  };
  tick();

  // ── Dragging a handle ─────────────────────────────────────
  let drag: { handle: LightHandle; layerId: string; id: string; before: Partial<LightChild> } | null = null;

  const worldAt = (e: PointerEvent): { x: number; y: number } => {
    const rect = engine.canvas().getBoundingClientRect();
    return engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  const liveLight = (): LightChild | null => {
    if (!drag) return null;
    const layer = useStore.getState().layers.find((l) => l.id === drag!.layerId);
    const c = layer && layer.type === 'dungeon' ? layer.children.find((x) => x.id === drag!.id) : undefined;
    return c && c.childType === 'light' ? c : null;
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    e.stopPropagation();
    const light = liveLight();
    if (!light) return;
    const patch = dragPatch(light, drag.handle, worldAt(e), useStore.getState().mapSettings.cellScale.value || 5);
    for (const k of Object.keys(patch) as (keyof LightChild)[]) {
      if (!(k in drag.before)) (drag.before as Record<string, unknown>)[k] = structuredClone(light[k]);
    }
    useStore.getState().updateChild(drag.layerId, drag.id, patch as Partial<AnyChild>);
  };

  const finish = (e: PointerEvent | null): void => {
    if (!drag) return;
    e?.stopPropagation();
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    const { before, layerId, id, handle } = drag;
    drag = null;
    const light = liveLight() ?? (() => {
      const layer = useStore.getState().layers.find((l) => l.id === layerId);
      const c = layer && layer.type === 'dungeon' ? layer.children.find((x) => x.id === id) : undefined;
      return c && c.childType === 'light' ? c : null;
    })();
    if (!light || Object.keys(before).length === 0) return;
    const after: Partial<LightChild> = {};
    for (const k of Object.keys(before) as (keyof LightChild)[]) (after as Record<string, unknown>)[k] = light[k];
    // The store shows the drag's end; put the start back and land the whole drag as one step.
    useStore.getState().updateChild(layerId, id, before as Partial<AnyChild>);
    if (e === null || JSON.stringify(after) === JSON.stringify(before)) return;
    const cmd = setLightFields(id, after, before, handle === 'direction' ? 'Light direction' : handle === 'bright' ? 'Light bright' : 'Light dim');
    if (cmd) undoManager.execute(cmd);
  };
  const onUp = (e: PointerEvent): void => finish(e);
  const onCancel = (): void => finish(null);

  const pressAt = (sx: number, sy: number): boolean => {
    const sel = model.selected;
    if (!sel || drag) return false;
    const state = useStore.getState();
    if (state.tools.activeTool !== 'select') return false;
    const handle = handleAt(sel, engine.screenToWorld(sx, sy), zoomNow());
    if (!handle) return false;
    const sole = soleLight(state);
    if (!sole) return false;
    drag = { handle, layerId: sole.layer.id, id: sole.light.id, before: {} };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return true;
  };

  return {
    stats: () => ({ ...stats }),
    pressAt,
    destroy() {
      finish(null);
      ticker?.remove(follow);
      cancelAnimationFrame(rafId);
      unsubscribe();
      root.destroy({ children: true });
    },
  };
}
