import { PrepOverview } from '@/v2/editor/PrepOverview';
import { RoomsSheet } from '@/v2/editor/RoomsSheet';
import { SkyMoodSheet } from '@/editor/families/environment';
import { useShell } from '@/editor/shell/shellStore';
import { LayerSheet } from './LayerSheet';
import { LayersSheet } from './LayersSheet';
import { PacksSheet } from './PacksSheet';
import { SheetFrame } from './SheetFrame';
import { ShortcutsSheet } from './ShortcutsSheet';

/**
 * Whichever right sheet is open, all in the same 320 slot. Layers, a layer's settings, Packs
 * and the shortcuts are built here from the composites, Sky and mood by the Environment
 * family; Prep sits in the frame with its body as it is, and the Rooms list places itself,
 * until the Text family rebuilds them.
 */
export function SheetHost() {
  const sheet = useShell((s) => s.sheet);
  const close = useShell((s) => s.closeSheet);
  const openSheet = useShell((s) => s.openSheet);
  const layerTarget = typeof sheet === 'object' && sheet?.kind === 'layer' ? sheet.target : null;
  return (
    <>
      {sheet === 'layers' && <LayersSheet onClose={close} onOpenLayerSettings={(target) => openSheet({ kind: 'layer', target })} />}
      {layerTarget && <LayerSheet key={layerTarget} target={layerTarget} onClose={close} />}
      {sheet === 'packs' && <PacksSheet onClose={close} />}
      {sheet === 'shortcuts' && <ShortcutsSheet onClose={close} />}
      <RoomsSheet />
      {sheet === 'sky' && (
        <SheetFrame title="Sky and mood" onClose={close} testId="shell-sky-sheet">
          <SkyMoodSheet />
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
