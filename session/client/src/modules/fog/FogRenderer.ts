// §2.4.1 / D10 — the *player's* fog. One mask over the whole map, rebuilt only when the
// fog, the doors or the party's rooms move.
//
// Three states, and the art guide decides what each looks like. A room nobody has entered
// — and every scrap of unzoned map (D6) — is pure black: the guide's dungeon negative
// space, not a grey wash, and black is also the only colour that survives the lighting
// pass unchanged, so a never-revealed room cannot be teased out by turning a monitor up.
// A room the party has seen but cannot see now is a memory: desaturated, about a third of
// its lit brightness, and marked with the same "explored" tick the DM's overlay draws, so
// the state reads on a bad panel in a dim room without leaning on colour. A room they can
// see is simply not drawn on.
//
// Where this sits is load-bearing. The engine composites lighting as a screen-space
// multiply *after* the world container (LightingRenderer adds its sprite to
// `engine.overlay()`), and this map's ambient is #0d0e12 — multiplying by that erases any
// world-space wash short of black. So the fog mounts above that composite and mirrors the
// camera instead, which is what D12 asks for in the first place: the lighting is composited
// *beneath* the fog, never recomputed for it. A revealed room fades from black to a
// finished torchlit room, never to a flat one that lights up a beat later.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Graphics } from 'pixi.js';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { useStore } from '@dnd/core/src/store/store';
import { computeMapWorldBounds } from '@dnd/core/src/engine/export/exportPipeline';
import type { AuthoredDoor, DoorLiveState } from '@dnd/mechanics/doors';
import { visibleRooms, type FogState, type SceneFog } from '@dnd/mechanics/fog';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { addScreenOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { prefersReducedMotion } from '../../session/motion';
import { useSessionStore } from '../../session/store';
import type { LiveDoor } from '../doors/doors';
import { liveSceneDoors } from '../doors/DoorRenderer';
import { tokensOf } from '../tokens/TokenRenderer';
import { roomAt, roomFog, roomsOfLayers, sceneFog } from './fog';

/** What the player's canvas does with one room. */
export type RoomView = 'visible' | 'explored' | 'dark';

/** D10 — the one deliberately slow beat in the product. A play beat, not decoration. */
export const REVEAL_MS = 300;

/** Art guide §5: dungeon negative space is pure black, never a grey wash. */
export const FOG_BLACK = 0x000000;
/** Cold slate: the desaturating half of the explored look, pulling warm torchlight out. */
export const EXPLORED_TINT = 0x2c313b;
export const EXPLORED_TINT_ALPHA = 0.62;
/** The brightness half — roughly a third of the lit render comes through. */
export const EXPLORED_SHADE_ALPHA = 0.4;
/** Warm parchment, quiet: the mark that says "you have been here" without colour. */
export const EXPLORED_GLYPH_COLOR = 0xd8cfc0;

/** Black extends this far past the map so the edge of the world is not a tell. */
const BOUNDS_PAD = 20;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FogScene {
  rooms: Room[];
  views: Map<string, RoomView>;
  /** null when there is no geometry yet — the layer draws nothing rather than guessing. */
  bounds: Bounds | null;
  sceneId: string | null;
  /** The DM keeps full lighting and no mask (PRODUCT principle 3). Unknown role ⇒ masked. */
  isPlayer: boolean;
}

/**
 * D3's two layers, resolved per room. `visibleRooms` is the mechanics module's — the same
 * pure function the server redacts with, so the canvas and the referee cannot disagree.
 * Everything else the party has ever seen is explored; everything left is black.
 */
export function roomViews(
  rooms: readonly Room[],
  fog: SceneFog,
  doors: readonly LiveDoor[],
  partyRooms: readonly string[],
): Map<string, RoomView> {
  const live: Record<string, DoorLiveState> = {};
  const graph: AuthoredDoor[] = [];
  for (const entry of doors) {
    live[entry.door.id] = entry.live;
    graph.push(entry.door);
  }

  const visible = visibleRooms(fog, live, graph, partyRooms);
  const views = new Map<string, RoomView>();
  for (const room of rooms) {
    views.set(
      room.id,
      visible.has(room.id)
        ? 'visible'
        : roomFog(fog, room.id).wasEverRevealed
          ? 'explored'
          : 'dark',
    );
  }
  return views;
}

/**
 * Where the party is standing, for D3's reachability BFS. A claimed token is a player at
 * the table; an unclaimed one is scenery the DM moves. D7 needs no special case here — a
 * player's own claimed token is always in their tokens slice, so it always counts.
 */
export function partyRoomIds(tokens: readonly Token[], rooms: readonly Room[]): string[] {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (!token.ownerId || token.hidden) continue;
    const room = roomAt(rooms, token.x, token.y);
    if (room) ids.add(room.id);
  }
  return [...ids];
}

