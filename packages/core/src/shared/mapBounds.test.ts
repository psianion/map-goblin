import { describe, it, expect, beforeEach } from 'vitest';
import { assetBounds, computeContentBounds, computeMapFrame } from './mapBounds';
import { useStore } from '../store/store';
import { readUvtt } from './import/uvtt';
import { importedMapToDocument } from './import/toDocument';
import type { AssetChild, DungeonLayer, Layer, WallSegment } from '../store/types';

function dungeonLayer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function layerWith(mergedFloor: [number, number][][] | null): DungeonLayer {
  return { ...dungeonLayer(), mergedFloor, children: [], standaloneWalls: [] };
}

function makeWall(points: [number, number][], width = 0.4): WallSegment {
  return {
    id: `wall-${points[0]?.join('_')}`,
    points,
    wallType: 'normal',
    direction: 'both',
    color: '#888888',
    width,
    roughness: 0,
  };
}

function makeAsset(x: number, y: number, visible = true): AssetChild {
  return {
    id: `asset-${x}_${y}`,
    name: 'Barrel',
    childType: 'asset',
    visible,
    objectType: 'asset',
    assetId: 'barrel',
    position: { x, y },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 2,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

beforeEach(() => useStore.getState().resetToDefault());

describe('computeContentBounds', () => {
  it('is null on a map with nothing drawn — no 10x10 export default here', () => {
    expect(computeContentBounds([layerWith(null)], null)).toBeNull();
  });

  it('survives a document with sparse layers (no children, no style)', () => {
    const bare = {
      ...layerWith([[[0, 0], [4, 0], [4, 3], [0, 3]]]),
      children: undefined,
      style: undefined,
    } as unknown as Layer;
    const b = computeContentBounds([bare], null);
    expect(b).not.toBeNull();
    expect(Number.isFinite(b!.minX)).toBe(true);
    expect(Number.isFinite(b!.maxY)).toBe(true);
  });

  it('measures a wall-only map — a wall drawn on empty ground is still map', () => {
    const layer = { ...layerWith(null), standaloneWalls: [makeWall([[3, 4], [9, 4]])] };
    const b = computeContentBounds([layer], null);
    expect(b!.minX).toBeLessThanOrEqual(3);
    expect(b!.maxX).toBeGreaterThanOrEqual(9);
    expect(b!.minY).toBeLessThanOrEqual(4);
  });

  it('pads floor geometry by half the layer wall width plus the AA margin', () => {
    const layer = layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]]);
    const pad = layer.style.wallWidth / 2 + 0.05;
    const b = computeContentBounds([layer], null);
    expect(b!.minX).toBeCloseTo(2 - pad);
    expect(b!.minY).toBeCloseTo(2 - pad);
    expect(b!.maxX).toBeCloseTo(7 + pad);
    expect(b!.maxY).toBeCloseTo(5 + pad);
  });

  it('grows for a standalone wall wider than its layer style', () => {
    const thin = computeContentBounds(
      [{ ...layerWith(null), standaloneWalls: [makeWall([[0, 0], [4, 0]], 0.2)] }],
      null,
    );
    const fat = computeContentBounds(
      [{ ...layerWith(null), standaloneWalls: [makeWall([[0, 0], [4, 0]], 3)] }],
      null,
    );
    expect(fat!.maxX).toBeGreaterThan(thin!.maxX);
  });

  it('measures an asset-only map — placing art grows the boundary', () => {
    const layer = { ...layerWith(null), children: [makeAsset(10, 10)] };
    const b = computeContentBounds([layer], null);
    // The 2x2 sprite reaches one cell each way, plus the wall-stroke padding
    // computeContentBounds adds on top of raw content.
    expect(b!.minX).toBeLessThanOrEqual(9);
    expect(b!.maxY).toBeGreaterThanOrEqual(11);
  });

  it('measures a sprite as its own rectangle, not a circle of its diagonal', () => {
    // A battlemap is the case that made this matter: taking half the diagonal measured a
    // 16x22.55 image as 27x27, and that slack became export pixels and fog cells.
    const battlemap = { ...makeAsset(0, 0), width: 16, height: 22.55 };
    expect(assetBounds([{ ...layerWith(null), children: [battlemap] }])).toEqual({
      minX: -8,
      minY: -11.275,
      maxX: 8,
      maxY: 11.275,
    });
  });

  it('still contains a rotated sprite', () => {
    const spun = { ...makeAsset(0, 0), rotation: Math.PI / 4 };
    const b = assetBounds([{ ...layerWith(null), children: [spun] }])!;
    // A 2x2 turned 45° genuinely does reach half its diagonal on both axes.
    expect(b.maxX).toBeCloseTo(Math.SQRT2, 6);
    expect(b.maxY).toBeCloseTo(Math.SQRT2, 6);
  });

  it('ignores hidden assets', () => {
    const floor: [number, number][][] = [[[0, 0], [4, 0], [4, 4], [0, 4]]];
    const baseline = computeContentBounds([layerWith(floor)], null);
    const hidden = computeContentBounds(
      [{ ...layerWith(floor), children: [makeAsset(40, 40, false)] }],
      null,
    );
    expect(hidden).toEqual(baseline);
  });

  it('measures a patch as it is drawn: paint on a floor no further than the floors, ground and band patches whole', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const spill = { id: 'p', material: 'p:grass', rings: [[[5, 2], [30, 2], [30, 8], [5, 8]]] as [number, number][][], smooth: false, border: false };
    const baseline = computeContentBounds([layerWith(floor)], null)!;
    expect(computeContentBounds([{ ...layerWith(floor), materials: [spill] }], null)).toEqual(baseline);
    expect(computeContentBounds([{ ...layerWith(floor), materials: [{ ...spill, ground: true }] }], null)!.maxX).toBeGreaterThan(baseline.maxX + 19);
    expect(computeContentBounds([{ ...layerWith(floor), materials: [{ ...spill, material: 'GG_Cave_Ink' }] }], null)!.maxX).toBeGreaterThan(baseline.maxX + 19);
    // With no floor on the layer nothing trims the paint.
    expect(computeContentBounds([{ ...layerWith(null), materials: [spill] }], null)!.maxX).toBeGreaterThanOrEqual(30);
  });
});

