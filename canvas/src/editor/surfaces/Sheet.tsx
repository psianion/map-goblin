import { TERRAIN_PANEL_ID } from '@/store/types';
import { LayerSheet } from '@/v2/editor/LayerSheet';
import { LayersSheet } from '@/v2/editor/LayersSheet';
import { PacksSheet } from '@/v2/editor/PacksSheet';
import { PrepOverview } from '@/v2/editor/PrepOverview';
import { RoomsSheet } from '@/v2/editor/RoomsSheet';
import { SkySheet, SkySheetFoot } from '@/v2/editor/SkySheet';
import { useShell } from '@/editor/shell/shellStore';
import { SheetFrame } from './SheetFrame';
import { ShortcutsSheet } from './ShortcutsSheet';

/**
 * Whichever right sheet is open. Sheets that are whole components today (Layers, a
 * layer's settings, Packs, Rooms) come over as they are and place themselves in the same
 * 320 slot; sheets that are a body only (Sky and mood, Prep) sit in the frame, and so does
 * the shortcuts sheet, rebuilt here from the registry and the global chords.
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
      {sheet === 'shortcuts' && <ShortcutsSheet onClose={close} />}
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
