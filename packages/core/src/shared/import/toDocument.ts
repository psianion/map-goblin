// `ImportedMap` → a `.mapbuilder` document, the same shape `loadMap` feeds the store.
// Two layers: a locked `Battlemap` holding the image, and `Walls` holding every wall,
// door and light so the DM draws on an unlocked layer from the first click.

import type { AssetChild, DoorChild, LightChild, WallSegment } from '../types';
import type { SerializedMapData } from '../../store/types';
import { createBackgroundLayer, createDungeonLayer } from '../../store/factories';
import type { ImportedMap } from './types';

export function importedMapToDocument(map: ImportedMap): SerializedMapData {
  const background = createBackgroundLayer();
  const base = createDungeonLayer('Battlemap');
  const walls = createDungeonLayer('Walls');
  const customImages: Record<string, string> = {};

  if (map.image) {
    const assetId = crypto.randomUUID();
    customImages[assetId] = map.image.dataUrl;
    const width = map.image.width / map.image.pxPerCell;
    const height = map.image.height / map.image.pxPerCell;
    const image: AssetChild = {
      id: crypto.randomUUID(),
      name: 'Battlemap',
      childType: 'asset',
      visible: true,
      objectType: 'image',
      assetId,
      position: { x: width / 2, y: height / 2 },
      rotation: 0,
      scale: 1,
      width,
      height,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
    };
    base.children.push(image);
    base.locked = true;
  }

  const segment = (points: [number, number][], wallType: WallSegment['wallType'], direction: WallSegment['direction']): WallSegment => ({
    id: crypto.randomUUID(),
    points,
    wallType,
    direction,
    color: walls.style.wallColor,
    width: walls.style.wallWidth,
    roughness: 0,
  });

  for (const w of map.walls) walls.standaloneWalls.push(segment(w.points, w.wallType, w.direction));

  for (const [i, d] of map.doors.entries()) {
    const host = segment([d.a, d.b], 'normal', 'both');
    walls.standaloneWalls.push(host);
    const dx = d.b[0] - d.a[0];
    const dy = d.b[1] - d.a[1];
    const door: DoorChild = {
      id: crypto.randomUUID(),
      // Numbered so the table's door list is not thirty rows that all say "Door".
      name: `${d.isSecret ? 'Secret door' : d.archway ? 'Doorway' : 'Door'} ${i + 1}`,
      childType: 'door',
      visible: true,
      wallId: host.id,
      position: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2],
      angle: Math.atan2(dy, dx),
      width: Math.hypot(dx, dy),
      style: d.archway ? 'archway' : 'single',
      state: d.archway ? 'open' : d.state,
      isSecret: d.isSecret,
    };
    walls.children.push(door);
  }

  for (const l of map.lights) {
    const light: LightChild = {
      id: crypto.randomUUID(),
      name: 'Light',
      childType: 'light',
      visible: !l.hidden,
      color: l.color,
      radius: l.radius,
      featherRadius: l.featherRadius,
      intensity: l.intensity,
      falloff: 'quadratic',
      position: { x: l.x, y: l.y },
    };
    walls.children.push(light);
  }

  return {
    version: '3.1',
    mapSettings: {
      name: map.name,
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#2d2d44',
      fixedSize: { width: map.size.width, height: map.size.height },
    },
    grid: { visible: true, snapDivision: 2 },
    layers: [background, base, walls],
    customImages,
  };
}
