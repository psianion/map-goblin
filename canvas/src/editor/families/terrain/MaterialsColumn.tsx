// The brush's swatches: one tile per installed material, its fill as the picture. The
// Material entry lists the band sets with border art (gg-forge's cave ink) first, then the
// plain floor textures; the Terrain entry lists the ground textures first, the Water entry
// the water textures. A click picks what the next stroke of that entry paints.

import { useStore } from '@/store/store';
import type { BrushKind } from '@/store/types';
import { DockColumn, Tile } from '@dnd/ui';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import type { SettingProps } from '@/editor/registry/types';
import { SwatchPicker } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { brushMaterial, brushMaterialIds, defaultShoreId, materialFillId, materialLabel, SHORE_NONE, shoreChoices } from '@dnd/core/src/assets/materialKit';
import { getBandSet } from '@dnd/core/src/assets/packCatalog';

/** A water piece's shore: any outdoor floor the packs ship, or None, read live as the swatches are. '' is the default (dirt). */
export function ShoreField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const swatches = shoreChoices().map((c) => ({ ...c, art: c.value === SHORE_NONE ? undefined : c.value }));
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value || defaultShoreId() || SHORE_NONE} onPick={onChange} />;
}

const TITLES: Record<BrushKind, string> = { material: 'Material', terrain: 'Ground', water: 'Water' };

function Swatches({ kind }: { kind: BrushKind }) {
  const picked = useStore((s) => brushMaterial(s.tools.settings.material, kind));
  // Pack thumbnails and sets arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const pick = (material: string) =>
    useStore.setState((s) => {
      if (kind === 'terrain') s.tools.settings.material.groundMaterial = material;
      else if (kind === 'water') s.tools.settings.material.waterMaterial = material;
      else s.tools.settings.material.material = material;
    });
  return (
    <DockColumn title={TITLES[kind]} data-column="materials" data-testid="terrain-materials">
      {brushMaterialIds(kind).map((id) => {
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

export function MaterialsColumn() {
  return <Swatches kind="material" />;
}

export function GroundColumn() {
  return <Swatches kind="terrain" />;
}

export function WaterColumn() {
  return <Swatches kind="water" />;
}
