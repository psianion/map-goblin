import type { RenderEngine } from './RenderEngine';
import type { SceneGraph } from './sceneGraph';

let _engine: RenderEngine | null = null;
let _sceneGraph: SceneGraph | null = null;

export function setEngineSingleton(engine: RenderEngine, sg: SceneGraph): void {
  _engine = engine;
  _sceneGraph = sg;
}

export function getEngineSingleton(): { engine: RenderEngine; sceneGraph: SceneGraph } | null {
  if (!_engine || !_sceneGraph) return null;
  return { engine: _engine, sceneGraph: _sceneGraph };
}

export function clearEngineSingleton(): void {
  _engine = null;
  _sceneGraph = null;
}