/**
 * The rooms that just became visible, and the look they are fading *from*.
 *
 * `prev === null` is a first paint — joining mid-session, or a scene change — and fades
 * nothing: the drama belongs to the reveal the DM just performed, not to arriving at a
 * table that is already lit. A room absent from `prev` fades from black, because that is
 * what it was: its geometry only arrived with the reveal delta (D5).
 */
export function revealsBetween(
  prev: ReadonlyMap<string, RoomView> | null,
  next: ReadonlyMap<string, RoomView>,
): Map<string, RoomView> {
  const reveals = new Map<string, RoomView>();
  if (!prev) return reveals;
  for (const [id, view] of next) {
    if (view !== 'visible') continue;
    const before = prev.get(id) ?? 'dark';
    if (before !== 'visible') reveals.set(id, before);
  }
  return reveals;
}

/** How long a reveal takes on this machine. Reduced motion ⇒ a cut, per PRODUCT §A11y. */
export const revealDurationMs = (): number => (prefersReducedMotion() ? 0 : REVEAL_MS);

/** Ease-out quart. No bounce, no elastic — the room settles, it does not spring. */
export const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;

/**
 * The map's footprint plus a margin, or null when there is nothing to cover.
 *
 * No rooms means no fog: room-granular fog needs rooms, so the server leaves an unzoned
 * layer whole for players (D6, `redactMapForViewer`) and there is nothing here to hide.
 * That is also the guard against blacking out a 10x10 square of empty canvas while the map
 * is still in flight — core's bounds fall back to one rather than reporting nothing.
 */
export function fogBounds(layers: readonly Layer[], rooms: readonly Room[]): Bounds | null {
  if (rooms.length === 0) return null;

  // A player's copy has no mergedFloor until core rebuilds it (redactMap ships it null), so
  // the room polygons are the only bounds that exist on the first frame after a reveal.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const room of rooms) {
    for (const [x, y] of room.boundary) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const map = computeMapWorldBounds(layers as Layer[]);
  return {
    minX: Math.min(minX, map.minX) - BOUNDS_PAD,
    minY: Math.min(minY, map.minY) - BOUNDS_PAD,
    maxX: Math.max(maxX, map.maxX) + BOUNDS_PAD,
    maxY: Math.max(maxY, map.maxY) + BOUNDS_PAD,
  };
}

/** Everything the fog draws from, read once per mutation. */
export function fogScene(): FogScene {
  const { session, you } = useSessionStore.getState();
  const sceneId = session?.activeSceneId ?? null;
  const layers = useStore.getState().layers;
  const rooms = roomsOfLayers(layers);
  const fog = sceneFog(session?.modules?.fog as FogState | undefined, sceneId);
  const tokens = tokensOf(session?.modules?.tokens as TokensState | undefined, sceneId);

  return {
    rooms,
    // liveSceneDoors is the doors layer's own reading — one answer to "what are the doors
    // doing", so the mask cannot drift from the marks drawn on them.
    views: roomViews(rooms, fog, liveSceneDoors(), partyRoomIds(tokens, rooms)),
    bounds: fogBounds(layers, rooms),
    sceneId,
    isPlayer: you?.role !== 'dm',
  };
}

/**
 * Fires when anything the mask is built from changes, and once on subscribe. The session
 * store fires on every ping and the core store on every camera nudge; slice identity is
 * enough to tell those apart, because both stores replace slices wholesale (§2.5).
 */
