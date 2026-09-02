// Where the runner's own Pixi layers live in the engine's world container, and how they
// get there. Everything the session draws on top of the authored map — fog tint, door
// state, tokens — is a session-state overlay, so none of it belongs in @dnd/core's scene
// graph; it is stacked above `layerContainer` from here instead.

import type { Container } from 'pixi.js';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';

/**
 * Bottom to top. Fog tint sits under everything the DM must never lose sight of: a hidden
 * token or a secret door in an unrevealed room renders at full opacity *over* the tint,
 * which is the whole of PRODUCT principle 3 expressed as a draw order.
 *
 * Layers place themselves by label, so mount order does not decide the stack — the panels
 * that mount them are ordered by what a DM wants to read, not by what must draw first.
 *
 * `tokenLayer` is under `playerFog` because a room a player cannot see hides its tokens:
 * that is the mask doing its job, and moving a token behind the dark must not leak where it
 * went.
 *
 * `doorOverlay` is over it so a door on a room boundary is readable at all — under the mask
 * it is ~95% covered by the scrim's own edge, which the doors-table redraw row measured as a
 * player canvas that did not move. Being over the mask is not permission to outrun it: this
 * layer wears `shownMask` (`shownMaskOf`), so a door mark reaches exactly as far as the map
 * does. Redaction is not that guarantee on its own — a room is shipped whole the moment any
 * of it is swept, so in vision mode a player can hold doors standing on ground their mask
 * still hides, and drawing those put two lit doors on an otherwise black canvas.
 *
 * Neither `playerFog` nor `doorOverlay` mounts into the world container. The engine
 * composites lighting as a screen-space multiply *after* the world, so a wash drawn in the
 * world is erased by a dark ambient; D12 wants the lighting composited *beneath* the fog.
 * Both therefore go through `addScreenOverlay` and mirror the camera themselves — a
 * world-space layer can never sort above a screen-space one, whatever this list says, so a
 * layer that must beat the fog has to be in the same container as the fog. They keep their
 * places here because this list is where "what draws over what" is decided.
 */
export const OVERLAY_STACK = [
  'fogOverlay',
  'playerFog',
  // Screen space, above the player's mask and the lighting multiply: a chip is a label, not
  // ground, and it reads at full strength wherever the seat can currently see — under
  // darkvision the floor goes grey and the chip does not. What keeps a token out of sight
  // hidden is the mask's own `sightMask` (`sightMaskOf`), which this layer wears on a
  // player's seat. In vision mode that stencil is LIVE sight only — a remembered room shows
  // what it looked like, never who is standing in it now. In rooms mode it also covers the
  // memory tier, because D7 lets a seat's own token stand in a room the DM has not lit and
  // that chip is theirs to see; a foreign token there never reaches the wire at all
  // (`tokens.redact`). `drawFog` is where both halves of that are written down.
  'tokenLayer',
  // Above the tokens it marks, so whose turn it is reads at the same strength as the token.
  'turnRing',
  // Screen space too, and wearing `shownMask` rather than `sightMask`: a door is map
  // information, not a live position. A remembered room shows its layout, doors included;
  // hidden ground shows no door. That is the one difference from the two layers above.
  'doorOverlay',
] as const;

export type OverlayLabel = (typeof OVERLAY_STACK)[number];

/** LightingRenderer's own label for its full-screen multiply sprite. */
const LIGHTING_COMPOSITE = 'lightingComposite';

/** Place `layer` among `parent`'s children by its `OVERLAY_STACK` rank, at `base` or above. */
function insertByRank(parent: Container, base: number, layer: Container, label: OverlayLabel): void {
  layer.label = label;
  const rank = OVERLAY_STACK.indexOf(label);

  // Land directly above the last overlay that belongs below this one; failing that, on
  // whatever `base` sits on. `addChildAt` pushes whatever sat there upwards, so overlays
  // that belong on top stay on top however late this one arrives.
  let index = base;
  for (let i = base; i < parent.children.length; i++) {
    const other = OVERLAY_STACK.indexOf(parent.children[i].label as OverlayLabel);
    if (other >= 0 && other < rank) index = i + 1;
  }
  parent.addChildAt(layer, index);
}

/** Add an overlay to the world container at its place in `OVERLAY_STACK`. */
export function addWorldOverlay(sceneGraph: SceneGraph, layer: Container, label: OverlayLabel): void {
  const world = sceneGraph.worldContainer;
  insertByRank(world, world.getChildIndex(sceneGraph.layerContainer) + 1, layer, label);
}

