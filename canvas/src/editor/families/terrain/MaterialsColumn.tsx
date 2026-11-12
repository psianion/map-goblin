// The Material brush's swatches: one tile per installed material, its fill as the picture:
// the band sets with border art (gg-forge's cave ink), then the plain floor textures. A
// click picks what the next stroke paints.

import { useStore } from '@/store/store';
import { DockColumn, Tile } from '@dnd/ui';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import type { SettingProps } from '@/editor/registry/types';
import { SwatchPicker } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { defaultShoreId, materialFillId, materialIds, materialLabel, SHORE_NONE, shoreChoices } from '@dnd/core/src/assets/materialKit';
import { getBandSet } from '@dnd/core/src/assets/packCatalog';

/** A water patch's shore: any outdoor floor the packs ship, or None, read live as the swatches are. '' is the default (dirt). */
export function ShoreField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const swatches = shoreChoices().map((c) => ({ ...c, art: c.value === SHORE_NONE ? undefined : c.value }));
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value || defaultShoreId() || SHORE_NONE} onPick={onChange} />;
}

export function MaterialsColumn() {
  const picked = useStore((s) => s.tools.settings.material.material);
  // Pack thumbnails and sets arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const pick = (material: string) =>
    useStore.setState((s) => {
      s.tools.settings.material.material = material;
    });
  return (
    <DockColumn title="Material" data-column="materials" data-testid="terrain-materials">
      {materialIds().map((id) => {
        const art = materialFillId(id) ?? getBandSet(id)[0]?.id;
        const name = materialLabel(id);
        return (
          <Tile key={id} name={name} aria-label={name} active={picked === id} data-material={id} onClick={() => pick(id)}>
            {art ? <PackThumbnailCanvas textureId={art} fit="cover" /> : null}
          </Tile>
        );
      })}
    </DockColumn>
  );
}
