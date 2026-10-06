import { ToolPopover } from 'map-builder';

const noop = () => {};

// The settings popover that flies out beside the tool rail. anchorY is the
// vertical offset of the tool it belongs to.
export function WallTool() {
  return <ToolPopover tool="wall" anchorY={80} onClose={noop} />;
}

export function TerrainTool() {
  return <ToolPopover tool="rectangle" anchorY={80} onClose={noop} />;
}
