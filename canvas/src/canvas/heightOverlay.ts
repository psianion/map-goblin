import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import type { MapBuilderStore } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { useShell } from '@/editor/shell/shellStore';
import { levelDungeons } from '@/editor/models/roomModel';
import { heightFocus, levelHeights, ringRegions, type HeightFocus } from '@/editor/models/heightModel';
import type { WorldRect } from '@/editor/models/layerThumbs';

/*
 * The editor's height highlight: while a Heights card in the dock is hovered or kept, the
 * map outside that height is washed toward the sheet and the height's own rings are outlined
 * (for 0, the ground, every other height is washed instead). A view only: it reads the shell's
 * `heightHover` / `heightPin` and the level being edited, and writes nothing.
 *
 * Built like the selection overlay: one root in the engine's screen-space overlay, the world
 * camera copied onto it every frame, drawn in world units, redrawn when the shown height, the
 * level, the layers, the settled zoom or the desk colours change.
 */

const DIM_ALPHA = 0.6;
const OUTLINE_PX = 2;
const HALO_PX = 1;
const HALO_ALPHA = 0.45;

/** The height shown: the hovered card's, else the kept one's; null when neither is in use on the level. */
export function shownHeight(state: MapBuilderStore, hover: number | null, pin: number | null): number | null {
  const height = hover ?? pin;
  if (height === null) return null;
  return levelHeights(levelDungeons(state.layers, state.levels, state.ui.activeLevelId)).includes(height) ? height : null;
}

/**
 * Fills what `focus` dims within `frame`: outside its rings (the frame with the rings cut out,
 * the rings' holes filled back) or the rings themselves. One cut per fill, all of a fill's
 * holes in one path.
 */
export function fillHeightDim(g: Graphics, frame: WorldRect, focus: HeightFocus, color: number, alpha: number): void {
  const style = { color, alpha };
  const regions = ringRegions(focus.rings);
  if (focus.dim === 'outside') {
    g.rect(frame.minX, frame.minY, frame.maxX - frame.minX, frame.maxY - frame.minY).fill(style);
    if (regions.length > 0) {
      for (const { outer } of regions) g.poly(outer.flat(), true);
      g.cut();
    }
    for (const { holes } of regions) for (const h of holes) g.poly(h.flat(), true).fill(style);
    return;
  }
  for (const { outer, holes } of regions) {
    g.poly(outer.flat(), true).fill(style);
    if (holes.length === 0) continue;
    for (const h of holes) g.poly(h.flat(), true);
    g.cut();
  }
}

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

/** Mount the height highlight over the engine's world. Call once from the canvas host; `destroy` on teardown. */
export function mountHeightOverlay(engine: RenderEngine): { destroy(): void } {
  const root = new Container();
  root.label = 'heightOverlay';
  root.eventMode = 'none';
  const g = new Graphics();
  root.addChild(g);
  engine.overlay().addChild(root);

  const follow = (): void => {
    const world = engine.stage();
    if (root.position.x !== world.position.x || root.position.y !== world.position.y) root.position.copyFrom(world.position);
    if (root.scale.x !== world.scale.x || root.scale.y !== world.scale.y) root.scale.copyFrom(world.scale);
  };
  follow();
  const ticker = engine.ticker?.();
  ticker?.add(follow);

  const zoomNow = (): number => engine.stage().scale.x || 20;
  let dirty = true;
  let shown: number | null = null;
  let drawnZoom = 0;
  let pal = palette();

  const redraw = (): void => {
    g.clear();
    const state = useStore.getState();
    const { heightHover, heightPin } = useShell.getState();
    shown = shownHeight(state, heightHover, heightPin);
    if (shown === null) return;
    pal = palette();
    const zoom = (drawnZoom = zoomNow());
    const focus = heightFocus(levelDungeons(state.layers, state.levels, state.ui.activeLevelId), shown);
    fillHeightDim(g, computeMapWorldBounds(state.layers), focus, pal.paper, DIM_ALPHA);
    if (focus.dim !== 'outside' || focus.rings.length === 0) return;
    const trace = () => {
      for (const r of focus.rings) if (r.length >= 3) g.poly(r.flat(), true);
    };
    trace();
    g.stroke({ color: pal.paper, width: (OUTLINE_PX + 2 * HALO_PX) / zoom, alpha: HALO_ALPHA });
    trace();
    g.stroke({ color: pal.ink, width: OUTLINE_PX / zoom, alpha: 1 });
  };

  const unsubStore = useStore.subscribe((s, p) => {
    if (s.layers !== p.layers || s.levels !== p.levels || s.ui.activeLevelId !== p.ui.activeLevelId) dirty = true;
  });
  const unsubShell = useShell.subscribe((s, p) => {
    if (s.heightHover !== p.heightHover || s.heightPin !== p.heightPin) dirty = true;
  });

  let rafId = 0;
  const tick = (): void => {
    rafId = requestAnimationFrame(tick);
    if (!ticker) follow();
    // The outline keeps its screen width: redrawn at a new zoom, only while something is shown.
    if (shown !== null && (zoomNow() !== drawnZoom || palette().key !== pal.key)) dirty = true;
    if (dirty) {
      dirty = false;
      redraw();
    }
  };
  tick();

  return {
    destroy() {
      ticker?.remove(follow);
      cancelAnimationFrame(rafId);
      unsubStore();
      unsubShell();
      root.destroy({ children: true });
    },
  };
}
