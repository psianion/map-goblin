import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';
import { Card } from './Card';
import { Flyout } from './Flyout';
import { useActiveTool, useCardTarget } from './hooks';
import { ToolPanel } from './ToolPanel';

/**
 * The one box beside the rail, left 68 top 68, 272 wide. It holds, in this order: the
 * open family's flyout; the card for what is picked while a rail tool (Select) is in
 * hand; the panel of the tool in hand when it has panel settings. Otherwise it is empty.
 */
export function Slot() {
  const { registry } = useRegistry();
  const flyoutId = useShell((s) => s.flyout);
  const tool = useActiveTool();
  const target = useCardTarget();
  const family = flyoutId ? registry.families.find((f) => f.id === flyoutId) : undefined;
  const railTool = tool !== undefined && registry.familyOfTool(tool.id) === undefined;

  let content = null;
  if (family) content = <Flyout family={family} />;
  else if (railTool && target) content = <Card {...target} />;
  else if (tool && (registry.settingsByHome(tool.id, 'panel').length > 0 || tool.savePreset)) content = <ToolPanel tool={tool} />;

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
