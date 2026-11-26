// Light group links, shown: selecting a light prop or a grouped light outlines every other
// member of its group (a prop by its box, a free light by its marker), dashed, in the overlay's
// ink with a paper halo; hovering one with Select draws the same outlines fainter, a preview of
// what a double-click switches. Members on another level are counted, not drawn: "+2 on other
// levels". Nothing is drawn while nothing grouped is selected or hovered, and it reads the
// map's own data, so it works the same with View > Light icons off.
//
// A group switches together; it never moves together (that is what attaching a light is for),
// so this only says which lights a switch reaches.
//
// It also draws the object a right-click "Pick from here" row points at (`pickHighlight.ts`):
// a solid outline in the same ink and halo, so a DM sees which of a stack the row means.

import { Container, Graphics, Text } from 'pixi.js';
import { useStore } from '@/store/store';
import type { MapBuilderStore } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { dashSpine } from '@dnd/core/src/engine/wallNodeRenderer';
import { elsewhereLabel, linkModel, linkSource, outlineRing, pickOutline } from './linkModel';
import { getPickHighlight, subscribePickHighlight } from './pickHighlight';

// ─── Drawing ───────────────────────────────────────────────────────────────

const LINE_PX = 1.25;
const HALO_PX = 1;
const HOVER_ALPHA = 0.45;
const ZOOM_SETTLE_MS = 140;

function palette(): { ink: number; paper: number } {
  const desk = getEditorDesk();
  const hex = (h: string | undefined, f: number) => (h ? parseInt(h.replace('#', ''), 16) : f);
  return { ink: hex(desk?.ink, 0x1b1b1b), paper: hex(desk?.sheet, 0xfbfbfb) };
}

export interface LinkOverlayHandle {
  destroy(): void;
  stats(): { redraws: number };
}

/** Mount the link overlay over the engine's world; `destroy` on teardown. */
export function mountLinkOverlay(engine: RenderEngine): LinkOverlayHandle {
  const root = new Container();
  root.label = 'linkOverlay';
  root.eventMode = 'none';
  const lines = new Graphics();
  const chip = new Container();
  const chipBg = new Graphics();
  const chipText = new Text({ text: '', style: { fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 11, fill: 0x1b1b1b } });
  chipText.position.set(6, 1);
  chip.addChild(chipBg, chipText);
  root.addChild(lines, chip);
  engine.overlay().addChild(root);
  const stats = { redraws: 0 };

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

  const redraw = (): void => {
    stats.redraws++;
    lines.clear();
    chip.visible = false;
    const state = useStore.getState() as MapBuilderStore;
    const zoom = settledZoom;
    const pal = palette();
    // The pick row's object: solid, so it never reads as a group link.
    const picked = getPickHighlight();
    if (picked) {
      for (const ring of pickOutline(state, picked, 4 / zoom)) {
        lines.poly(ring.flat(), false);
        lines.stroke({ color: pal.paper, width: (LINE_PX + 1 + 2 * HALO_PX) / zoom, alpha: 0.7 });
        lines.poly(ring.flat(), false);
        lines.stroke({ color: pal.ink, width: (LINE_PX + 1) / zoom });
      }
    }
    const source = linkSource(state);
    const model = source ? linkModel(state, source.id) : null;
    if (!source || !model) return;
    const alpha = source.hover ? HOVER_ALPHA : 1;
    const pad = 4 / zoom;
    for (const o of model.shown) {
      const pts = outlineRing(o, pad);
      dashSpine(lines, pts, 5 / zoom, 4 / zoom);
      lines.stroke({ color: pal.paper, width: (LINE_PX + 2 * HALO_PX) / zoom, alpha: 0.6 * alpha });
      dashSpine(lines, pts, 5 / zoom, 4 / zoom);
      lines.stroke({ color: pal.ink, width: LINE_PX / zoom, alpha });
    }
    const label = elsewhereLabel(model.elsewhere);
    const at = state.layers.flatMap((l) => (l.type === 'dungeon' ? l.children : [])).find((c) => c.id === source.id);
    if (label && at && 'position' in at && !Array.isArray(at.position)) {
      chipText.text = label;
      chipText.style.fill = pal.ink;
      const w = chipText.width + 12;
      chipBg.clear().roundRect(0, 0, w, 18, 4).fill({ color: pal.paper, alpha: 0.94 }).stroke({ color: pal.ink, width: 1, alpha: 0.25 });
      chip.position.set(at.position.x, at.position.y);
      chip.scale.set(1 / zoom);
      chip.pivot.set(-14, 30);
      chip.alpha = alpha;
      chip.visible = true;
    }
  };

  const keys = (s: MapBuilderStore): unknown[] => [s.selection.selectedIds, s.selection.hoveredId, s.tools.activeTool, s.layers, s.ui.activeLevelId, s.levels];
  const unsubscribe = useStore.subscribe(keys, () => {
    dirty = true;
  }, {
    equalityFn: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });

  const unsubscribePick = subscribePickHighlight(() => {
    dirty = true;
  });

  let rafId = 0;
  const tick = (): void => {
    rafId = requestAnimationFrame(tick);
    if (!ticker) follow();
    const zoom = zoomNow();
    const now = performance.now();
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      zoomMovedAt = now;
    } else if (zoom !== settledZoom && now - zoomMovedAt >= ZOOM_SETTLE_MS) {
      settledZoom = zoom;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      redraw();
    }
  };
  tick();

  return {
    stats: () => ({ ...stats }),
    destroy() {
      ticker?.remove(follow);
      cancelAnimationFrame(rafId);
      unsubscribe();
      unsubscribePick();
      root.destroy({ children: true });
    },
  };
}
