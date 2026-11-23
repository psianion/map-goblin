import { useEffect } from 'react';
import { Button, FloatBox, IconKeyButton, cn } from '@dnd/ui';
import { ChevronDown, ChevronUp } from '@dnd/ui/icons';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { ZoomControls } from '../ZoomControls';
import { useTableShell } from '../tableShell';
import { useArmedLabel } from './armedTool';
import { useDockTabs } from './useDockTabs';

/**
 * The DM dock (board 1, 2): the tab row, the open tab's context text, zoom and the collapse
 * chevron; picking a tab opens its body above the row (tools left, strip right), picking it
 * again folds it.
 */
export function Dock() {
  const tabs = useDockTabs();
  const open = useTableShell((s) => s.dockTab);
  const tab = tabs.find((t) => t.id === open);
  // F23: read through the session store so a module change (the order locking) re-renders the
  // text; the selector returns a string, so nothing else re-renders the dock.
  const context = useSessionStore(() => tab?.context?.() ?? null);
  const { pickDockTab, toggleDock } = useTableShell.getState();
  const armed = useArmedLabel();
  // The fog brush keeps the dock open, so its size and the other brush stay in reach.
  const brush = useActiveTool((s) => s.activeTool === 'fog');
  // F21: arming folds the dock to its tab row, so the map is there to click.
  useEffect(() => {
    if (armed && !brush) useTableShell.getState().foldDock();
  }, [armed, brush]);
  const Body = tab?.Body;
  const Strip = tab?.Strip;
  // With the dock open on an armed brush, the tab row names it beside the scene instead of a
  // chip row eating into the body's height.
  const inline = armed !== null && brush && tab !== undefined;
  return (
    <FloatBox
      className="absolute right-3 bottom-3 left-16 z-20 flex flex-col p-0"
      data-testid="dock"
      data-open={tab ? '' : undefined}
      data-chrome
      role="region"
      aria-label="Dock"
    >
      {tab && Body && (
        <div
          className={cn('flex min-h-0 border-b border-line', tab.height === 'sm' ? 'h-36' : 'h-56')}
          data-testid={`dock-body-${tab.id}`}
          data-height={tab.height ?? 'lg'}
        >
          {tab.layout === 'full' ? (
            <div className="flex min-w-0 flex-1 overflow-x-auto p-3" data-testid="dock-full">
              <Body />
            </div>
          ) : (
            <>
              <div className="flex min-h-0 w-80 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-2">
                <Body />
              </div>
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-3 py-2" data-testid="dock-strip">
                {Strip && <Strip />}
              </div>
            </>
          )}
        </div>
      )}
      {armed && !inline && (
        <div className="flex h-8 items-center border-b border-line px-3 text-xs text-text" role="status" data-testid="armed-chip">
          {armed}
        </div>
      )}
      <div className="flex h-11 items-center gap-0.5 px-1.5" role="tablist" aria-label="Dock tabs">
        {tabs.map((t) => (
          <Button
            key={t.id}
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={open === t.id}
            data-testid={`dock-tab-${t.id}`}
            className={cn('h-8 gap-1.5 px-2.5 text-xs', open === t.id && 'text-text ring-1 ring-inset ring-ink')}
            onClick={() => pickDockTab(t.id)}
          >
            <t.icon aria-hidden strokeWidth={1.75} className="size-4" />
            {t.title}
            <span aria-hidden className="font-mono text-xs text-text-3">
              {t.key}
            </span>
          </Button>
        ))}
        <span className="ml-auto truncate px-2 text-xs text-text-3" data-testid="dock-context">
          {inline ? [armed, context].filter(Boolean).join(' ') : context}
        </span>
        <ZoomControls />
        <IconKeyButton
          size={28}
          icon={tab ? ChevronDown : ChevronUp}
          label={tab ? 'Fold the dock' : 'Open the dock'}
          shortcut="B"
          data-testid="dock-collapse"
          onClick={toggleDock}
        />
      </div>
    </FloatBox>
  );
}
