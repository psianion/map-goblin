import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { FloatBox, IconKeyButton, PanelHeader } from '@/editor/components';
import { useEscapeToClose } from '@/v2/useEscapeToClose';

/** The right slot: right 12, top 68, 320 wide, ending 12 above the dock as the asset panel does. */
export const SHEET_W = 320;

/**
 * The sheet's frame: header with its actions and close, the body, an optional foot. The body
 * scrolls unless the sheet scrolls itself (`scroll={false}`, a windowed list).
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
  /** Header buttons before the close: the Layers sheet's Add layer. */
  actions?: ReactNode;
  scroll?: boolean;
  testId?: string;
}) {
  useEscapeToClose(true, onClose, false, true);
  return (
    <FloatBox
      className="absolute top-[68px] right-3 bottom-[164px] z-20 flex w-[320px] flex-col overflow-hidden p-0"
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
