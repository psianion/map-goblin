import type { Container } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import type { ToolManager } from './ToolManager';
import { RectangleTool } from './RectangleTool';
import { PolygonTool } from './PolygonTool';
import { RegularPolygonTool } from './RegularPolygonTool';
import { WallTool } from './WallTool';
import { RulerTool } from './RulerTool';
import { TextTool } from './TextTool';
import { SelectTool } from './SelectTool';
import { LightTool } from './LightTool';
import { StampScatterTool } from './StampScatterTool';
import { DoorTool } from './DoorTool';
import { ZoneTool } from './ZoneTool';
import { RoomPolygonTool, RoomRectTool } from './RoomTools';
import { DivideTool } from './DivideTool';
import { PlateauTool } from './PlateauTool';
import { MaterialTool } from './MaterialTool';
import { PathTool } from './PathTool';

export function registerAllTools(manager: ToolManager, worldContainer: Container, engine: RenderEngine, previewContainer: Container): void {
  const selectTool = new SelectTool(engine);
  selectTool.overlay.setWorldToScreen((wx, wy) => engine.worldToScreen(wx, wy));
  worldContainer.addChild(selectTool.overlay.container);
  manager.registerTool(selectTool);

  manager.registerTool(new RectangleTool());
  manager.registerTool(new PolygonTool());
  manager.registerTool(new RegularPolygonTool());
  manager.registerTool(new PlateauTool());
  manager.registerTool(new WallTool(engine));
  manager.registerTool(new RulerTool());
  manager.registerTool(new TextTool(previewContainer));
  manager.registerTool(new DoorTool(previewContainer));
  manager.registerTool(new LightTool());
  manager.registerTool(new StampScatterTool(previewContainer));
  // One brush under three rail entries: Material, Terrain and Water differ only in the
  // texture each remembers, so T and U still reach a brush.
  manager.registerTool(new MaterialTool(engine, previewContainer, 'terrain'));
  manager.registerTool(new MaterialTool(engine, previewContainer, 'water'));
  manager.registerTool(new MaterialTool(engine, previewContainer));
  manager.registerTool(new PathTool());
  manager.registerTool(new ZoneTool(previewContainer));
  manager.registerTool(new RoomRectTool());
  manager.registerTool(new RoomPolygonTool());
  manager.registerTool(new DivideTool());
}
