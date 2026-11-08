import { Button, FloatBox, IconKeyButton, cn } from '@dnd/ui';
import { ChevronDown, ChevronUp } from '@dnd/ui/icons';
import { ZoomControls } from '../ZoomControls';
import { useTableShell } from '../tableShell';
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
  const context = tab?.context?.() ?? null;
  const { pickDockTab, toggleDock } = useTableShell.getState();
  const Body = tab?.Body;
  const Strip = tab?.Strip;
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
        <div className="flex h-56 min-h-0 border-b border-line" data-testid={`dock-body-${tab.id}`}>
          <div className="flex min-h-0 w-80 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-2">
            <Body />
          </div>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-3 py-2" data-testid="dock-strip">
            {Strip && <Strip />}
          </div>
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
          {context}
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
