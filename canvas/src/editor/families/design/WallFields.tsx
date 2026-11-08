// The wall card's custom row: Set, editable.

import { useStore } from '@/store/store';
import { selectWallById } from '@/store/selectors';
import { SelectRow } from '@/editor/components';
import type { SettingProps } from '@/editor/registry/types';
import { installedWallSets, wallSetLabel } from '@/editor/models/assetStrip';
import { LAYER_SET, NO_SET } from './wallLook';

/** The installed wall sets, the layer's first. Sets arrive with the packs, so they are read live. */
export function SetField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const layerSet = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const found = id ? selectWallById(s, id) : undefined;
    return found?.layer.style.wallTextureSetId;
  });
  const options = [
    { value: LAYER_SET, label: layerSet ? `Layer's (${wallSetLabel(layerSet)})` : "Layer's" },
    ...installedWallSets().map((id) => ({ value: id, label: wallSetLabel(id) })),
    { value: NO_SET, label: 'None' },
  ];
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}
