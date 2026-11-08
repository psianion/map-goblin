import { IconKeyButton } from '@/editor/components';
import { Separator } from '@/ui/separator';
import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';
import { pickTool, useActiveTool } from './hooks';

/** The rail's width; the status bar starts after it. */
export const RAIL_W = 56;

/**
 * The left rail, 56 wide and full height: the rail's own tools (Select, Pan, Measure), a
 * divider, then the families. A click on a family opens or closes its flyout. The ring
 * marks the rail tool in hand and the family whose flyout is open or whose tool is in hand.
 */
export function Rail() {
  const { registry } = useRegistry();
  const active = useActiveTool();
  const flyout = useShell((s) => s.flyout);
  const activeFamily = active ? registry.familyOfTool(active.id)?.id : undefined;
  return (
    <nav
      aria-label="Tools"
      data-testid="shell-rail"
      data-chrome
      data-keys="canvas"
      className="absolute top-0 bottom-0 left-0 z-10 flex w-14 flex-col items-center gap-2.5 border-r border-line bg-panel py-3"
    >
      {registry.rail.map((t) => (
        <IconKeyButton
          key={t.id}
          size={36}
          icon={t.icon}
          label={t.label}
          shortcut={t.key}
          active={active?.id === t.id && flyout === null}
          data-tip={t.label}
          data-tip-key={t.key}
          data-tip-side="right"
          onClick={() => {
            useShell.getState().setFlyout(null);
            pickTool(t);
          }}
        />
      ))}
      <Separator className="my-1.5 w-6" />
      {registry.families.map((f) => (
        <IconKeyButton
          key={f.id}
          size={36}
          icon={f.icon}
          label={f.label}
          shortcut={f.key}
          active={flyout === f.id || (flyout === null && activeFamily === f.id)}
          aria-expanded={flyout === f.id}
          data-tip={f.label}
          data-tip-key={f.key}
          data-tip-side="right"
          onClick={() => useShell.getState().setFlyout(flyout === f.id ? null : f.id)}
        />
      ))}
    </nav>
  );
}
