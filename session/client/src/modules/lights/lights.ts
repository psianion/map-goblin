// M2 table UI (plan design decision 5) — the pure bits behind the DM's Lights mode, kept out
// of the Pixi/React files the same way `doors/doors.ts` keeps `doorAt` out of `DoorRenderer`:
// plain functions over `layers`/a screen point, easy to test without a mounted engine.

import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { LightEdit } from '@dnd/mechanics/triggers';
import { worldToScreen } from '../../renderer/camera';
import { isTokenLight, rememberAuthored, rememberPreviewed } from '../triggers/lightSync';

/** Screen px a pointer may sit from a light's icon and still count as a hit — B2's own fix on
 *  the canvas (plan doc), reused here since the table draws the same icon. */
export const LIGHT_HIT_PX = 12;

export interface LightHit {
  light: LightChild;
  layerId: string;
}

/** Every authored light on the loaded map. A token's own torch is session-carried (it already
 *  follows the token — `lightSync.tokenLights`), not something a DM reaches for here. */
export function mapLights(layers: readonly Layer[]): LightHit[] {
  const out: LightHit[] = [];
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType === 'light' && !isTokenLight(child.id)) {
        out.push({ light: child as LightChild, layerId: layer.id });
      }
    }
  }
  return out;
}

/** The nearest light icon to a screen point (CSS px local to the map element, `worldToScreen`'s
 *  own space), within `LIGHT_HIT_PX` — null off every icon. */
export function lightAt(layers: readonly Layer[], screen: { x: number; y: number }): LightHit | null {
  let best: LightHit | null = null;
  let bestDist = LIGHT_HIT_PX;
  for (const hit of mapLights(layers)) {
    const p = worldToScreen(hit.light.position.x, hit.light.position.y);
    if (!p) continue;
    const d = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (d <= bestDist) {
      bestDist = d;
      best = hit;
    }
  }
  return best;
}

/** One light by id, wherever it lives — the popover re-reads this off the live store every
 *  render rather than holding its own copy, same reason `DoorMenu` re-reads `useLiveDoors()`. */
export function lightById(layers: readonly Layer[], id: string): LightChild | undefined {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    const found = layer.children.find((c) => c.id === id && c.childType === 'light');
    if (found) return found as LightChild;
  }
  return undefined;
}

/**
 * The live-preview write: a drag or a slider patches the child directly, field by field (same
 * discipline `lightSync.ts` writes drift with — `position` gets a fresh object so it can never
 * alias the caller's), so the icon/pool on screen tracks the pointer immediately instead of
 * waiting a round trip. `set-light` still goes out on release/commit; `lightSync`'s own drift
 * check reconciles the store to the server's answer once it lands (`lightSync.ts` header).
 *
 * Because it writes ahead of that round trip it has to hand `lightSync` the authored values
 * first (`rememberAuthored`): otherwise the snapshot a later `reset-light` restores to would be
 * taken from this already-previewed child, and the first edit of a session would not revert.
 */
export function patchLightLocal(id: string, patch: LightEdit): void {
  useStore.setState((state) => {
    for (const layer of state.layers) {
      if (layer.type !== 'dungeon') continue;
      const child = layer.children.find((c) => c.id === id && c.childType === 'light') as
        | LightChild
        | undefined;
      if (!child) continue;
      rememberAuthored(child);
      if (patch.visible !== undefined) child.visible = patch.visible;
      if (patch.radius !== undefined) child.radius = patch.radius;
      if (patch.featherRadius !== undefined) child.featherRadius = patch.featherRadius;
      if (patch.intensity !== undefined) child.intensity = patch.intensity;
      if (patch.color !== undefined) child.color = patch.color;
      if (patch.falloff !== undefined) child.falloff = patch.falloff;
      if (patch.position !== undefined) child.position = { ...patch.position };
      // Mark the preview so lightSync's reconcile leaves it alone until the commit lands —
      // without this every preview write is snapped straight back (see lightSync.ts).
      rememberPreviewed(child);
      return;
    }
  });
}
