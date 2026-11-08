import { IconKeyButton, Separator } from '@dnd/ui';
import { Keyboard } from '@dnd/ui/icons';
import { useRole } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { toggleSheet } from '../sheets/registry';
import { railToolsFor } from './registry';
import { activeRailTool, pickRailTool } from './tools';

/** The left rail, 44 wide: pointer tools for the role, the shortcuts sheet at the foot. */
export function TableRail() {
  const role = useRole();
  const active = activeRailTool(useActiveTool((s) => s.activeTool));
  const tools = railToolsFor(role);
  if (!role) return null;
  return (
    <nav
      aria-label="Tools"
      data-testid="table-rail"
      data-chrome
      className="absolute top-16 left-3 z-20 flex w-11 flex-col items-center gap-1 rounded-float border border-line bg-panel py-1.5 shadow-e"
    >
      {tools.map((t) => (
        <IconKeyButton
          key={t.id}
          size={36}
          icon={t.icon}
          label={t.title}
          shortcut={t.key}
          active={active === t.id}
          data-testid={`rail-${t.id}`}
          onClick={() => pickRailTool(t.id)}
        />
      ))}
      <Separator className="my-1 w-6" />
      <IconKeyButton
        size={36}
        icon={Keyboard}
        label="Keyboard shortcuts"
        shortcut="?"
        data-testid="rail-shortcuts"
        onClick={() => toggleSheet('shortcuts')}
      />
    </nav>
  );
}
