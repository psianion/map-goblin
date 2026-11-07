// Draws a layer's Material brush patches into its materials sublayer: each patch's fill
// (the material's floor texture, tiled to the world like a floor) masked to its outline,
// then, with Border on, the material's border units laid round that outline by the cave
// band walk. The PNG export renders the same sublayer.

import { Container, Graphics } from 'pixi.js';
import type { DungeonLayer } from '../../store/types';
import { getLayerEntry } from '../sceneGraph';
import { bandFillColor, drawOutlineBand } from '../caveBandRenderer';
import { bandSetArt } from '../../assets/packCatalog';
import { materialFillId } from '../../assets/materialKit';
import { load, resolveTexture } from '../../assets/textureLoader';
import { fillPolygonsWithHoles, paintTiled } from '../floorWallRenderer';
import { useStore } from '../../store/store';
import { patchOutline, type MaterialPatch } from '../../shared/materialPatch';

/** Layers waiting on art to load, so one redraw follows however many textures land. */
const waiting = new Set<string>();
/** Art asked for once already: an id no pack delivers is not asked for again. */
const asked = new Set<string>();

function parseColor(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? 0x808080 : n;
}

/** Each art id the patches need that has not loaded; loads them and redraws the layer once they have. */
function awaitArt(layer: DungeonLayer, patches: readonly MaterialPatch[]): void {
  const ids = new Set<string>();
  for (const p of patches) {
    const fill = materialFillId(p.material);
    if (fill) ids.add(fill);
    if (p.border) for (const e of bandSetArt(p.material).values()) ids.add(e.id);
  }
  const missing = [...ids].filter((id) => !asked.has(id) && resolveTexture(id).width <= 1);
  if (missing.length === 0 || waiting.has(layer.id)) return;
  waiting.add(layer.id);
  for (const id of missing) asked.add(id);
  void Promise.all(missing.map((id) => load(id))).then(() => {
    waiting.delete(layer.id);
    const now = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layer.id && l.type === 'dungeon');
    if (now) drawLayerMaterials(now);
  });
}

/** Draws one patch into `host`. */
function drawPatch(host: Container, layer: DungeonLayer, patch: MaterialPatch): void {
  const outline = patchOutline(patch);
  if (outline.length === 0) return;
  const piece = new Container();
  piece.label = `material-${patch.id}`;
  const fillId = materialFillId(patch.material);
  const tex = fillId ? resolveTexture(fillId) : null;
  if (tex && tex.width > 1) {
    paintTiled(piece, outline, tex, { scale: 1, holes: true });
  } else {
    // No fill art yet: the floor colour, so the patch still reads as one solid piece.
    const g = new Graphics();
    fillPolygonsWithHoles(g, outline, { color: parseColor(layer.style.floorColor) });
    piece.addChild(g);
  }
  if (patch.border) {
    drawOutlineBand(piece, outline, patch.material, bandFillColor({ floorColor: layer.style.floorColor, textureId: fillId }));
  }
  host.addChild(piece);
}

/** Draws a layer's patches, replacing what was drawn; none clears the sublayer. */
export function drawLayerMaterials(layer: DungeonLayer): void {
  const host = getLayerEntry(layer.id)?.sublayers?.materials;
  if (!host) return;
  for (const child of host.removeChildren()) child.destroy({ children: true });
  const patches = layer.materials ?? [];
  if (patches.length === 0) return;
  awaitArt(layer, patches);
  for (const patch of patches) drawPatch(host, layer, patch);
}
