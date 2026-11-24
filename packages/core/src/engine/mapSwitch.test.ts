// Going back to the map list and opening another map without a reload: the editor's engine is
// torn down and the next map is drawn by a new one on the same page. What the first engine drew
// with and the second draws with again (the packs' cached art, Pixi's global pools of mask
// effects and render targets) must come through the teardown whole, or the second map draws
// destroyed art and Pixi throws under its first render to a texture.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (orig) => (await import('../testing/caveSpeed')).mockTextureLoader(await orig<object>()));

import { Container, GlobalResourceRegistry, Mesh, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { artState, freshMods, MEASURED_SET, openMap, seedMeasured, useFrames, withCaveKit, type OpenMap, type SpeedMap } from '../testing/caveSpeed';
import { PixiRenderEngine } from './PixiRenderEngine';

const repoMap = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata', file), 'utf8'));
const TESTING: SpeedMap = { name: 'Testing', file: () => withCaveKit(repoMap('testing-cave.ggvtt'), MEASURED_SET), seed: seedMeasured, material: MEASURED_SET };
const WARREN: SpeedMap = { name: 'Goblin Warren', file: () => withCaveKit(repoMap('goblin-warren.mapbuilder'), MEASURED_SET), seed: seedMeasured, material: MEASURED_SET };

/**
 * An engine past init without a GPU: its stage a real one, its app torn down as Pixi's own
 * Application is (the stage destroyed with the options given, then the renderer, which with
 * `releaseGlobalResources` clears Pixi's global pools).
 */
function engine(): { engine: PixiRenderEngine; stage: Container } {
  const e = new PixiRenderEngine();
  const stage = new Container();
  stage.addChild(e.stage());
  const renderer = {
    destroy: (options: unknown) => {
      if (options === true || (typeof options === 'object' && options !== null && (options as { releaseGlobalResources?: boolean }).releaseGlobalResources)) GlobalResourceRegistry.release();
    },
  };
  (e as unknown as { app: unknown }).app = {
    canvas: null,
    destroy: (rendererOptions: unknown, options: unknown) => {
      stage.destroy(options as never);
      renderer.destroy(rendererOptions);
    },
  };
  return { engine: e, stage };
}

/** Every texture `c` draws with. */
function drawnTextures(c: Container): Texture[] {
  const out: Texture[] = [];
  const walk = (n: Container): void => {
    if (n instanceof Sprite || n instanceof TilingSprite || n instanceof Mesh) out.push(n.texture);
    for (const k of n.children) walk(k as Container);
  };
  walk(c);
  return out;
}

describe('opening another map after going back to the list', () => {
  it('draws the second map with whole art, and leaves the pools the next engine draws with', async () => {
    useFrames();
    artState().withheld.clear();
    const mods = await freshMods();
    const release = vi.spyOn(GlobalResourceRegistry, 'release');
    const draw = (map: SpeedMap, stage: Container): OpenMap => {
      const open = openMap(mods, map);
      for (const id of open.ids) stage.addChild(mods.scene.getLayerEntry(id)!.container);
      open.drawAll();
      return open;
    };

    const first = engine();
    const one = draw(TESTING, first.engine.stage());
    expect(drawnTextures(first.stage).length).toBeGreaterThan(0);
    // Home: the map's scene goes with its engine.
    first.engine.destroy();
    one.close();
    expect(release).not.toHaveBeenCalled();

    const second = engine();
    const two = draw(WARREN, second.engine.stage());
    const art = drawnTextures(second.stage);
    expect(art.length).toBeGreaterThan(0);
    expect(art.filter((t) => t.destroyed)).toEqual([]);
    expect(artState().loaded.destroyed).toBe(false);
    second.engine.destroy();
    two.close();
    release.mockRestore();
  }, 60_000);
});
