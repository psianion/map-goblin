import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { FloatBox, IconKeyButton, PanelHeader } from '@/editor/components';
import { useEscapeToClose } from '@/v2/useEscapeToClose';

/** The right slot: right 12, top 68, 320 wide, ending 12 above the dock as the asset panel does. */
export const SHEET_W = 320;

/** The sheet's frame: header with its close, the body scrolling, an optional foot. */
export function SheetFrame({ title, onClose, children, footer, testId }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testId?: string }) {
  useEscapeToClose(true, onClose, false, true);
  return (
    <FloatBox
      className="absolute top-[68px] right-3 bottom-[164px] z-20 flex w-[320px] flex-col overflow-hidden p-0"
      data-testid={testId}
      data-chrome
      role="complementary"
      aria-label={title}
    >
      <PanelHeader title={title}>
        <IconKeyButton size={26} icon={X} label={`Close ${title}`} onClick={onClose} />
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </FloatBox>
  );
}
