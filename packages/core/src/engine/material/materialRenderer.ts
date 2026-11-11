// Draws a layer's Material brush patches into its materials sublayer: each patch's fill
// (the material's floor texture, tiled to the world like a floor) masked to its outline,
// then, with Border on, the material's border units laid round that outline by the cave
// band walk; and the same rock round the layer's painted caves (floors marked with an edge
// material), along their own outline wherever it runs. The PNG export and the table render
// the same sublayer.

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
import { caveEdges, caveWallId, type CaveEdge } from '../../shared/caveFloor';
import { resolveDoors, resolveWalls, type ResolvedDoor } from '../../shared/wallResolve';
import type { DoorGap } from '../wallNodeRenderer';
import { getAssetPackManager } from '../assetPackInstance';

/** Layers waiting on art to load, so one redraw follows however many textures land. */
const waiting = new Set<string>();
/** Art asked for once already: an id no pack delivers is not asked for again. */
const asked = new Set<string>();

/** Art can land later than one wait: a decode clears `asked` so the next draw asks again. */
let watching = false;
function watchTextures(): void {
  if (watching) return;
  watching = true;
  getAssetPackManager().subscribeTextures(() => asked.clear());
}

function parseColor(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? 0x808080 : n;
}

/** Each art id the patches (and caves, as bordered patches) need that has not loaded; loads them and redraws the layer once they have. */
function awaitArt(layer: DungeonLayer, patches: readonly Pick<MaterialPatch, 'material' | 'border'>[]): void {
  watchTextures();
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

/**
 * The rock round a layer's painted caves of one material: the same walk a bordered patch
 * gets, laid along the union of the floors marked with it, stopped at the doors on it.
 * The floors' own fill is drawn with the other floors.
 */
function drawCave(host: Container, layer: DungeonLayer, cave: CaveEdge, doors: readonly ResolvedDoor[]): void {
  const piece = new Container();
  piece.label = `cave-${cave.material}`;
  const wallIds = new Set(cave.rings.map((_, i) => caveWallId(cave.material, i)));
  const gaps: DoorGap[] = doors
    .filter((d) => d.wall && wallIds.has(d.wall.id))
    .map((d) => ({ wallId: d.wall!.id, position: d.position, width: d.door.width }));
  drawOutlineBand(piece, cave.rings, cave.material, bandFillColor({ floorColor: layer.style.floorColor, textureId: materialFillId(cave.material) }), gaps);
  host.addChild(piece);
}

/** Draws a layer's patches and its painted caves' rock, replacing what was drawn; none clears the sublayer. */
export function drawLayerMaterials(layer: DungeonLayer): void {
  const host = getLayerEntry(layer.id)?.sublayers?.materials;
  if (!host) return;
  for (const child of host.removeChildren()) child.destroy({ children: true });
  const patches = layer.materials ?? [];
  const caves = caveEdges(layer);
  if (patches.length === 0 && caves.length === 0) return;
  awaitArt(layer, [...patches, ...caves.map((c) => ({ material: c.material, border: true }))]);
  if (caves.length > 0) {
    const doors = resolveDoors(layer, resolveWalls(layer)).filter((d) => d.door.visible && !d.detached);
    for (const cave of caves) drawCave(host, layer, cave, doors);
  }
  for (const patch of patches) drawPatch(host, layer, patch);
}
