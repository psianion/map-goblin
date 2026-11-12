// The wall card's custom row: Set, editable.

import { useStore } from '@/store/store';
import { selectWallById } from '@/store/selectors';
import type { SettingProps } from '@/editor/registry/types';
import { SwatchPicker } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { installedWallSets, wallSetLabel, wallSetThumb } from '@/editor/models/assetStrip';
import { LAYER_SET, NO_SET } from './wallLook';

/** The installed wall sets, the layer's first. Sets arrive with the packs, so they are read live. */
export function SetField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const layerSet = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const found = id ? selectWallById(s, id) : undefined;
    return found?.layer.style.wallTextureSetId;
  });
  const swatches = [
    // The layer's set is pictured as itself: that is what the wall draws with.
    { value: LAYER_SET, label: layerSet ? `Layer's (${wallSetLabel(layerSet)})` : "Layer's", art: layerSet ? wallSetThumb(layerSet) : undefined },
    ...installedWallSets().map((id) => ({ value: id, label: wallSetLabel(id), art: wallSetThumb(id) })),
    { value: NO_SET, label: 'None' },
  ];
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value} onPick={onChange} />;
}
