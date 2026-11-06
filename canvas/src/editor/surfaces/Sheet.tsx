import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { FloatBox, IconKeyButton, PanelHeader } from '@/editor/components';
import { TERRAIN_PANEL_ID } from '@/store/types';
import { LayerSheet } from '@/v2/editor/LayerSheet';
import { LayersSheet } from '@/v2/editor/LayersSheet';
import { PacksSheet } from '@/v2/editor/PacksSheet';
import { PrepOverview } from '@/v2/editor/PrepOverview';
import { RoomsSheet } from '@/v2/editor/RoomsSheet';
import { ShortcutsSheet } from '@/v2/editor/ShortcutsSheet';
import { SkySheet, SkySheetFoot } from '@/v2/editor/SkySheet';
import { useEscapeToClose } from '@/v2/useEscapeToClose';
import { useShell } from '@/editor/shell/shellStore';

/** The right slot: right 12, top 68, 320 wide, down to 12 above the status bar. */
export const SHEET_W = 320;

/** The sheet's frame: header with its close, the body scrolling, an optional foot. */
export function SheetFrame({ title, onClose, children, footer, testId }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testId?: string }) {
  useEscapeToClose(true, onClose, false, true);
  return (
    <FloatBox
      className="absolute top-[68px] right-3 bottom-10 z-20 flex w-[320px] flex-col overflow-hidden p-0"
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

/**
 * Whichever right sheet is open. Sheets that are whole components today (Layers, a
 * layer's settings, Packs, Shortcuts, Rooms) come over as they are and place themselves
 * in the same 320 slot; sheets that are a body only (Sky and mood, Prep) sit in the frame.
 */
export function SheetHost() {
  const sheet = useShell((s) => s.sheet);
  const close = useShell((s) => s.closeSheet);
  const openSheet = useShell((s) => s.openSheet);
  const layerTarget = typeof sheet === 'object' && sheet?.kind === 'layer' ? sheet.target : null;
  return (
    <>
      <LayersSheet
        open={sheet === 'layers'}
        onClose={close}
        onOpenLayerSettings={(target) => openSheet({ kind: 'layer', target: target === TERRAIN_PANEL_ID ? TERRAIN_PANEL_ID : target })}
      />
      <LayerSheet target={layerTarget} onClose={close} />
      <PacksSheet open={sheet === 'packs'} onClose={close} onBrowseProps={close} />
      <ShortcutsSheet open={sheet === 'shortcuts'} onClose={close} />
      <RoomsSheet />
      {sheet === 'sky' && (
        <SheetFrame title="Sky and mood" onClose={close} footer={<SkySheetFoot />} testId="shell-sky-sheet">
          <SkySheet />
        </SheetFrame>
      )}
      {sheet === 'prep' && (
        <SheetFrame title="Prep" onClose={close} testId="shell-prep-sheet">
          <PrepOverview />
        </SheetFrame>
      )}
    </>
  );
}
