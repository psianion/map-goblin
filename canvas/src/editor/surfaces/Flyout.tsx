import { useEffect } from 'react';
import { FloatBox, FlyoutRow } from '@dnd/ui';
import type { FamilyDef } from '@/editor/registry';
import { useShell } from '@/editor/shell/shellStore';
import { pickTool, useActiveTool } from './hooks';

/**
 * A family's tools, one row each: icon and key, name, one line of what it does. Opened by
 * a click on the family, closed by a pick or Escape, never by hover.
 */
export function Flyout({ family }: { family: FamilyDef }) {
  const active = useActiveTool();
  const close = () => useShell.getState().setFlyout(null);

  useEffect(() => {
    // Capture, so Escape closes the flyout before the canvas shortcuts see it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      useShell.getState().setFlyout(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <FloatBox className="flex w-[272px] flex-col overflow-hidden p-0" data-testid="shell-flyout" data-family={family.id}>
      <div className="flex h-10 items-center border-b border-line px-3.5 text-[12px] font-medium text-text">
        {family.label}
        <small className="ml-auto font-mono text-[10px] font-normal text-text-3">Esc closes</small>
      </div>
      <div className="flex flex-col p-1.5">
        {family.tools.map((t) => (
          <FlyoutRow
            key={t.id}
            icon={t.icon}
            shortcut={t.key}
            name={t.label}
            description={t.description}
            active={active?.id === t.id}
            onClick={() => {
              pickTool(t);
              close();
            }}
          />
        ))}
      </div>
    </FloatBox>
  );
}
