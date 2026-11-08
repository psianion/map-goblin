// The Material brush's swatches: one tile per installed material with border art, its fill
// as the picture. Today that is gg-forge's cave ink alone; the strip fills in as packs bring
// more. A click picks what the next stroke paints.

import { useStore } from '@/store/store';
import { DockColumn, Tile } from '@dnd/ui';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import { materialFillId, materialIds, materialLabel } from '@dnd/core/src/assets/materialKit';
import { getBandSet } from '@dnd/core/src/assets/packCatalog';

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
