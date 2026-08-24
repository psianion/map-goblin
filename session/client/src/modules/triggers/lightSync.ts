// M5/M2 — the live relight a DM's `light` trigger, and now a DM's own live edit at the table,
// actually paint. A light child's fields are exactly what LightingRenderer reads every frame
// (backed by LightManager — visibility rides that renderer's own cache signature, geometry
// rides LightManager's dirty set), so playing `lightEdits` back onto the core store's light
// children *is* the relight — no new pipeline, same shape as doors→lighting (D3 layer 1,
// `modules/doors/doorLighting.ts`).
//
// Two triggers, one drift check, mirroring the door lane exactly: a triggers command landing
// changes the edits, and a fresh map load / scene switch changes the children back to their
// authored values out from under any edit already in play. Either has to reapply the same
// drift, so both are watched and the empty-drift return is the recursion guard (writing the
// store re-enters this callback and the second pass finds nothing left).
//
// Unlike the old boolean-only override, an edit can touch radius/color/position too, and those
// get overwritten in place on the child — so a `reset-light` needs something to put back that
// isn't just "whatever the child happens to hold right now" (that's the *edited* value, not the
// authored one). `lightingDrift`'s `authored` map is that something: the fields a light had the
// first time anything edited it — `authoredLights` below, seeded either here on the first drift
// or by the table's own live preview just before it writes (`modules/lights/lights.ts`).
//
// ponytail: `authoredLights` is never invalidated on a map/scene reload, so a light id that happens to
// be reused by a *different* document while the same subscription is alive would revert to the
// wrong snapshot. Core's own store is Immer-backed, so every in-place write here already gives
// `layers` a new top-level reference too — array identity can't tell "we just wrote" from "a
// real reload landed" apart, and light ids are generated per-document, so a same-session id
// collision is not a real-world case. Revisit with a real per-load generation id if that changes.

import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { effectiveLight, sceneTriggersOf, type LightEdit, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { tokensOf } from '../tokens/TokenRenderer';

/** The fields a DM edit can touch and `effectiveLight` overlays — a light child is one, an
 *  authored snapshot is exactly this much of one. */
export type EditableLight = Pick<LightChild, 'visible' | 'radius' | 'featherRadius' | 'intensity' | 'color' | 'position'>;

const snapshotOf = (child: LightChild): EditableLight => ({
  visible: child.visible,
  radius: child.radius,
  featherRadius: child.featherRadius,
  intensity: child.intensity,
  color: child.color,
  position: { ...child.position },
});

/** Every light this seat has edited, as it looked *before* its first edit — the map's own
 *  authored values, which nothing else can recover once an edit has been written onto the
 *  child. Module-scoped rather than owned by `syncLightsToScene` so the table's live preview
 *  (`modules/lights/lights.ts`) can seed it before it writes; otherwise the first previewed
 *  edit is what a later `reset-light` would restore to. */
const authoredLights = new Map<string, EditableLight>();

/** Snapshot a light's authored fields, unless something already did. Cheap and idempotent —
 *  call it immediately before any local write to a light child. */
export function rememberAuthored(child: LightChild): void {
  if (!authoredLights.has(child.id)) authoredLights.set(child.id, snapshotOf(child));
}

/** Lights with a local preview in flight, and the exact fields that preview wrote. Without
 *  this, `syncLightsToScene` re-enters on the preview's own store write, sees the child
 *  disagree with the standing edits (or the authored values), and stomps the preview mid-drag
 *  — the live bug: a slider that snapped back on every input tick. The mark is consumed the
 *  moment the scene's edits catch up (the commit landed) or the child stops matching it
 *  (something else wrote the light).
 *  ponytail: two DMs previewing the same light concurrently can hold off each other's edit
 *  until their own commit lands — one popover per seat makes that a non-case today. */
const previewedLights = new Map<string, EditableLight>();

/** Record the fields a local preview just wrote — call right after the store write. */
export function rememberPreviewed(child: LightChild): void {
  previewedLights.set(child.id, snapshotOf(child));
}

const sameFields = (child: LightChild, want: EditableLight): boolean =>
  child.visible === want.visible &&
  child.radius === want.radius &&
  child.featherRadius === want.featherRadius &&
  child.intensity === want.intensity &&
  child.color === want.color &&
  child.position.x === want.position.x &&
  child.position.y === want.position.y;

/** This scene's live light edits, or none while there is no scene/triggers state yet. Already
 *  folds a pre-M2 `lightOverrides` row (`sceneTriggersOf`), so a saved scene reads the same
 *  either way. */
function activeLightEdits(): Record<string, LightEdit> {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !triggers) return {};
  return sceneTriggersOf(triggers, sceneId).lightEdits;
}

/**
 * Light ids whose map fields disagree with what the scene's edits (overlaid on the light's own
 * authored values) say they should be, and the full field set to write instead — a light with
 * no edit and no history of one is left alone entirely.
 *
 * `authored` is the caller's own memory of what each edited light looked like before its first
 * edit — the caller owns and keeps it (`syncLightsToScene` does, one map for the lifetime of
 * its subscription) because this function has no other way to tell "authored" from "already
 * edited" once a write has landed on the child. A `reset-light` (its id drops out of `edits`
 * with an entry still in `authored`) reads back exactly that snapshot.
 */
export function lightingDrift(
  edits: Record<string, LightEdit>,
  layers: readonly Layer[],
  authored: Map<string, EditableLight>,
  previewed?: Map<string, EditableLight>,
): Map<string, EditableLight> {
  const drift = new Map<string, EditableLight>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType !== 'light') continue;
      const edit = edits[child.id];
      let base = authored.get(child.id);
      if (!edit && !base) continue; // never edited — the map keeps its own values.
      if (edit && !base) {
        // First time this light is touched: the child is still holding authored values.
        base = snapshotOf(child);
        authored.set(child.id, base);
      }
      const want = effectiveLight(base!, edit);
      const pv = previewed?.get(child.id);
      if (pv && previewed && sameFields(child, pv)) {
        // The child holds exactly what a local preview wrote. Until the committed edit says
        // the same thing, reconciling would stomp a drag in flight — leave the child alone.
        if (sameFields(child, want)) previewed.delete(child.id); // commit landed; mark spent.
        continue;
      }
      if (pv) previewed?.delete(child.id); // superseded — something else wrote this light.
      if (!sameFields(child, want)) drift.set(child.id, want);
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
    const drift = lightingDrift(activeLightEdits(), layers, authoredLights, previewedLights);
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
          if (next === undefined) continue;
          // Field-by-field, not a wholesale reassignment of `child`: `position` gets its own
          // fresh object so a later in-place move can never alias — and corrupt — the
          // authored snapshot `next` may itself be pointing at.
          const c = child as LightChild;
          c.visible = next.visible;
          c.radius = next.radius;
          c.featherRadius = next.featherRadius;
          c.intensity = next.intensity;
          c.color = next.color;
          c.position = { ...next.position };
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
