// T14 — a mask that grows keeps every sprite drawn from it at its new size.
//
// Pixi measures a filter's area off the sprite's cached bounds, and a sprite only re-measures
// when its texture says it changed, which a static RenderTexture never does on resize. So the
// soft and feather copies of a mask that grew after its first render were clipped to the old
// size: By hand with everything revealed showed the map only to x≈27, cloud past it. The stub
// engine below reads every sprite's bounds as it renders, the way the filter system does.
import { describe, expect, it } from 'vitest';
import { Container, Sprite, type RenderTexture } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { createLivingFog } from './livingFog';
import { createTierCompositor } from './tierCompositor';

/** Every sprite under a container, with the bounds it reports and the size of what it draws. */
function spritesOf(container: Container, out: { bounds: number[]; texture: number[] }[] = []) {
  for (const child of container.children) {
    if (child instanceof Sprite) {
      const b = child.bounds;
      out.push({ bounds: [b.maxX - b.minX, b.maxY - b.minY], texture: [child.texture.width, child.texture.height] });
    }
    spritesOf(child, out);
  }
  return out;
}

function measuringEngine() {
  let renders: { bounds: number[]; texture: number[] }[] = [];
  const engine = {
    renderToTexture: (container: Container, _target: RenderTexture) => {
      renders.push(...spritesOf(container));
    },
  };
  return {
    engine: engine as unknown as RenderEngine,
    /** The sprites measured since the last call. */
    take: () => {
      const out = renders;
      renders = [];
      return out;
    },
  };
}

// The cloud shader is compiled as GLSL ES 1.00 on every context, where fwidth and its kin need an
// extension: with one in it the program failed to link and no cloud was drawn.
describe('the cloud shader', () => {
  it('uses no derivative function and asks for no extension', () => {
    const fog = createLivingFog(measuringEngine().engine, { dense: 1, mist: 0.6, rim: 0.75, fade: 0.6, oneTier: true });
    const fragment = fog.mesh.shader!.glProgram!.fragment;
    expect(fragment).not.toMatch(/\b(fwidth|dFdx|dFdy)\s*\(/);
    expect(fragment).not.toMatch(/#extension/);
    fog.destroy();
  });

  it('draws no edge line of its own: the DM’s line is the cell view’s', () => {
    const fog = createLivingFog(measuringEngine().engine, { dense: 1, mist: 0.6, rim: 0.75, fade: 0.6, oneTier: true });
    expect(fog.mesh.shader!.glProgram!.fragment).not.toMatch(/uEdgeLine|uPxWorld/);
    fog.destroy();
  });
});

const SMALL = { minX: -0.8, minY: -0.8, maxX: 30.8, maxY: 29.8 };
/** testing-cave, By hand with everything revealed: the frame grown by the pad and feather twice. */
const BIG = { minX: -3.6, minY: -3.6, maxX: 33.6, maxY: 33.6 };

describe('the mask textures after a resize (T14)', () => {
  it('keeps the compositor’s soft copy at the new size, By sight', () => {
    const { engine, take } = measuringEngine();
    const fog = createLivingFog(engine, { dense: 1, mist: 0.6, rim: 0.75, fade: 0.6, oneTier: true });
    const tiers = createTierCompositor(engine, fog.maskTextures);
    tiers.run({ cover: SMALL, ops: [], cells: 0 }, { scale: 24, fade: 0.2 });
    take();
    tiers.run({ cover: BIG, ops: [], cells: 0 }, { scale: 24, fade: 0.2 });
    const sprites = take();
    expect(sprites.length).toBeGreaterThan(0);
    for (const s of sprites) expect(s.bounds).toEqual(s.texture);
    tiers.destroy();
    fog.destroy();
  });

  it('resizes the compositor’s own targets so a sprite drawn from one follows', () => {
    const { engine } = measuringEngine();
    const tiers = createTierCompositor(engine);
    const scrim = new Sprite(tiers.scrim);
    tiers.run({ cover: SMALL, ops: [], cells: 0 }, { scale: 24, fade: 0.2 });
    const before = scrim.bounds.maxX;
    tiers.run({ cover: BIG, ops: [], cells: 0 }, { scale: 24, fade: 0.2 });
    expect(scrim.bounds.maxX).toBeGreaterThan(before);
    expect(scrim.bounds.maxX).toBe(tiers.scrim.width);
    tiers.destroy();
  });
});
