import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { addLayerToScene } from './sceneGraph';
import type { SceneGraph } from './sceneGraph';
import type { RenderEngine } from './RenderEngine';

function fakeSceneGraph(): SceneGraph {
  return { layerContainer: new Container() } as unknown as SceneGraph;
}

describe('addLayerToScene', () => {
  it('orders dungeon sublayers floor, materials, water, paths, plateau tops, plateau edges, shadows, grid, walls, wall marks, doors, objects, labels', () => {
    const sceneGraph = fakeSceneGraph();
    const entry = addLayerToScene({} as RenderEngine, sceneGraph, 'layer-1', 'dungeon');

    expect(entry.container.children.map((c) => c.label)).toEqual([
      'sublayer-floor',
      'sublayer-materials',
      'sublayer-water',
      'sublayer-paths',
      'sublayer-plateau-tops',
      'sublayer-plateau-edges',
      'sublayer-shadows',
      'sublayer-grid',
      'sublayer-walls',
      'sublayer-wall-marks',
      'sublayer-doors',
      'sublayer-objects',
      'sublayer-image-grid',
      'sublayer-labels',
    ]);
  });

  it('makes objects and labels sortable so per-child zIndex takes effect', () => {
    const sceneGraph = fakeSceneGraph();
    const entry = addLayerToScene({} as RenderEngine, sceneGraph, 'layer-2', 'dungeon');

    expect(entry.sublayers!.objects.sortableChildren).toBe(true);
    expect(entry.sublayers!.labels.sortableChildren).toBe(true);
  });

  it('background layers get no sublayers', () => {
    const sceneGraph = fakeSceneGraph();
    const entry = addLayerToScene({} as RenderEngine, sceneGraph, 'bg-1', 'background');

    expect(entry.sublayers).toBeNull();
  });
});
