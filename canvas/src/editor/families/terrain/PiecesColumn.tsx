// The Path tool's piece swatches: the installed packs' path units, one tile each, and From
// library on the asset panel's Paths. A click picks what the next path is laid with.

import { useStore } from '@/store/store';
import { AddTile, DockColumn, Tile } from '@/editor/components';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import { pathPieceLabel, pathPieceOf, pathPieces } from '@dnd/core/src/assets/pathKit';
import { openAssets } from '@/editor/families/design/openAssets';

export function PiecesColumn() {
  const pieceId = useStore((s) => s.tools.settings.path.pieceId);
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const picked = pathPieceOf(pieceId)?.id;
  const pick = (id: string) =>
    useStore.setState((s) => {
      s.tools.settings.path.pieceId = id;
    });
  return (
    <DockColumn title="Pieces" data-column="pieces" data-testid="terrain-path-pieces">
      {pathPieces().map((e) => {
        const name = pathPieceLabel(e);
        return (
          <Tile key={e.id} name={name} aria-label={name} active={picked === e.id} data-piece={e.id} onClick={() => pick(e.id)}>
            <PackThumbnailCanvas textureId={e.id} fit="contain" />
          </Tile>
        );
      })}
      <AddTile name="From library" onClick={() => openAssets('path')} />
    </DockColumn>
  );
}