describe('computeMapFrame', () => {
  it('is null while nothing is drawn — an empty map is all void, no frame', () => {
    expect(computeMapFrame([layerWith(null)], null)).toBeNull();
  });

  it('a locked size is the frame itself, whatever is drawn past it', () => {
    const layers = [layerWith([[[-4, -4], [40, -4], [40, 30], [-4, 30]]])];
    expect(computeMapFrame(layers, null, { width: 20, height: 10, locked: true })).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    // The same size not locked is a minimum: the frame grows to hold what is drawn.
    const grown = computeMapFrame(layers, null, { width: 20, height: 10 })!;
    expect(grown.minX).toBeLessThan(0);
    expect(grown.maxX).toBeGreaterThan(20);
  });

  it('snaps content bounds out to the enclosing whole cells, plus a cell all round', () => {
    const frame = computeMapFrame([layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])], null);
    // Content bounds carry sub-cell padding (half the wall stroke + AA, 0.3 with the
    // default style): floor(2 - 0.3) = 1, then one more cell of clear air = 0.
    expect(frame).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 7 });
  });

  it('leaves a full cell of clear ground past the outermost geometry', () => {
    const frame = computeMapFrame([layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])], null);
    expect(2 - frame!.minX).toBeGreaterThanOrEqual(1);
    expect(2 - frame!.minY).toBeGreaterThanOrEqual(1);
    expect(frame!.maxX - 7).toBeGreaterThanOrEqual(1);
    expect(frame!.maxY - 5).toBeGreaterThanOrEqual(1);
  });

  it('takes a fixed size over the measured one, anchored at the origin', () => {
    const layers = [layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])];
    expect(computeMapFrame(layers, null, { width: 30, height: 20 })).toEqual({
      minX: 0, minY: 0, maxX: 30, maxY: 20,
    });
    // A fixed map has a frame even with nothing drawn on it
    expect(computeMapFrame([layerWith(null)], null, { width: 8, height: 8 })).toEqual({
      minX: 0, minY: 0, maxX: 8, maxY: 8,
    });
  });

  it('a pinned map with nothing drawn keeps exactly its pinned size', () => {
    expect(computeMapFrame([layerWith(null)], null, { width: 30, height: 20 })).toEqual({
      minX: 0, minY: 0, maxX: 30, maxY: 20,
    });
  });

  it("a pinned map's frame grows to enclose content drawn past its edge", () => {
    // A 30x20 pin with the dungeon built on down to y=26: the bottom moves out to the
    // measured frame's edge, and the three sides nothing crossed stay where they were pinned.
    const layers = [layerWith([[[2, 4], [28, 4], [28, 26], [2, 26]]])];
    const frame = computeMapFrame(layers, null, { width: 30, height: 20 })!;
    expect(frame.maxY).toBeGreaterThan(20);
    expect(frame.maxY - 26).toBeGreaterThanOrEqual(1);
    expect(frame.minX).toBe(0);
    expect(frame.minY).toBe(0);
    expect(frame.maxX).toBe(30);
    // The same edge a growing map would measure on that side
    expect(frame.maxY).toBe(computeMapFrame(layers, null)!.maxY);
  });

  it('keeps the pin where content is built flush to it, stroke padding and all', () => {
    // An imported battlemap is a sprite exactly the size of the pin; its wall-stroke padding
    // pokes past the edge, but nothing drawn does, so the frame stays the pinned one.
    const battlemap = { ...makeAsset(15, 10), width: 30, height: 20 };
    expect(
      computeMapFrame([{ ...layerWith(null), children: [battlemap] }], null, { width: 30, height: 20 }),
    ).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 20 });
  });

  it('keeps an imported map at its pinned size: battlemap exactly covering it, walls on it', () => {
    // The shape a UVTT import builds: a 65x33 pin, a locked sprite exactly that size, and
    // walls running right along all four edges of the image.
    const battlemap = { ...makeAsset(32.5, 16.5), objectType: 'image' as const, width: 65, height: 33 };
    const walls = [
      makeWall([[0, 0], [65, 0], [65, 33], [0, 33], [0, 0]], 0.25),
      makeWall([[10, 4], [10, 20]], 0.25),
    ];
    expect(
      computeMapFrame(
        [{ ...layerWith(null), children: [battlemap] }, { ...layerWith(null), standaloneWalls: walls }],
        null,
        { width: 65, height: 33 },
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 65, maxY: 33 });
  });

  it('keeps a Dungeondraft import at its pinned size though its walls hug the image from outside', () => {
    // Pools of Mystery: 65x33 at 32 px a cell, the outer walls written a fraction of a cell
    // past the left and top edges. Unclamped, the frame came out 67x35.
    const file = {
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 65, y: 33 }, pixels_per_grid: 32 },
      line_of_sight: [
        [{ x: -0.296875, y: 3.15625 }, { x: -0.160156, y: 3.464844 }, { x: 1.527344, y: -0.136719 }, { x: 64, y: 0.5 }],
        [{ x: 64, y: 32 }, { x: 40, y: 32 }],
      ],
      portals: [{ bounds: [{ x: -0.2, y: 10 }, { x: 0.8, y: 10 }], closed: true }],
      image: '/9j/AAAA',
    };
    const doc = importedMapToDocument(readUvtt(file, 'Pools'));
    expect(computeMapFrame(doc.layers, null, doc.mapSettings.fixedSize)).toEqual({
      minX: 0, minY: 0, maxX: 65, maxY: 33,
    });
  });

  it('cuts a lined-up battlemap hanging under a cell past its pinned edges instead of growing', () => {
    // 36x24 lined up with its grid 0.3 cells in from the picture's left and 0.4 from its top:
    // the picture runs from -0.3 to 36.2 and -0.4 to 24.3.
    const battlemap = { ...makeAsset(17.95, 11.95), objectType: 'image' as const, width: 36.5, height: 24.7 };
    expect(computeMapFrame([{ ...layerWith(null), children: [battlemap] }], null, { width: 36, height: 24 })).toEqual({
      minX: 0, minY: 0, maxX: 36, maxY: 24,
    });
    // A whole cell or more past the edge is drawn content, and still grows the frame.
    const wide = { ...battlemap, position: { x: 17.95 - 1.2, y: 11.95 } };
    expect(computeMapFrame([{ ...layerWith(null), children: [wide] }], null, { width: 36, height: 24 })!.minX).toBeLessThan(-1);
    // And anything else past the edge grows it as before: a prop, not a picture.
    const prop = { ...battlemap, objectType: 'asset' as const };
    expect(computeMapFrame([{ ...layerWith(null), children: [prop] }], null, { width: 36, height: 24 })!.minX).toBeLessThan(0);
  });

  it('grows a pinned map out to the left and top as well', () => {
    const frame = computeMapFrame(
      [{ ...layerWith(null), standaloneWalls: [makeWall([[-4, -3], [10, -3]])] }],
      null,
      { width: 30, height: 20 },
    )!;
    expect(frame.minX).toBeLessThanOrEqual(-5);
    expect(frame.minY).toBeLessThanOrEqual(-4);
    expect(frame.maxX).toBe(30);
    expect(frame.maxY).toBe(20);
  });

  it('measures floor shape children when mergedFloor is null — the server case', () => {
    // Saved files ship mergedFloor null (derived cache); the session server measures
    // frames off exactly such documents at redaction time.
    const shape = {
      id: 's1',
      name: 'Rectangle 1',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[2, 2], [7, 2], [7, 5], [2, 5]]],
    };
    const layer = { ...layerWith(null), children: [shape] } as unknown as Layer;
    expect(computeMapFrame([layer], null)).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 7 });
  });

  it('measures a plateau outside the floors, out to where its edge falls', () => {
    const floor = [[[0, 0], [4, 0], [4, 4], [0, 4]]] as [number, number][][];
    const plateau = (edge: string, height: number) => ({
      id: 'p',
      name: 'Mesa',
      childType: 'plateau',
      visible: true,
      contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]],
      height,
      edge,
      slopeWidth: 2,
    });
    const frame = (edge: string, height: number) =>
      computeContentBounds([{ ...layerWith(floor), children: [plateau(edge, height)] } as unknown as Layer], null)!;
    // The ring's own reach: half the wall stroke plus the AA margin on top of the plateau's.
    const stroke = frame('none', 0).maxX - 14;
    expect(frame('none', 2).maxY).toBeGreaterThanOrEqual(14);
    // Edge None reaches its drop shade: 0.21 cell at +1, 0.33 at +3.
    expect(frame('none', 1).maxX - stroke).toBeCloseTo(14.21, 6);
    expect(frame('none', 3).maxX - stroke).toBeCloseTo(14.33, 6);
    // A slope reaches its band, the card's width, whatever the drop; a pit's falls inward.
    expect(frame('slope', 3).maxX - stroke).toBeCloseTo(16, 6);
    expect(frame('slope', 1).maxX - stroke).toBeCloseTo(16, 6);
    expect(frame('slope', -3).maxX).toBeLessThan(frame('slope', 3).maxX);
    // A cliff reaches past its shade to what hangs off its ledge.
    expect(frame('cliff', 1).maxX - stroke).toBeCloseTo(15.2, 6);
    expect(frame('cliff', 3).maxX - stroke).toBeCloseTo(15.2, 6);
  });

  it('includes painted terrain in the frame', () => {
    const frame = computeMapFrame(
      [layerWith([[[0, 0], [2, 0], [2, 2], [0, 2]]])],
      { minX: -10, minY: -6, maxX: 3, maxY: 3 },
    );
    expect(frame!.minX).toBeLessThanOrEqual(-11);
    expect(frame!.minY).toBeLessThanOrEqual(-7);
  });
});
