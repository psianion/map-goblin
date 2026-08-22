// M5 — the live relight a DM's `light` trigger actually paints. A light child's on/off is
// nothing but its own `visible` flag: LightingRenderer's `getVisibleLights` (backed by
// LightManager) filters on it every frame, and the flag rides in that renderer's own cache
// signature, so a value flip alone earns a recomposite. (LightManager's dirty set tracks only
// geometry — position/radius/falloff — not visibility.) So playing `lightOverrides` back onto
// the core store's light children *is* the relight — no new pipeline, same shape as
// doors→lighting (D3 layer 1, `modules/doors/doorLighting.ts`).
//
// Two triggers, one drift check, mirroring the door lane exactly: a triggers command landing
// changes the overrides, and a fresh map load / scene switch changes the children back to
// their authored visibility out from under any override already in play. Either has to
// reapply the same drift, so both are watched and the empty-drift return is the recursion
// guard (writing the store re-enters this callback and the second pass finds nothing left).

import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { sceneTriggersOf, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { tokensOf } from '../tokens/TokenRenderer';

/** This scene's light overrides, or none while there is no scene/triggers state yet. */
function activeOverrides(): Record<string, boolean> {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !triggers) return {};
  return sceneTriggersOf(triggers, sceneId).lightOverrides;
}

/** Light ids whose map visibility disagrees with the scene's overrides, and what it should
 *  say instead. */
export function lightingDrift(
  overrides: Record<string, boolean>,
  layers: readonly Layer[],
): Map<string, boolean> {
  const drift = new Map<string, boolean>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType !== 'light') continue;
      const on = overrides[child.id];
      if (on !== undefined && child.visible !== on) drift.set(child.id, on);
    }
  }
  return drift;
}

// ── Token-carried light (S3 P3 §2) ──────────────────────────────────────────
// A torch a token is carrying is a light like any other, so it becomes one: a pseudo light
// child on the loaded map, fed through the same LightManager the authored lights go through.
// That buys the per-source shadow cache, the 24-light cull and the whole composite for free —
// the renderer never learns that tokens exist.

/** The pseudo-light a token's own light renders as. Stable, so a move updates rather than
 *  re-creates, and the shadow cache keyed on it survives the step. */
export const tokenLightId = (tokenId: string): string => `token-light:${tokenId}`;

/** …and the way back: a light child on the map that is a token's torch rather than an
 *  authored lamp. Exported because the mask's own light list has to skip them — the token
 *  they belong to is already a source there (`lightSources`), and reading both counts one
 *  torch twice (D4). */
export const isTokenLight = (id: string): boolean => id.startsWith('token-light:');

/**
 * What the scene's tokens should be lighting right now.
 *
 * `radius` is the token's *dim* radius and `featherRadius` its bright one, which is exactly
 * how LightingRenderer reads the pair: the feather is the plateau at full intensity and the
 * radius is where the falloff has finished. A torch is bright close in and dim to its edge.
 * Hidden tokens light nothing — same redaction rule the referee's own light list runs
 * (`lightSources`), because a pool of light around a token nobody may see is a position leak.
 *
 * ponytail: every torch here is one more light against `MAX_RENDERED_LIGHTS` (24, nearest the
 * camera), and the mask sweeps them all — so a big party on a lamp-lit map can push an authored
 * lamp out of the *render* while the fog still clears its pool. Errs open, and the eviction
 * follows the camera. Revisit if the P6 gate map plus a full party crosses 24 (D3).
 */
export function tokenLights(tokens: readonly Token[]): LightChild[] {
  return tokens
    .filter((token) => token.light !== null && !token.hidden)
    .map((token) => ({
      id: tokenLightId(token.id),
      name: token.name,
      childType: 'light',
      visible: true,
      color: token.light!.color,
      radius: Math.max(token.light!.dim, token.light!.bright),
      featherRadius: Math.min(token.light!.dim, token.light!.bright),
      intensity: 1,
      falloff: 'quadratic',
      position: { x: token.x, y: token.y },
    }));
}

/** Where a pseudo-light disagrees with the token carrying it — every field the renderer reads. */
const sameLight = (a: LightChild, b: LightChild): boolean =>
  a.position.x === b.position.x &&
  a.position.y === b.position.y &&
  a.radius === b.radius &&
  a.featherRadius === b.featherRadius &&
  a.color === b.color &&
  a.visible === b.visible;

/** The pseudo-lights to write, and the ones to take off the map — a token put away, hidden,
 *  or handed its torch back is a light that has to stop existing, not one left burning. */
export function tokenLightDrift(
  tokens: readonly Token[],
  layers: readonly Layer[],
): { write: LightChild[]; remove: string[] } {
  const want = new Map(tokenLights(tokens).map((light) => [light.id, light]));
  const have = new Map<string, LightChild>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType === 'light' && isTokenLight(child.id)) have.set(child.id, child);
    }
  }
  return {
    write: [...want.values()].filter((light) => {
      const current = have.get(light.id);
      return !current || !sameLight(current, light);
    }),
    remove: [...have.keys()].filter((id) => !want.has(id)),
  };
}

/** The scene's tokens, or none while there is no scene/tokens state yet. */
function activeTokens(): Token[] {
  const session = useSessionStore.getState().session;
  return tokensOf(session?.modules?.tokens as TokensState | undefined, session?.activeSceneId);
}

/**
 * Fires whenever the drift inputs could have changed — a triggers command, a token moving, a
 * scene change, or a new map. Both stores replace their slices wholesale, so identity is the
 * whole test (same as `subscribeLiveDoors`).
 */
function subscribeLiveLights(onChange: () => void): () => void {
  let last: unknown[] = [];
  const check = () => {
    const session = useSessionStore.getState().session;
    const next = [
      session?.modules?.triggers,
      session?.modules?.tokens,
      session?.activeSceneId,
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
 * Keep the loaded map's lights at the state the table is playing them at. Call from an
 * effect; the returned function is the effect's cleanup.
 */
export function syncLightsToScene(): () => void {
  return subscribeLiveLights(() => {
    const layers = useStore.getState().layers;
    const drift = lightingDrift(activeOverrides(), layers);
    const carried = tokenLightDrift(activeTokens(), layers);
    // The recursion guard, and the reason both drifts are answered in one write: this callback
    // re-enters on the store write it makes, and the second pass has to find nothing left.
    if (drift.size === 0 && carried.write.length === 0 && carried.remove.length === 0) return;
    // Cut before place: a pseudo-light being rewritten is taken off *every* layer and put back
    // on one, so an update can never leave a second copy of a torch behind on the layer it
    // happened to be written to last.
    const rewriting = new Set([...carried.remove, ...carried.write.map((light) => light.id)]);
    let placed = carried.write.length === 0;
    useStore.setState((state) => {
      for (const layer of state.layers) {
        if (layer.type !== 'dungeon') continue;
        for (const child of layer.children) {
          if (child.childType !== 'light') continue;
          const next = drift.get(child.id);
          if (next !== undefined) (child as LightChild).visible = next;
        }
        // A token that stopped carrying light, was hidden, or left the scene.
        if (rewriting.size > 0) {
          layer.children = layer.children.filter((child) => !rewriting.has(child.id));
        }
        // Every carried light lives on one dungeon layer — which one is immaterial (the
        // renderer flattens them all), and keeping them together is what makes them findable.
        if (!placed) {
          placed = true;
          layer.children.push(...carried.write);
        }
      }
    });
  });
}
