import { AddTile, Tile } from '@dnd/ui';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

function TilesSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section id="tiles" title="Tiles and swatches" small="56 × 44" theme={theme}>
      <Specimens>
        <Item cap={'tile 56 × 44 · radius 6 · name 10 under, 3px gap, ellipsis\nrest · active ring · locked badge · material · active material · long name · add (dashed)'}>
          <div className="flex gap-1.5">
            <Tile name="Terrain" />
            <Tile name="Stone floor" active />
            <Tile name="Walls" locked />
            <Tile name="Moss" color="#8c9a6c" />
            <Tile name="Flagstone" active color="#b9ad96" />
            <Tile name="Cracked earth is long" color="#a08f74" />
            <AddTile name="From library" />
          </div>
        </Item>
      </Specimens>
    </Section>
  );
}

export { TilesSection };