export function subscribeFogScene(onChange: () => void): () => void {
  let last: unknown[] = [];
  const check = () => {
    const { session, you } = useSessionStore.getState();
    const next = [
      you?.role,
      session?.activeSceneId,
      session?.modules?.fog,
      session?.modules?.doors,
      session?.modules?.tokens,
      useStore.getState().layers,
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    onChange();
  };

  check();
  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  return () => {
    unsubSession();
    unsubMap();
  };
}

/**
 * The "you have been here" tick, at the room's centroid. Deliberately the same mark the
 * DM's overlay draws (FogOverlay) so both seats share one word for one state; seven lines
 * of duplication beats reaching into another lane's file to export it.
 */
function drawExploredGlyph(g: Graphics, [cx, cy]: [number, number]): void {
  const s = 0.34;
  g.moveTo(cx - s, cy);
  g.lineTo(cx - s * 0.25, cy + s * 0.62);
  g.lineTo(cx + s, cy - s * 0.62);
  g.stroke({ color: EXPLORED_GLYPH_COLOR, width: 0.11, alpha: 0.55, cap: 'round', join: 'round' });
}

/** One room's covering. Used for the steady mask and, unchanged, for the fade out of it. */
function paintRoom(g: Graphics, room: Room, view: RoomView): void {
  if (room.boundary.length < 3) return;
  const path = room.boundary.flat();
  if (view === 'dark') {
    g.poly(path).fill({ color: FOG_BLACK, alpha: 1 });
    return;
  }
  if (view !== 'explored') return;
  g.poly(path).fill({ color: EXPLORED_TINT, alpha: EXPLORED_TINT_ALPHA });
  g.poly(path).fill({ color: FOG_BLACK, alpha: EXPLORED_SHADE_ALPHA });
  drawExploredGlyph(g, room.centroid);
}

/**
 * The mask itself: one black fill over the map with a hole cut for every room the player
 * may see at all, then the explored wash inside the holes that are only memories. `cut`
 * hangs each hole off that single fill, so the whole of "what is dark" is one shape.
 */
export function drawFog(scrim: Graphics, scene: FogScene): void {
  scrim.clear();
  if (!scene.isPlayer || !scene.bounds) return;

  const { minX, minY, maxX, maxY } = scene.bounds;
  scrim.rect(minX, minY, maxX - minX, maxY - minY).fill({ color: FOG_BLACK, alpha: 1 });
  for (const room of scene.rooms) {
    if (room.boundary.length < 3) continue;
    if (scene.views.get(room.id) === 'dark') continue;
    scrim.poly(room.boundary.flat()).cut();
  }
  for (const room of scene.rooms) {
    if (scene.views.get(room.id) === 'explored') paintRoom(scrim, room, 'explored');
  }
}

interface Fade {
  graphic: Graphics;
  startedAt: number;
}

function mountPlayerFog(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const scrim = new Graphics();
  const fadeLayer = new Container();
  layer.addChild(scrim, fadeLayer);
  // Nothing here is clickable; the fog tool and the doors read the DOM canvas directly.
  layer.eventMode = 'none';
  addScreenOverlay(sceneGraph, layer, 'playerFog');

  const world = sceneGraph.worldContainer;
  const fades: Fade[] = [];
  let views: Map<string, RoomView> | null = null;
  let sceneId: string | null = null;

  const clearFades = (): void => {
    for (const fade of fades) fade.graphic.destroy();
    fades.length = 0;
  };

  const rebuild = (): void => {
    const scene = fogScene();
    // A different map is a different set of rooms; nothing carries over, and the first
    // paint of a scene is never a reveal.
    if (scene.sceneId !== sceneId) {
      sceneId = scene.sceneId;
      views = null;
      clearFades();
    }

    layer.visible = scene.isPlayer;
    drawFog(scrim, scene);

    // Reduced motion cuts instead of fading, so it simply never starts one.
    if (scene.isPlayer && revealDurationMs() > 0) {
      const roomById = new Map(scene.rooms.map((room) => [room.id, room]));
      for (const [roomId, before] of revealsBetween(views, scene.views)) {
        const room = roomById.get(roomId);
        if (!room) continue;
        const graphic = new Graphics();
        paintRoom(graphic, room, before);
        fadeLayer.addChild(graphic);
        fades.push({ graphic, startedAt: performance.now() });
      }
    }
    views = scene.views;
  };

  // Per frame: mirror the camera (the layer lives in screen space, above the lighting
  // composite) and advance any fade. No geometry is touched — the mask is rebuilt on
  // mutation and then simply drawn, which is what keeps the 60fps gate comfortable.
  const tick = (): void => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    if (fades.length === 0) return;
    const now = performance.now();
    for (let i = fades.length - 1; i >= 0; i--) {
      const t = (now - fades[i].startedAt) / REVEAL_MS;
      if (t >= 1) {
        fades[i].graphic.destroy();
        fades.splice(i, 1);
        continue;
      }
      fades[i].graphic.alpha = 1 - easeOutQuart(t);
    }
  };

  const ticker = engine.ticker();
  ticker.add(tick);
  const unsubscribe = subscribeFogScene(rebuild);

  return () => {
    ticker.remove(tick);
    unsubscribe();
    // The engine may already be gone (GameRenderer unmounting first) — its objects are
    // destroyed and touching them throws.
    try {
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountPlayerFogWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountPlayerFog, pollMs);
