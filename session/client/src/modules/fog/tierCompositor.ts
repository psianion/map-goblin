// The executor half of the tier compositor: a `DrawPlan` turned into Pixi draws and nothing
// else. Every fog *decision* is in `tierPlan.ts`; this file knows only how to render a rect, a
// polygon, a cell texture and one target into another.
//
// The vocabulary is deliberately tiny, because P0 measured what is trustworthy on 8.17:
// `normal` and `erase` into a RenderTexture, a round-joined stroke as a Minkowski inflate, and
// a sprite as a mask. `multiply` is not on the list — it is unreliable into a RenderTexture —
// so every intersection here arrives as an erase of a complement the plan built for it.
//
// Two disciplines carried from `livingFog.ts`, each of which cost a round once:
//   - RenderTextures are resized in place, never recreated. The cloud shader's bind group
//     holds the texture *source*, and a fresh RenderTexture is a source the bind does not
//     follow — the mask goes black with no error anywhere.
//   - A Pixi `Filter` composites with its own `blendMode`, not its target's, so a blur used
//     under anything but `normal` has to be told.
//
// ponytail: the display objects for one run are built fresh and destroyed on the next. That is
// a handful of Graphics per fog mutation against the Clipper pass this replaces; the things
// that must survive — the targets, the filters, the cell texture's GPU source — do.

import {
  BlurFilter,
  BufferImageSource,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
} from 'pixi.js';
import type { Bounds } from './FogRenderer';
import { TARGET_ORDER, type CellTexture, type DrawOp, type DrawPlan, type TierTarget } from './tierPlan';

/** All this needs of the engine — `RenderEngine` satisfies it structurally. */
export interface TierRenderer {
  renderToTexture(container: Container, texture: RenderTexture, clear?: boolean): void;
}

export interface TierCompositor {
  /**
   * The tier texture the cloud shader samples: transparent where the seat holds nothing,
   * `MASK_MEMORY_GREY` over its memory, white over live sight.
   */
  readonly mask: RenderTexture;
  /**
   * …and its blurred copy, on exactly `livingFog`'s contract: one blur of `mask` at
   * `fade × scale`, which is what the shader's `2b − 1` remap is written against.
   */
  readonly maskSoft: RenderTexture;
  /** The flat black backstop with the mask's holes erased out of it. */
  readonly scrim: RenderTexture;
  /** Live sight alone — the stencil the token chips wear. Memory is deliberately not in it. */
  readonly live: RenderTexture;
  /**
   * Composite one plan. Answers the world rect every target now covers, or null when the plan
   * covers nothing at all — the caller must draw neither the cover nor the scrim on a null,
   * exactly as `drawFog` draws nothing when its bounds are null.
   */
  run(plan: DrawPlan, look: { scale: number; fade: number }): Bounds | null;
  destroy(): void;
}

/**
 * The two textures the cloud shader is bound to for its whole life (`livingFog`'s `maskRT`
 * and `maskSoftRT`).
 *
 * Handed in rather than created here, and that is the whole of the P1b seam: the shader's
 * bind group holds a texture *source*, so the composited mask has to land in the source the
 * shader already has rather than in a new one it would never look at. The compositor then
 * only ever resizes them in place, exactly as `setMaskBounds` does, and destroys neither —
 * their owner is `livingFog`, which the rooms path still paints through unchanged.
 */
export interface TierTextures {
  mask: RenderTexture;
  maskSoft: RenderTexture;
}

