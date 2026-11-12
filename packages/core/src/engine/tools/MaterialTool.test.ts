import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { MaterialTool } from './MaterialTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { patchArea } from '../../shared/materialPatch';
import { caveEdgeOpen, caveEdges, caveOpeningGaps } from '../../shared/caveFloor';
import { resolveWalls } from '../../shared/wallResolve';
import { computeMergedFloor } from '../mergedFloor';
import { layOutlineBand } from '../caveBandRenderer';
import { jointsOf } from '../../assets/caveWallKit';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer, ShapeChild } from '../../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const engine = { stage: () => ({ scale: { x: 1 } }) } as unknown as RenderEngine;
const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

function stroke(tool: MaterialTool, points: [number, number][]): void {
  tool.onPointerDown({ x: points[0][0], y: points[0][1] });
  for (const [x, y] of points.slice(1)) tool.onPointerMove({ x, y });
  tool.onPointerUp();
}

describe('MaterialTool', () => {
  let tool: MaterialTool;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(layer().id);
    undoManager.clear();
    // The patch cases: Paint a real floor (on by default) has its own block below.
    useStore.setState((s) => {
      s.tools.settings.material.floor = false;
    });
    tool = new MaterialTool(engine, new Container());
  });

  it('closes a stroke into one patch of the material in hand, one undo step', () => {
    stroke(tool, [[0, 0], [3, 0], [6, 0]]);
    const [patch] = layer().materials!;
    expect(patch).toMatchObject({ material: 'GG_Cave_Ink', smooth: true, border: true });
    expect(patchArea(patch.rings)).toBeCloseTo(6 * 6 + Math.PI * 9, 0);
    stroke(tool, [[6, 0], [12, 0]]);
    expect(layer().materials).toHaveLength(1);
    undoManager.undo();
    expect(patchArea(layer().materials![0].rings)).toBeCloseTo(6 * 6 + Math.PI * 9, 0);
    undoManager.undo();
    expect(layer().materials).toBeUndefined();
  });

  describe('with Paint a real floor on', () => {
    const floors = () => layer().children.filter((c): c is ShapeChild => c.childType === 'shape');
    beforeEach(() => {
      useStore.setState((s) => {
        s.tools.settings.material.floor = true;
      });
    });

    it('lands a stroke as one cave floor marked with the band, no patch, one undo step', () => {
      stroke(tool, [[0, 0], [3, 0], [6, 0]]);
      expect(layer().materials).toBeUndefined();
      expect(floors()).toHaveLength(1);
      expect(floors()[0]).toMatchObject({ name: 'Cave 1', shapeType: 'polygon', edgeMaterial: 'GG_Cave_Ink', styleOverrides: { wallTextureSetId: '' } });
      expect(patchArea(floors()[0].contours)).toBeCloseTo(6 * 6 + Math.PI * 9, -1);
      undoManager.undo();
      expect(floors()).toHaveLength(0);
    });

    it('merges a stroke into the floors of the same look it touches, keeping the first one’s id and name', () => {
      stroke(tool, [[0, 0], [6, 0]]);
      stroke(tool, [[20, 0], [26, 0]]);
      expect(floors().map((f) => f.name)).toEqual(['Cave 1', 'Cave 2']);
      const [a] = floors();
      stroke(tool, [[6, 0], [20, 0]]);
      expect(floors()).toHaveLength(1);
      expect(floors()[0]).toMatchObject({ id: a.id, name: 'Cave 1', edgeMaterial: 'GG_Cave_Ink' });
      expect(floors()[0].contours).toHaveLength(1);
      undoManager.undo();
      expect(floors()).toHaveLength(2);
    });

    it('keeps a stroke with Border off its own floor, unmarked and pinned to no stone', () => {
      stroke(tool, [[0, 0], [6, 0]]);
      useStore.setState((s) => {
        s.tools.settings.material.border = false;
      });
      stroke(tool, [[3, 0], [10, 0]]);
      expect(floors().map((f) => [f.edgeMaterial, f.styleOverrides?.wallTextureSetId])).toEqual([
        ['GG_Cave_Ink', ''],
        [undefined, ''],
      ]);
    });

    it('lands a stroke over an existing floor as a marked cave of its own, which owns its wall', () => {
      useStore.getState().addChild(layer().id, {
        id: 'base', name: 'Base', childType: 'shape', visible: true, shapeType: 'rectangle',
        contours: [[[-20, -20], [40, -20], [40, 20], [-20, 20]]],
        textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
      } as ShapeChild);
      stroke(tool, [[0, 0], [6, 0]]);
      expect(floors().map((f) => [f.id === 'base' ? 'base' : f.name, f.edgeMaterial])).toEqual([
        ['base', undefined],
        ['Cave 1', 'GG_Cave_Ink'],
      ]);
      expect(caveEdges(layer())).toHaveLength(1);
    });

    it('carves an erase out of the floors under it, one undo step', () => {
      stroke(tool, [[0, 0], [12, 0]]);
      const before = patchArea(floors()[0].contours);
      useStore.getState().setEraseMode(true);
      stroke(tool, [[6, -5], [6, 5]]);
      expect(floors()).toHaveLength(2);
      expect(floors().reduce((n, f) => n + patchArea(f.contours), 0)).toBeLessThan(before);
      undoManager.undo();
      expect(floors()).toHaveLength(1);
    });
  });

  describe('erasing across a painted cave’s rock', () => {
    const floors = () => layer().children.filter((c): c is ShapeChild => c.childType === 'shape');
    const floorArea = () => floors().reduce((n, f) => n + patchArea(f.contours), 0);
    /** The layer with its floor union, as the engine keeps it. */
    const live = (): DungeonLayer => ({ ...layer(), mergedFloor: computeMergedFloor(layer()) });
    /** Midpoints of the cave's ring edges, open ones or standing ones. */
    const mids = (open: boolean): [number, number][] =>
      caveEdges(layer()).flatMap((c) =>
        c.rings.flatMap((ring) =>
          ring.flatMap((a, i): [number, number][] => {
            const b = ring[(i + 1) % ring.length];
            return caveEdgeOpen(a, b, layer().caveOpenings) === open ? [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]] : [];
          }),
        ),
      );
    /** How near any resolved wall of the layer passes to `p`. */
    const wallNear = (p: [number, number]): number => {
      let best = Infinity;
      for (const w of resolveWalls(live())) {
        for (let i = 0; i + 1 < w.points.length; i++) {
          const [a, b] = [w.points[i], w.points[i + 1]];
          const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
        }
      }
      return best;
    };
    /** How near the cave's rock, as laid, comes to `p`. */
    const rockNear = (p: [number, number]): number => {
      let best = Infinity;
      for (const cave of caveEdges(layer())) {
        for (const pl of layOutlineBand(cave.rings, undefined, caveOpeningGaps(cave, layer().caveOpenings)).flat()) {
          for (const j of jointsOf(pl.piece, pl.at)) best = Math.min(best, Math.hypot(j[0] - p[0], j[1] - p[1]));
        }
      }
      return best;
    };
    const erase = (points: [number, number][], radius: number) => {
      useStore.setState((s) => {
        s.tools.settings.material.radius = radius;
      });
      useStore.getState().setEraseMode(true);
      stroke(tool, points);
      useStore.getState().setEraseMode(false);
    };

    beforeEach(() => {
      useStore.setState((s) => {
        s.tools.settings.material.floor = true;
      });
      // A cave from x -3 to 15, 6 tall.
      stroke(tool, [[0, 0], [6, 0], [12, 0]]);
      undoManager.clear();
    });

    it('leaves the cut open where the stroke crosses the outer rock: no rock, no wall of any kind, the floor cut as ever, one undo step', () => {
      const before = floorArea();
      expect(rockNear([12, 3.4])).toBeLessThan(1);
      erase([[15, 0], [19, 0]], 3);
      expect(floorArea()).toBeLessThan(before - 5);
      expect(layer().caveOpenings).toBeDefined();
      const open = mids(true);
      expect(open.length).toBeGreaterThan(3);
      // The bite's edge, at its deepest, is one of them.
      expect(open.some((m) => Math.hypot(m[0] - 12, m[1]) < 0.6)).toBe(true);
      for (const m of open) {
        expect(wallNear(m)).toBeGreaterThan(0.01);
        expect(rockNear(m)).toBeGreaterThan(0.3);
      }
      // No stone wall stands in for the rock: nothing but the cave's own wall is resolved, and it stops short.
      expect(resolveWalls(live()).every((w) => w.kind === 'cave')).toBe(true);
      expect(rockNear([12, 0])).toBeGreaterThan(1);
      // The rest of the cave keeps its rock and its wall.
      expect(wallNear([-3, 0])).toBeLessThan(0.3);
      // (Joints sit at the ends of pieces a couple of cells long.)
      expect(rockNear([-3, 0])).toBeLessThan(2.5);
      undoManager.undo();
      expect(floorArea()).toBeCloseTo(before, 3);
      expect(layer().caveOpenings).toBeUndefined();
      expect(undoManager.canUndo()).toBe(false);
    });

    it('rocks a hole all round when the stroke stays inside the cave, and records nothing', () => {
      erase([[6, 0]], 1);
      expect(layer().caveOpenings).toBeUndefined();
      expect(caveEdges(layer())[0].rings).toHaveLength(2);
      expect(mids(true)).toHaveLength(0);
      expect(resolveWalls(live()).filter((w) => w.kind === 'cave')).toHaveLength(2);
      expect(rockNear([7, 0])).toBeLessThan(1.2);
    });

    it('re-forms the rock round a crossing cut with Rock on cut edge on, and records nothing', () => {
      useStore.setState((s) => {
        s.tools.settings.material.rockOnCut = true;
      });
      const before = floorArea();
      erase([[15, 0], [19, 0]], 3);
      expect(floorArea()).toBeLessThan(before - 5);
      expect(layer().caveOpenings).toBeUndefined();
      expect(mids(true)).toHaveLength(0);
      expect(rockNear([12, 0])).toBeLessThan(1.2);
    });

    it('closes the opening when cave is painted back over it: the region goes and the rock is back, one undo step', () => {
      erase([[15, 0], [19, 0]], 3);
      expect(mids(true).length).toBeGreaterThan(0);
      undoManager.clear();
      useStore.setState((s) => {
        s.tools.settings.material.radius = 3;
      });
      stroke(tool, [[11, 0], [19, 0]]);
      expect(layer().caveOpenings).toBeUndefined();
      expect(mids(true)).toHaveLength(0);
      expect(rockNear([22, 0])).toBeLessThan(1.2);
      undoManager.undo();
      expect(layer().caveOpenings).toBeDefined();
      expect(mids(true).length).toBeGreaterThan(0);
      expect(undoManager.canUndo()).toBe(false);
    });

    it('opens the edge under a stroke over the rock alone, outside the floor, and leaves the floor as it was', () => {
      const before = floors().map((f) => f.contours);
      erase([[15.4, 0]], 0.3);
      expect(floors().map((f) => f.contours)).toEqual(before);
      expect(layer().caveOpenings).toBeDefined();
      const open = mids(true);
      expect(open.length).toBeGreaterThan(0);
      for (const m of open) {
        expect(Math.hypot(m[0] - 15.4, m[1])).toBeLessThan(1.5);
        expect(wallNear(m)).toBeGreaterThan(0.01);
      }
      expect(mids(false).length).toBeGreaterThan(open.length);
      undoManager.undo();
      expect(layer().caveOpenings).toBeUndefined();
    });

    it('leaves the floor a cave stands on whole under the cut, and still carves that floor away from the cave', () => {
      const ground: [number, number][] = [[-10, -10], [40, -10], [40, 10], [-10, 10]];
      useStore.getState().addChild(layer().id, { id: 'ground', name: 'Ground', childType: 'shape', visible: true, shapeType: 'rectangle', contours: [ground] } as ShapeChild);
      undoManager.clear();
      const groundNow = () => floors().find((f) => f.id === 'ground')!.contours;
      const caveBefore = floorArea() - patchArea([ground]);
      // Across the rock: the cave is cut and opened, the ground under it is not holed.
      erase([[15, 0], [19, 0]], 3);
      expect(groundNow()).toEqual([ground]);
      expect(floorArea() - patchArea([ground])).toBeLessThan(caveBefore - 5);
      expect(layer().caveOpenings).toBeDefined();
      // Out on the ground, well clear of the cave, the same eraser carves the ground as before.
      erase([[32, 0]], 1);
      expect(groundNow()).toHaveLength(2);
    });

    it('opens nothing for an erase nowhere near a cave', () => {
      erase([[40, 40]], 1);
      expect(layer().caveOpenings).toBeUndefined();
      expect(undoManager.canUndo()).toBe(false);
    });
  });

  it('erases with Erase mode, and an erase that takes it all leaves none', () => {
    stroke(tool, [[0, 0]]);
    useStore.getState().setEraseMode(true);
    stroke(tool, [[0, 0], [0.5, 0]]);
    expect(layer().materials).toBeUndefined();
    undoManager.undo();
    expect(layer().materials).toHaveLength(1);
  });

  describe('a plain texture, by where the stroke starts', () => {
    const FLOOR: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const xs = () => layer().materials!.flatMap((p) => p.rings.flat().map((pt) => pt[0]));
    beforeEach(() => {
      useStore.setState((s) => {
        s.tools.settings.material.material = 'p:grass';
        s.tools.settings.material.radius = 1;
        const l = s.layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;
        l.mergedFloor = [FLOOR];
      });
    });

    it('paints the floor it starts on and stops at its edge: stored trimmed, no ground flag', () => {
      stroke(tool, [[5, 5], [14, 5]]);
      const [patch] = layer().materials!;
      expect(patch).not.toHaveProperty('ground');
      expect(Math.max(...xs())).toBeCloseTo(10, 1);
    });

    it('paints ground when it starts off every floor: stored whole and flagged, even where it runs onto a floor', () => {
      stroke(tool, [[14, 5], [5, 5]]);
      const [patch] = layer().materials!;
      expect(patch.ground).toBe(true);
      expect(Math.min(...xs())).toBeCloseTo(4, 1);
      expect(Math.max(...xs())).toBeCloseTo(15, 1);
    });

    it('keeps ground and floor paint of one material as two patches, and paints ground on a layer with no floor', () => {
      stroke(tool, [[5, 5], [8, 5]]);
      stroke(tool, [[14, 5], [8, 5]]);
      expect(layer().materials!.map((p) => p.ground)).toEqual([undefined, true]);
      useStore.setState((s) => {
        const l = s.layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;
        l.mergedFloor = null;
        l.materials = undefined;
      });
      stroke(tool, [[5, 5], [8, 5]]);
      expect(layer().materials!.map((p) => p.ground)).toEqual([true]);
    });

    it('leaves a band set patch as it was: whole and unflagged wherever it starts', () => {
      useStore.setState((s) => {
        s.tools.settings.material.material = 'GG_Cave_Ink';
      });
      stroke(tool, [[14, 5], [5, 5]]);
      expect(layer().materials![0]).not.toHaveProperty('ground');
      expect(Math.min(...xs())).toBeCloseTo(4, 1);
    });
  });

  it('commits nothing for an erase over bare ground, or a stroke Escape drops', () => {
    useStore.getState().setEraseMode(true);
    stroke(tool, [[0, 0]]);
    useStore.getState().setEraseMode(false);
    tool.onPointerDown({ x: 0, y: 0 });
    tool.cancel();
    tool.onPointerUp();
    expect(layer().materials).toBeUndefined();
    expect(undoManager.canUndo()).toBe(false);
  });
});
