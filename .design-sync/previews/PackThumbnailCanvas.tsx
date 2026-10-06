import { PackThumbnailCanvas } from 'map-builder';

// Draws a pack entry's thumbnail from the installed texture atlas. With no pack
// installed it paints its empty frame — the honest first-run render.
export function Default() {
  return (
    <div className="inline-flex rounded-lg border border-border p-2">
      <PackThumbnailCanvas textureId="gg-demo/floor/cave-rock-01" />
    </div>
  );
}
