import { useStore } from '@/store/store';
import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';
import { Flyout } from './Flyout';
import { useActiveTool } from './hooks';
import { ToolPanel } from './ToolPanel';

/**
 * The one box beside the rail, left 68 top 68, 272 wide. It holds, in this order: the
 * open family's flyout; the tool's selection panel while something is picked (Select's
 * card host); the tool's panel when it has one. Otherwise it is empty.
 */
export function Slot() {
  const { registry } = useRegistry();
  const flyoutId = useShell((s) => s.flyout);
  const tool = useActiveTool();
  const picked = useStore((s) => s.selection.selectedIds.length > 0);
  const family = flyoutId ? registry.families.find((f) => f.id === flyoutId) : undefined;

  let content = null;
  if (family) content = <Flyout family={family} />;
  else if (tool?.selectionPanel && picked) {
    const SelectionPanel = tool.selectionPanel;
    content = <SelectionPanel />;
  } else if (tool && (registry.settingsByHome(tool.id, 'panel').length > 0 || tool.savePreset || tool.panelExtra)) {
    content = <ToolPanel tool={tool} />;
  }

  if (!content) return null;
  return (
    <div
      className="absolute top-[68px] left-[68px] flex max-h-[calc(100%-232px)] flex-col"
      data-chrome
      data-testid="shell-slot"
      data-keys="canvas"
    >
      {content}
    </div>
  );
}