export function createTierCompositor(engine: TierRenderer, shared?: TierTextures): TierCompositor {
  const targets = new Map<TierTarget, { rt: RenderTexture; scene: Container; owned: boolean }>(
    TARGET_ORDER.map((name) => {
      const borrowed = name === 'mask' && shared ? shared.mask : null;
      return [
        name,
        {
          rt: borrowed ?? RenderTexture.create({ width: 4, height: 4 }),
          scene: new Container(),
          owned: !borrowed,
        },
      ];
    }),
  );
  const rtOf = (name: TierTarget): RenderTexture => (targets.get(name) as { rt: RenderTexture }).rt;
  const sceneOf = (name: TierTarget): Container =>
    (targets.get(name) as { scene: Container }).scene;

  // The soft copy, built exactly as `livingFog` builds it so the shader's remap keeps working
  // now that P1b has swapped the paint source underneath it.
  const maskSoft = shared?.maskSoft ?? RenderTexture.create({ width: 4, height: 4 });
  const soften = new BlurFilter({ strength: 0, quality: 2 });
  const softSprite = new Sprite(rtOf('mask'));
  softSprite.filters = [soften];
  const softScene = new Container();
  softScene.addChild(softSprite);

  // The memory tier's blur, when a plan asks for one. Kept whatever the plan says, because a
  // filter is a GPU resource and the plan's answer can change between runs.
  const memoryBlur = new BlurFilter({ strength: 0, quality: 2 });

  let cellSource: BufferImageSource | null = null;
  let cellTex: Texture | null = null;

  /** The record's bytes on the GPU. One source for the life of the compositor per shape. */
  const uploadCells = (cells: CellTexture): Texture => {
    if (!cellSource || cellSource.width !== cells.cols || cellSource.height !== cells.rows) {
      cellTex?.destroy(true);
      cellSource = new BufferImageSource({
        resource: new Uint8Array(cells.data),
        width: cells.cols,
        height: cells.rows,
        format: 'rgba8unorm',
        // The tier's whole smoothing budget: bilinear over the cell lattice is the ⅔-cell
        // kernel `memoryMask` supersampled for, and its half-level line is the same diagonal.
        scaleMode: 'linear',
        label: 'fog-region-cells',
      });
      cellTex = new Texture({ source: cellSource });
    } else {
      (cellSource.resource as Uint8Array).set(cells.data);
      cellSource.update();
    }
    return cellTex as Texture;
  };

  const clearScene = (scene: Container): void => {
    for (const child of scene.removeChildren()) child.destroy();
  };

  const build = (op: DrawOp, cover: Bounds, scale: number): Container => {
    switch (op.kind) {
      case 'rect': {
        const g = new Graphics()
          .rect(op.rect.minX, op.rect.minY, op.rect.maxX - op.rect.minX, op.rect.maxY - op.rect.minY)
          .fill({ color: op.color, alpha: 1 });
        g.blendMode = op.blend;
        return g;
      }
      case 'polys': {
        const g = new Graphics();
        for (const poly of op.polys) {
          if (poly.length < 3) continue;
          g.poly(poly.flat(), true).fill({ color: op.color, alpha: 1 });
          // Fill *and* a round-joined stroke of width 2r is the polygon ⊕ disc(r) — the
          // offset `reachOf` was paying Clipper for, at 0.003% area error (P0).
          if (op.grow > 0) {
            g.stroke({
              width: 2 * op.grow,
              color: op.color,
              alpha: 1,
              alignment: 0.5,
              join: 'round',
              cap: 'round',
            });
          }
        }
        g.blendMode = op.blend;
        return g;
      }
      case 'cells': {
        const sprite = new Sprite(uploadCells(op.cells));
        sprite.position.set(op.cells.minX, op.cells.minY);
        // One texel per cell, so the sprite is `cols × rows` *world units* wide and the
        // scene's own transform does the upscale through the sampler.
        sprite.width = op.cells.cols;
        sprite.height = op.cells.rows;
        sprite.tint = op.color;
        sprite.blendMode = op.blend;
        if (op.blurCells > 0) {
          memoryBlur.strength = op.blurCells * scale;
          memoryBlur.blendMode = op.blend;
          sprite.filters = [memoryBlur];
        }
        return sprite;
      }
      default: {
        const sprite = new Sprite(rtOf(op.source));
        sprite.position.set(cover.minX, cover.minY);
        sprite.width = cover.maxX - cover.minX;
        sprite.height = cover.maxY - cover.minY;
        sprite.blendMode = op.blend;
        return sprite;
      }
    }
  };

  return {
    mask: rtOf('mask'),
    maskSoft,
    scrim: rtOf('scrim'),
    live: rtOf('live'),
    run(plan, look) {
      const cover = plan.cover;
      for (const name of TARGET_ORDER) clearScene(sceneOf(name));
      if (!cover || cover.maxX <= cover.minX || cover.maxY <= cover.minY) {
        // Nothing composited and nothing stale left behind: an empty mask reads as hidden
        // everywhere, which is this seat's fog.
        for (const name of TARGET_ORDER) engine.renderToTexture(sceneOf(name), rtOf(name), true);
        engine.renderToTexture(softScene, maskSoft, true);
        return null;
      }

      const [w, h] = [cover.maxX - cover.minX, cover.maxY - cover.minY];
      const [tw, th] = [Math.max(1, Math.ceil(w * look.scale)), Math.max(1, Math.ceil(h * look.scale))];
      for (const name of TARGET_ORDER) {
        const rt = rtOf(name);
        // In place, never recreated — the shader's bind group holds the source.
        if (rt.width !== tw || rt.height !== th) rt.resize(tw, th);
      }
      if (maskSoft.width !== tw || maskSoft.height !== th) maskSoft.resize(tw, th);

      const [sx, sy] = [tw / w, th / h];
      for (const name of TARGET_ORDER) {
        const scene = sceneOf(name);
        scene.scale.set(sx, sy);
        scene.position.set(-cover.minX * sx, -cover.minY * sy);
      }
      for (const op of plan.ops) sceneOf(op.target).addChild(build(op, cover, look.scale));

      // In target order, so a sprite never samples a target that has not been rendered yet.
      // Every target is rendered whether or not the plan gave it work: a target left holding
      // the previous rebuild is a stale reveal.
      for (const name of TARGET_ORDER) engine.renderToTexture(sceneOf(name), rtOf(name), true);

      soften.strength = look.fade * look.scale;
      engine.renderToTexture(softScene, maskSoft, true);
      return cover;
    },
    destroy() {
      for (const name of TARGET_ORDER) {
        const target = targets.get(name) as { rt: RenderTexture; scene: Container; owned: boolean };
        target.scene.destroy({ children: true });
        // A borrowed target belongs to `livingFog`, which destroys it with the shader.
        if (target.owned) target.rt.destroy(true);
      }
      softScene.destroy({ children: true });
      soften.destroy();
      memoryBlur.destroy();
      if (!shared) maskSoft.destroy(true);
      cellTex?.destroy(true);
      cellTex = null;
      cellSource = null;
    },
  };
}
