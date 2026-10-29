import type { AssetChild, LightChild } from '../shared/types';
import type { Command, Layer } from './types';
import { UpdateChildCommand } from './commands';

/**
 * Where a light glued to an asset goes when the asset changes from `before` to
 * `after`: its offset in `before`'s own frame, mirrored on a flip toggle, scaled per
 * local axis by the size change, turned by `after.rotation` and put back on
 * `after.position`. So a lamp on a table's corner stays on that corner through a
 * move, a quarter turn, a flip and a resize.
 */
export function followAsset(
  before: AssetChild,
  after: AssetChild,
  p: { x: number; y: number },
): { x: number; y: number } {
  const dx = p.x - before.position.x;
  const dy = p.y - before.position.y;
  const c0 = Math.cos(before.rotation);
  const s0 = Math.sin(before.rotation);
  let u = dx * c0 + dy * s0;
  let v = -dx * s0 + dy * c0;
  if (after.flipX !== before.flipX) u = -u;
  if (after.flipY !== before.flipY) v = -v;
  u *= ratio(after.width * after.scale, before.width * before.scale);
  v *= ratio(after.height * after.scale, before.height * before.scale);
  const c1 = Math.cos(after.rotation);
  const s1 = Math.sin(after.rotation);
  return { x: after.position.x + u * c1 - v * s1, y: after.position.y + u * s1 + v * c1 };
}

/** A degenerate old size keeps the offset rather than blowing it up. */
function ratio(next: number, prev: number): number {
  return prev > 1e-9 ? next / prev : 1;
}

/** Every light attached to one of `assetIds`, on any layer: a lamp may live on a lighting layer. */
export function lightsOn(
  layers: readonly Layer[],
  assetIds: Iterable<string>,
): { layerId: string; light: LightChild }[] {
  const ids = new Set(assetIds);
  const out: { layerId: string; light: LightChild }[] = [];
  if (ids.size === 0) return out;
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      if (c.childType === 'light' && c.attachedTo && ids.has(c.attachedTo)) out.push({ layerId: layer.id, light: c });
    }
  }
  return out;
}

/**
 * The light moves that go with an asset edit: one `UpdateChildCommand` per light
 * attached to an asset in `after`. Lights in `skip` (edited in their own right, such
 * as a selected light) are left to their own patch.
 */
export function followCommands(
  layers: readonly Layer[],
  before: ReadonlyMap<string, AssetChild>,
  after: ReadonlyMap<string, AssetChild>,
  skip: ReadonlySet<string> = new Set(),
  label = 'Move light',
): Command[] {
  const out: Command[] = [];
  for (const { layerId, light } of lightsOn(layers, after.keys())) {
    if (skip.has(light.id)) continue;
    const b = before.get(light.attachedTo!);
    const a = after.get(light.attachedTo!);
    if (!b || !a) continue;
    const position = followAsset(b, a, light.position);
    if (Math.abs(position.x - light.position.x) < 1e-9 && Math.abs(position.y - light.position.y) < 1e-9) continue;
    out.push(new UpdateChildCommand(label, layerId, light.id, { position: light.position }, { position }));
  }
  return out;
}
