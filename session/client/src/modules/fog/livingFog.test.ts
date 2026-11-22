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
import { DEFAULT_FOG_LOOK, FOG_LOOK_RANGES } from '@dnd/core/src/shared/fogLook';
import { createLivingFog } from './livingFog';
import { createTierCompositor } from './tierCompositor';
import { EDGE_WANDER, edgeRampEnds } from './tierPlan';

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

// Pass 2 — the players' edge is GLSL, so what a unit test can hold is the source and the inputs:
// the one-tier branches carry no inward-only cut and no crease, and the band follows the look.
describe('the players’ edge in the shader (pass 2)', () => {
  const make = () => createLivingFog(measuringEngine().engine, { dense: 1, mist: 0.6, rim: 0.75, fade: 0.6, oneTier: true });
  /** Every `if (uOneTier > 0.5) { … }` branch of the fragment's main, up to its `} else {`. */
  const oneTierBranches = (fragment: string): string[] =>
    fragment
      .split('if (uOneTier > 0.5) {')
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf('} else {')));

  it('cuts both ways about the painted line and draws no crease on it', () => {
    const fog = make();
    const branches = oneTierBranches(fog.mesh.shader!.glProgram!.fragment ?? '');
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch).not.toMatch(/min\(\s*here/);
      expect(branch).not.toMatch(/\brim\b|uRim/);
    }
    // The coastline read on the player's seat is the warped one alone.
    expect(branches[0]).toMatch(/m = max\(maskAt\(vWorld \+ w \* uWarp\), ownAt\(vWorld\)\) \* inMap;/);
    // …and its one-tier mask is the soft copy stretched over the band, nothing inward-only.
    expect(fog.mesh.shader!.glProgram!.fragment).toMatch(/if \(uOneTier > 0\.5\) return edgeShown\(uv\);/);
    fog.destroy();
  });

  it('wanders at most a fifth of a cell off the line, either way', () => {
    const fog = make();
    const { uWarp } = fog.mesh.shader!.resources.fogUniforms.uniforms as { uWarp: number };
    // The cloud field's offset is at most half a unit on each axis.
    expect(uWarp * Math.SQRT1_2).toBeLessThanOrEqual(EDGE_WANDER + 1e-9);
    expect(EDGE_WANDER).toBe(0.2);
    fog.destroy();
  });

  it('sets the band’s ends from the look’s Edge softness', () => {
    const fog = make();
    const uniforms = fog.mesh.shader!.resources.fogUniforms.uniforms as { uEdgeRamp: ArrayLike<number> };
    for (const fade of [1, 2, 4]) {
      fog.setLook({ ...DEFAULT_FOG_LOOK, fade });
      const [lo, hi] = edgeRampEnds(fade);
      expect(uniforms.uEdgeRamp[0]).toBeCloseTo(lo, 6);
      expect(uniforms.uEdgeRamp[1]).toBeCloseTo(hi, 6);
    }
    fog.destroy();
  });

  it('keeps the default look’s glow inside the ranges the Look sheet offers', () => {
    expect(DEFAULT_FOG_LOOK.glow).toBeGreaterThanOrEqual(FOG_LOOK_RANGES.glow.min);
    expect(DEFAULT_FOG_LOOK.glow).toBeLessThanOrEqual(FOG_LOOK_RANGES.glow.max);
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