/**
 * Add an overlay to the screen-space container, above the lighting composite.
 *
 * Everything drawn *under* the lighting is there on purpose, because it is content the
 * lighting is supposed to fall on. The layers here are the opposite: the fog is what the
 * lighting is composited beneath (D12), and the door marks have to beat the fog. Both sit
 * above the multiply and below the map-switch transition, which stays the topmost thing on
 * the canvas — hence the same rank-ordered insert the world container uses, rather than
 * "last one mounted wins", which left the door/fog order up to panel mount order.
 *
 * The caller owns the camera: this container is not camera-transformed.
 */
export function addScreenOverlay(sceneGraph: SceneGraph, layer: Container, label: OverlayLabel): void {
  const overlay = sceneGraph.overlayContainer;
  // -1 when there is no lighting engine, which makes the base 0 — still below the
  // transition, and still rank-ordered against the other overlays.
  const lighting = overlay.children.findIndex((child) => child.label === LIGHTING_COMPOSITE);
  insertByRank(overlay, lighting + 1, layer, label);
}

/**
 * Mount a Pixi layer for as long as an engine exists, and re-mount when it is replaced.
 *
 * The engine is booted asynchronously by GameRenderer and cleared when it unmounts, and
 * module code may not edit the shell to get a ready callback — so this watches for one.
 * Call from an effect; the returned function is the effect's cleanup.
 */
export function mountWhenEngineReady(
  mount: (engine: RenderEngine, sceneGraph: SceneGraph) => () => void,
  pollMs = 200,
): () => void {
  let mounted: SceneGraph | null = null;
  let unmount: (() => void) | null = null;

  const check = () => {
    const current = getEngineSingleton();
    if ((current?.sceneGraph ?? null) === mounted) return;
    unmount?.();
    unmount = null;
    mounted = current?.sceneGraph ?? null;
    if (current) unmount = mount(current.engine, current.sceneGraph);
  };

  check();
  const timer = setInterval(check, pollMs);
  return () => {
    clearInterval(timer);
    unmount?.();
  };
}

/** World-space point under a pointer event, or null when it is not over the canvas. */
export function worldPointOf(engine: RenderEngine, e: PointerEvent): { x: number; y: number } | null {
  const canvas = engine.canvas();
  if (e.target !== canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

/**
 * The label the player fog gives the graphic it fills with LIVE sight — the clear tier alone.
 * Overlays that may not outrun what the seat can see *right now* wear this as their Pixi
 * mask; it shares the fog layer's camera mirror, so a screen overlay mirroring the camera the
 * same way lines up. The token chips and the turn ring are its wearers: a live position is a
 * secret, so a remembered room shows what it looked like, never who is standing in it now.
 */
export const SIGHT_MASK = 'sightMask';

/**
 * …and the label on the graphic filled with everything this seat is SHOWN — the clear tier
 * and the memory tier together. The door marks wear this one, because where a door is stops
 * being a secret the moment the room around it has been seen: a remembered room shows its
 * layout, doors included, and hidden ground shows no door at all.
 *
 * The two are separate carriers rather than one, because in vision mode they are genuinely
 * different textures (`tierCompositor`'s `live` against its `mask`), and a wearer picks its
 * stencil by label.
 */
export const SHOWN_MASK = 'shownMask';

/** The player fog's live-sight stencil, once the fog layer has mounted; null before, and on seats that draw no mask. */
export function sightMaskOf(sceneGraph: SceneGraph): Container | null {
  return fogStencil(sceneGraph, SIGHT_MASK);
}

/**
 * The player fog's shown stencil (clear + memory), on the same terms as `sightMaskOf`.
 *
 * Null is the answer on any seat the fog draws no mask for — a DM outside sight preview, or a
 * scene with no fog at all — and a wearer must treat it as "there is nothing here to draw
 * over" rather than as "draw freely": absence has to err hidden, which is what
 * `DoorRenderer` gates its player-side art on.
 */
export function shownMaskOf(sceneGraph: SceneGraph): Container | null {
  return fogStencil(sceneGraph, SHOWN_MASK);
}

function fogStencil(sceneGraph: SceneGraph, label: string): Container | null {
  const fog = sceneGraph.overlayContainer.children.find((c) => c.label === 'playerFog');
  return (fog?.children.find((c) => c.label === label) as Container | undefined) ?? null;
}

