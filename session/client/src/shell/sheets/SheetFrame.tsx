import type { ReactNode } from 'react';
import { FloatBox, IconKeyButton, PanelHeader, cn } from '@dnd/ui';
import { X } from '@dnd/ui/icons';
import { useRole } from '../../session/store';
import { useTableShell } from '../tableShell';

/**
 * A sheet's frame, the canvas pattern: header with its actions and close, the body, an
 * optional foot. 320 wide, left of the slim tab column, ending above the dock (or above its
 * open body). Esc is the ladder's (`shell/hotkeys.ts`), not the frame's.
 */
export function SheetFrame({
  title,
  path,
  onClose,
  children,
  footer,
  actions,
  scroll = true,
  testId,
}: {
  title: string;
  /** Crumbs before the title: a room's key reads "Rooms / 3 Crypt / Key". */
  path?: string[];
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Header buttons before the close. */
  actions?: ReactNode;
  scroll?: boolean;
  testId?: string;
}) {
  const dockOpen = useTableShell((s) => s.dockTab !== null);
  const dm = useRole() === 'dm';
  return (
    <FloatBox
      className={cn(
        'absolute top-16 right-16 z-30 flex w-80 flex-col overflow-hidden p-0',
        dm && dockOpen ? 'bottom-72' : 'bottom-20',
      )}
      data-testid={testId}
      data-chrome
      data-sheet
      role="complementary"
      aria-label={title}
    >
      <PanelHeader path={path} title={title}>
        {actions}
        <IconKeyButton size={26} icon={X} label={`Close ${title}`} onClick={onClose} />
      </PanelHeader>
      <div className={scroll ? 'min-h-0 flex-1 overflow-y-auto' : 'flex min-h-0 flex-1 flex-col'}>{children}</div>
      {footer}
    </FloatBox>
  );
}
