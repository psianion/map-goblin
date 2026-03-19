import type { Container } from 'pixi.js';
import type { RenderEngine } from '@/engine/RenderEngine';
import type { ToolManager } from './ToolManager';
import { RectangleTool } from './RectangleTool';
import { PolygonTool } from './PolygonTool';
import { RegularPolygonTool } from './RegularPolygonTool';
import { PathTool } from './PathTool';
import { WallTool } from './WallTool';
import { SelectTool } from './SelectTool';
import { ObjectTool } from './ObjectTool';
import { LightTool } from './LightTool';
import { StampScatterTool } from './StampScatterTool';
export function registerAllTools(manager: ToolManager, worldContainer: Container, engine: RenderEngine, previewContainer: Container): void {
  const selectTool = new SelectTool(engine);
  selectTool.overlay.setWorldToScreen((wx, wy) => engine.worldToScreen(wx, wy));
  worldContainer.addChild(selectTool.overlay.container);
  manager.registerTool(selectTool);

  const objectTool = new ObjectTool();
  objectTool.overlay.setWorldToScreen((wx, wy) => engine.worldToScreen(wx, wy));
  worldContainer.addChild(objectTool.overlay.container);
  manager.registerTool(objectTool);

  manager.registerTool(new RectangleTool());
  manager.registerTool(new PolygonTool());
  manager.registerTool(new RegularPolygonTool());
  manager.registerTool(new PathTool());
  manager.registerTool(new WallTool());
  manager.registerTool(new LightTool());
  manager.registerTool(new StampScatterTool(previewContainer));
}
