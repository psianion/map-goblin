// The editor's door marks — one glyph per door saying open or shut, over the map art.
//
// Parity with the table's own overlay (`session/client/src/modules/doors/DoorRenderer.ts`):
// same lucide glyphs, same 0.75-world-unit height, same parchment/gold reading. What differs
// is the source — the editor draws the *authored* state straight off the map document, with no
// session to ask — and the mount: this is opt-in, so the table's `GameRenderer` never gets a
// second set of marks on top of its own.

import { Container, Sprite } from 'pixi.js';
import type { RenderEngine } from './RenderEngine';
import { lucideTexture } from './lucideIcons';
import { resolveDoors, resolveWalls } from '../shared/wallResolve';
import { useStore } from '../store/store';
import { isLayerEffectivelyVisible } from '../store/selectors';

/** Glyph height in world units, and the raster size behind it — both the table's numbers. */
const GLYPH_WU = 0.75;
const GLYPH_PX = 48;

/** Parchment for an ordinary door, gold for a secret one — `doorLook`'s two colours. */
const PARCHMENT = 0xe0d6c3;
const SECRET = 0xe0b252;

/**
 * Mounts the door marks and returns the unmount. Canvas-only: nothing in core calls this,
 * so a surface that doesn't ask for it renders exactly as it did.
 *
 * The marks live in the screen overlay and mirror the camera by hand, the same trick the
 * table's overlay uses: the lighting composite is a screen-space sprite, and no world-space
 * child can sort above it — a mark drawn in the world would be multiplied down to nothing on
 * a night map, which is precisely when a DM needs to see which doors are shut.
 */
export function mountDoorIcons(engine: RenderEngine): () => void {
  const layer = new Container();
  layer.label = 'doorIcons';
  layer.eventMode = 'none';
  engine.overlay().addChild(layer);

  const world = engine.stage();
  /** One reused sprite per door; stale ones are reaped on the redraw that drops them. */
  const glyphs = new Map<string, Sprite>();

  const draw = (): void => {
    const state = useStore.getState();
    const drawn = new Set<string>();
    for (const layerState of state.layers) {
      if (layerState.type !== 'dungeon' || !isLayerEffectivelyVisible(state, layerState)) continue;
      for (const { door, position } of resolveDoors(layerState, resolveWalls(layerState))) {
        // An archway is a hole in a wall: nothing to open or shut, so no mark — the same
        // drop the table makes, for the same reason.
        if (door.style === 'archway' || !door.visible) continue;
        let glyph = glyphs.get(door.id);
        if (!glyph) {
          glyph = new Sprite();
          glyph.anchor.set(0.5);
          layer.addChild(glyph);
          glyphs.set(door.id, glyph);
        }
        drawn.add(door.id);
        // A locked door is a shut door with a key in it — it reads as closed.
        glyph.texture = lucideTexture(door.state === 'open' ? 'door-open' : 'door-closed', GLYPH_PX);
        glyph.setSize(GLYPH_WU);
        // The *resolved* position: a floor-ring door draws where the resolver projects it,
        // not where it was authored, and the mark has to land on the art.
        glyph.position.set(position[0], position[1]);
        glyph.tint = door.isSecret ? SECRET : PARCHMENT;
      }
    }
    for (const [id, glyph] of glyphs) {
      if (drawn.has(id)) continue;
      glyph.destroy();
      glyphs.delete(id);
    }
  };

  // Redraw guard: every input above lives in `layers` or in the solo flag, and the store
  // replaces both wholesale on any edit — so an idle editor costs two reference compares a
  // frame instead of a resolve plus a sprite walk per door.
  let lastLayers: unknown = null;
  let lastSolo: unknown = null;
  const tick = (): void => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    const state = useStore.getState();
    if (state.layers === lastLayers && state.ui.solo === lastSolo) return;
    lastLayers = state.layers;
    lastSolo = state.ui.solo;
    draw();
  };
  tick();

  const ticker = engine.ticker();
  ticker.add(tick);
  return () => {
    ticker.remove(tick);
    try {
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

// ponytail: a secret door reads as gold tint only — no star badge like the table's. Add one
// if colour alone turns out to be missable at play zoom.
