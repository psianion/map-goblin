// src/testing/caveSpeed.ts
//
// Test-only: what opening a map and painting on it costs, timed through the paths the editor
// takes. A map is loaded into the store as a file is, its dungeon layers drawn into scene
// entries by `rebuildDungeonLayer` and `drawLayerMaterials`, and the store watched the way the
// editor watches it: a layer whose late-art epoch moves is drawn again on the next frame.
//
// Cold is the first lay and draw of a map in fresh modules, nothing kept from before; warm is
// the same draw again with nothing changed. A late texture is one piece's art withheld from the
// open and then landing. A stroke step is one Material brush dab on the edge of a brush cave of
// about 40 cells, painted or erased, and the layer drawn again; each dab lands somewhere new.
//
// The art is a stand-in: one 200 px texture for every id, withheld ids a 1 px one. The file
// calling this mocks the texture loader with `mockTextureLoader` and the frame clock with
// `useFrames`.

import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Container, Texture, TextureSource } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import type { DungeonLayer } from '../store/types';
import type { Polygon } from '../types/geometry';

/* ── The art ─────────────────────────────────────────────────────────── */

interface ArtState {
  /** Ids that have not landed yet. */
  withheld: Set<string>;
  /** Loads waiting on an id. */
  waiting: Map<string, (() => void)[]>;
  /** Withheld ids something asked for. */
  asked: Set<string>;
  loaded: Texture;
  missing: Texture;
}

const ART_KEY = '__caveSpeedArt';

/** The art the stand-in loader serves, shared by every fresh copy of the modules. */
export function artState(): ArtState {
  const g = globalThis as unknown as Record<string, ArtState | undefined>;
  return (g[ART_KEY] ??= {
    withheld: new Set(),
    waiting: new Map(),
    asked: new Set(),
    loaded: new Texture({ source: new TextureSource({ width: 200, height: 200 }) }),
    missing: new Texture({ source: new TextureSource({ width: 1, height: 1 }) }),
  });
}

/** The texture loader with the stand-in art: `vi.mock('../assets/textureLoader', async (o) => mockTextureLoader(await o()))`. */
export function mockTextureLoader<T extends object>(actual: T): T {
  const art = artState();
  const resolveTexture = (id: string): Texture => {
    if (!art.withheld.has(id)) return art.loaded;
    art.asked.add(id);
    return art.missing;
  };
  const load = (id: string): Promise<Texture> =>
    art.withheld.has(id)
      ? new Promise((resolve) => art.waiting.set(id, [...(art.waiting.get(id) ?? []), () => resolve(art.loaded)]))
      : Promise.resolve(art.loaded);
  return { ...actual, resolveTexture, load };
}

/* ── Frames ──────────────────────────────────────────────────────────── */

const frameQueue: FrameRequestCallback[] = [];

/** Animation frames run only when `frame` says so. */
export function useFrames(): void {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => frameQueue.push(cb);
  globalThis.cancelAnimationFrame = (): void => {};
}

/** Runs one animation frame: every callback queued before it began. */
export function frame(): number {
  const now = frameQueue.splice(0);
  for (const cb of now) cb(performance.now());
  return now.length;
}

/* ── The modules, fresh ──────────────────────────────────────────────── */

let wasmBinary: Buffer | null = null;

/** A Clipper of its own: a long run of fresh maps would fill one instance's heap. */
async function clipperWasm(): Promise<MainModule> {
  wasmBinary ??= readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  return (await mod.default({ wasmBinary })) as MainModule;
}

/** Everything a speed run drives, from one copy of the modules. */
export interface SpeedMods {
  store: typeof import('../store/store');
  floors: typeof import('../engine/floorWallRenderer');
  materials: typeof import('../engine/material/materialRenderer');
  scene: typeof import('../engine/sceneGraph');
  merged: typeof import('../engine/mergedFloor');
  tool: typeof import('../engine/tools/MaterialTool');
  erase: typeof import('../engine/tools/eraseShapes');
  patch: typeof import('../shared/materialPatch');
  seed: typeof import('../testing/seedCatalog');
  soft: typeof import('../engine/softPiece');
  packs: typeof import('../engine/assetPackInstance');
  band: typeof import('../engine/caveBandRenderer');
}

/** A fresh copy of every module: nothing a rebuild keeps survives from the last. */
export async function freshMods(): Promise<SpeedMods> {
  vi.resetModules();
  const mods: SpeedMods = {
    store: await import('../store/store'),
    floors: await import('../engine/floorWallRenderer'),
    materials: await import('../engine/material/materialRenderer'),
    scene: await import('../engine/sceneGraph'),
    merged: await import('../engine/mergedFloor'),
    tool: await import('../engine/tools/MaterialTool'),
    erase: await import('../engine/tools/eraseShapes'),
    patch: await import('../shared/materialPatch'),
    seed: await import('../testing/seedCatalog'),
    soft: await import('../engine/softPiece'),
    packs: await import('../engine/assetPackInstance'),
    band: await import('../engine/caveBandRenderer'),
  };
  (await import('../geometry/Clipper2Engine')).setClipperModule(await clipperWasm());
  // A live GL context, as far as the soft pieces ask: their masks are kept as the editor keeps them.
  const engine = {
    renderer: () => ({ gl: { isContextLost: () => false } }),
    renderToTexture: () => {},
    canvas: () => {
      throw new Error('no canvas');
    },
  };
  mods.soft.setSoftPieceEngine(engine as never);
  return mods;
}

/* ── A map, open ─────────────────────────────────────────────────────── */

/** A map to time: its file, the packs it is drawn with, and the material its brush caves are painted in. */
export interface SpeedMap {
  name: string;
  file: () => unknown;
  seed: (mods: SpeedMods) => void;
  material: string;
}

/** A map open in the editor: its layers drawn, the store watched. */
export interface OpenMap {
  mods: SpeedMods;
  ids: string[];
  /** Draws every dungeon layer as a rebuild does. */
  drawAll: () => void;
  /** Runs one frame: whatever the store's late-art epochs queued is drawn. Returns how many layers were. */
  frame: () => number;
  /** Layers drawn since the map opened. */
  draws: () => number;
  close: () => void;
}

const dungeons = (mods: SpeedMods): DungeonLayer[] =>
  mods.store.useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');

/** Loads `map` into the store and draws it, as opening it does. */
export function openMap(mods: SpeedMods, map: SpeedMap): OpenMap {
  const { useStore } = mods.store;
  useStore.getState().resetToDefault();
  map.seed(mods);
  useStore.getState().loadFromFile(structuredClone(map.file()) as never);
  const layerContainer = new Container();
  const sceneGraph = { layerContainer } as never;
  const ids = dungeons(mods).map((l) => l.id);
  for (const id of ids) mods.scene.addLayerToScene(null as never, sceneGraph, id, 'dungeon');
  let draws = 0;
  const draw = (id: string): void => {
    const now = (): DungeonLayer | undefined => dungeons(mods).find((l) => l.id === id);
    const layer = now();
    const entry = mods.scene.getLayerEntry(id);
    if (!layer || !entry) return;
    mods.floors.rebuildDungeonLayer(layer, entry);
    mods.materials.drawLayerMaterials(now()!);
    draws++;
  };
  const drawAll = (): void => ids.forEach(draw);
  // The editor's watch: a layer's late-art epoch is part of its render key, drawn a frame later.
  const queued = new Set<string>();
  let epochs = useStore.getState().floorTextureEpochs;
  const unsub = useStore.subscribe((s) => {
    if (s.floorTextureEpochs === epochs) return;
    for (const id of ids) if ((s.floorTextureEpochs[id] ?? 0) !== (epochs[id] ?? 0)) queued.add(id);
    epochs = s.floorTextureEpochs;
  });
  return {
    mods,
    ids,
    drawAll,
    frame: () => {
      frame();
      const now = [...queued];
      queued.clear();
      now.forEach(draw);
      return now.length;
    },
    draws: () => draws,
    close: () => {
      unsub();
      for (const id of ids) mods.scene.removeLayerFromScene({ layerContainer } as never, id);
    },
  };
}

/** Art lands: each of `ids` is decoded and the manager says so on the next frame. */
export function land(mods: SpeedMods, ids: string[]): void {
  const art = artState();
  const manager = mods.packs.getAssetPackManager() as unknown as { textureCache: Map<string, Texture>; scheduleTextureNotify: () => void };
  for (const id of ids) {
    art.withheld.delete(id);
    manager.textureCache.set(id, art.loaded);
    const waiting = art.waiting.get(id) ?? [];
    art.waiting.delete(id);
    waiting.forEach((w) => w());
  }
  manager.scheduleTextureNotify();
}

/** Every pack texture id the open map draws: each withheld while it is drawn, and asked for. */
export function drawnArtIds(open: OpenMap): string[] {
  const art = artState();
  const manager = open.mods.packs.getAssetPackManager() as unknown as { manifestCache: Map<string, { entries: Record<string, unknown> }> };
  const all: string[] = [];
  for (const [packId, manifest] of manager.manifestCache) for (const key of Object.keys(manifest.entries)) all.push(`${packId}:${key}`);
  all.forEach((id) => art.withheld.add(id));
  art.asked.clear();
  open.drawAll();
  const drawn = [...art.asked].sort();
  art.withheld.clear();
  art.waiting.clear();
  open.drawAll();
  return drawn;
}

/** Rock art among `ids`: the band pieces, not the floors' fills. */
export const rockArt = (ids: string[]): string[] => ids.filter((id) => !/floor/.test(id));

/* ── The maps' packs ─────────────────────────────────────────────────── */

/** The forge's Cave Ink kit and a stone wall set, as the repo's own maps are drawn. */
export function seedInk(mods: SpeedMods): void {
  mods.seed.seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
  mods.seed.seedTestWallSets(['GG_Fieldstone'], 'gg-stone');
}

/** The measured kit the speed maps are drawn with when no real one is at hand. */
export const MEASURED_SET = 'Speed_Cave';

/**
 * A measured kit drawn like a real cave set (as caveKitMap.test.ts seeds one): straights of 1
 * to 8 cells whose rock wavers along a spine, an inside and an outside bend in 2, 3 and 4
 * cells, and two round lumps of rock for connectors.
 */
export function seedMeasured(mods: SpeedMods): void {
  const entry = (material: string, gridSize: string, band: Record<string, unknown>) => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: MEASURED_SET, tags: ['colored'], band });
  const entries: Record<string, unknown> = {};
  for (let L = 1; L <= 8; L++) {
    const end = L / 2 + 0.15;
    const spine: [number, number][] = [];
    for (let k = 0; k <= L * 4; k++) {
      const x = L / 2 - k / 4;
      spine.push([+x.toFixed(3), +(0.23 + 0.07 * Math.sin(2.3 * x + L)).toFixed(3)]);
    }
    entries[`run_${L}x2_A`] = entry('run', `${L}x2`, { joints: [[end, 0.36], [-end, 0.36]], turnDeg: 0, spine });
  }
  for (const N of [2, 3, 4]) {
    const end = N / 2 + 0.15;
    entries[`turn_in_${N}x${N}_A`] = entry('turn_in', `${N}x${N}`, { joints: [[N / 2 - 0.64, -end], [-end, N / 2 - 0.64]], turnDeg: 90 });
    entries[`turn_out_${N}x${N}_A`] = entry('turn_out', `${N}x${N}`, { joints: [[-end, N / 2 - 1.36], [N / 2 - 1.36, -end]], turnDeg: -90 });
  }
  entries.lump_2x2_A = entry('lump', '2x2', { joints: [[0.04, 0], [0.04, 0]], turnDeg: 0, connector: true, radius: 0.7 });
  entries.lump_3x3_A = entry('lump', '3x3', { joints: [[0, -0.05], [0, -0.05]], turnDeg: 0, connector: true, radius: 1 });
  mods.seed.seedPack('speed-pack', entries as never);
  seedInk(mods);
}

/** A map file with its Cave Ink rock, cave edges and cliffs swapped for `set` (stone walls kept). */
export function withCaveKit(file: unknown, set: string): unknown {
  type Child = { childType: string; edge?: string; edgeArt?: string; edgeMaterial?: string; styleOverrides?: { wallTextureSetId?: string } };
  const map = structuredClone(file) as { layers: { type: string; style: { wallTextureSetId?: string }; rockLines?: unknown; children: Child[] }[] };
  const swap = (s?: string): string | undefined => (s === 'GG_Cave_Ink' ? set : s);
  for (const layer of map.layers) {
    if (layer.type !== 'dungeon') continue;
    layer.style.wallTextureSetId = swap(layer.style.wallTextureSetId);
    for (const c of layer.children) {
      if (c.edgeMaterial) c.edgeMaterial = set;
      if (c.styleOverrides?.wallTextureSetId) c.styleOverrides.wallTextureSetId = swap(c.styleOverrides.wallTextureSetId);
      if (c.childType === 'plateau' && c.edge === 'cliff') c.edgeArt = set;
    }
    delete layer.rockLines;
  }
  return map;
}

/* ── A brush cave ────────────────────────────────────────────────────── */

/** Where the timed brush cave lies: well clear of every map's own drawing. */
const CAVE_AT: [number, number] = [-60, -60];
/** Its radius: about 40 cells of floor. */
const CAVE_R = 3.6;
/** The dab's radius, cells. */
const DAB = 1;

const circle = (c: [number, number], r: number, n = 48): Polygon =>
  Array.from({ length: n }, (_, k): [number, number] => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)]);

/** Paints the brush cave the strokes are timed on, onto the first dungeon layer. */
export function paintBrushCave(open: OpenMap, material: string): void {
  const { useStore } = open.mods.store;
  const id = open.ids[0];
  const settings = { ...useStore.getState().tools.settings.material, material };
  const layer = dungeons(open.mods).find((l) => l.id === id)!;
  open.mods.tool.paintCaveFloor(layer, id, [circle(CAVE_AT, CAVE_R)], settings);
  redrawUnion(open);
}

/** The first dungeon layer drawn again, its union worked out afresh first, as the editor's shapes watch does. */
function redrawUnion(open: OpenMap): void {
  const { useStore } = open.mods.store;
  const id = open.ids[0];
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === id) as DungeonLayer;
    l.mergedFloor = open.mods.merged.computeMergedFloor(l as DungeonLayer);
  });
  open.drawAll();
}

/** The `k`th dab on the brush cave's edge: each somewhere new along it. */
function dabAt(k: number): [number, number] {
  const a = 0.37 + k * 0.29;
  return [CAVE_AT[0] + CAVE_R * Math.cos(a), CAVE_AT[1] + CAVE_R * Math.sin(a)];
}

/** One stroke step: the `k`th dab painted (or erased) on the brush cave, and the layer drawn again. */
export function strokeStep(open: OpenMap, material: string, k: number, erase: boolean): void {
  const { mods } = open;
  const { useStore } = mods.store;
  const id = open.ids[0];
  const layer = dungeons(mods).find((l) => l.id === id)!;
  const settings = { ...useStore.getState().tools.settings.material, material, radius: DAB };
  const p = dabAt(k);
  const swept = mods.patch.strokeArea([p], DAB);
  if (erase) mods.erase.carveFloors(layer, id, swept, [], 'Erase', mods.tool.softErase([p], DAB, swept, settings));
  else mods.tool.paintCaveFloor(layer, id, swept, settings);
  redrawUnion(open);
}

/* ── Timing ──────────────────────────────────────────────────────────── */

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** One map's medians, ms. */
export interface SpeedRow {
  map: string;
  /** The map drawn with every piece laid afresh, the code warm. */
  cold: number;
  /** The first draw in a fresh page: the code cold too. */
  fresh: number;
  /** A real open: no art, then 15 batches landing; the whole of it, and its longest frame. */
  open: number;
  worst: number;
  warm: number;
  late: number;
  stroke: number;
  erase: number;
}

/** Times `map`: cold, warm, a late texture, a brush stroke step and an erase step, median of `runs` each. */
export async function timeMap(map: SpeedMap, runs = 20): Promise<SpeedRow> {
  // SPEED_COLS (cold,fresh,open,warm,late,stroke,erase) times only those.
  const want = (col: string): boolean => !process.env.SPEED_COLS || process.env.SPEED_COLS.split(',').includes(col);
  useFrames();
  const art = artState();
  const t = (): number => performance.now();
  art.withheld.clear();
  // Cold: the map opened again with its packs read afresh, so every ring, run, cliff, fit, rock line
  // and mesh is laid anew (each is kept per kit, and the kits are new); the code warmed by the runs
  // before. Fades worked out from the same outlines are kept, as they would be.
  const cold: number[] = [];
  {
    const mods = await freshMods();
    for (let i = 0; want('cold') && i < runs + 3; i++) {
      const open = openMap(mods, map);
      const t0 = t();
      open.drawAll();
      const dt = t() - t0;
      open.close();
      if (i >= 3) cold.push(dt);
    }
  }
  // Fresh: the first draw in a fresh page, the code itself cold too.
  const fresh: number[] = [];
  for (let i = 0; want('fresh') && i < Math.max(3, runs / 4) + 1; i++) {
    const mods = await freshMods();
    const open = openMap(mods, map);
    const t0 = t();
    open.drawAll();
    const dt = t() - t0;
    open.close();
    if (i >= 1) fresh.push(dt);
  }
  // A real open: fresh modules, no art at first, then the art landing in 15 batches, a frame each.
  const opens: number[] = [];
  const worsts: number[] = [];
  for (let i = 0; want('open') && i < Math.max(3, runs / 4) + 1; i++) {
    const mods = await freshMods();
    const open = openMap(mods, map);
    const r = await openWithLateArt(open, 15);
    open.close();
    art.withheld.clear();
    if (i >= 1) {
      opens.push(r.total);
      worsts.push(r.worst);
    }
  }
  const mods = await freshMods();
  art.withheld.clear();
  const open = openMap(mods, map);
  open.drawAll();
  // Warm: the same draw again.
  const warm: number[] = [];
  for (let i = 0; want('warm') && i < runs + 3; i++) {
    const t0 = t();
    open.drawAll();
    if (i >= 3) warm.push(t() - t0);
  }
  // A late texture: one piece's art withheld, the layer drawn without it, then it lands.
  const ids = rockArt(drawnArtIds(open));
  const late: number[] = [];
  for (let i = 0; want('late') && ids.length > 0 && i < runs + 3; i++) {
    const id = ids[i % ids.length];
    art.withheld.add(id);
    (mods.packs.getAssetPackManager() as unknown as { textureCache: Map<string, Texture> }).textureCache.delete(id);
    open.drawAll();
    frame();
    open.frame();
    const t0 = t();
    land(mods, [id]);
    for (let f = 0; f < 4; f++) {
      open.frame();
      for (let k = 0; k < 8; k++) await Promise.resolve();
    }
    if (i >= 3) late.push(t() - t0);
  }
  // Stroke steps on a brush cave, each dab somewhere new along its edge, from the cave as painted.
  paintBrushCave(open, map.material);
  const { useStore } = mods.store;
  const base = useStore.getState().layers;
  const steps = (erase: boolean): number[] => {
    const out: number[] = [];
    for (let i = 0; want(erase ? 'erase' : 'stroke') && i < runs + 3; i++) {
      useStore.setState({ layers: base });
      open.drawAll();
      const t0 = t();
      strokeStep(open, map.material, i + (erase ? 100 : 0), erase);
      if (i >= 3) out.push(t() - t0);
    }
    useStore.setState({ layers: base });
    open.drawAll();
    return out;
  };
  const stroke = steps(false);
  const erase = steps(true);
  open.close();
  return { map: map.name, cold: median(cold), fresh: median(fresh), open: median(opens), worst: median(worsts), warm: median(warm), late: median(late), stroke: median(stroke), erase: median(erase) };
}

/**
 * Opens `open`'s map with none of its pack art decoded, then lands what it asked for in
 * `batches` batches, one frame apiece: the first draw and every frame timed. `drawn` is told
 * when the first draw is done.
 */
export async function openWithLateArt(open: OpenMap, batches: number, drawn?: () => void): Promise<{ total: number; worst: number; frames: number }> {
  const art = artState();
  const manager = open.mods.packs.getAssetPackManager() as unknown as { manifestCache: Map<string, { entries: Record<string, unknown> }> };
  for (const [packId, manifest] of manager.manifestCache) for (const key of Object.keys(manifest.entries)) art.withheld.add(`${packId}:${key}`);
  art.asked.clear();
  let t0 = performance.now();
  open.drawAll();
  let worst = performance.now() - t0;
  drawn?.();
  let total = worst;
  const asked = [...art.asked].sort();
  let frames = 0;
  for (let b = 0; b < batches; b++) {
    const batch = asked.filter((_, i) => i % batches === b);
    if (batch.length === 0) continue;
    t0 = performance.now();
    land(open.mods, batch);
    open.frame();
    for (let k = 0; k < 8; k++) await Promise.resolve();
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt);
    total += dt;
    frames++;
  }
  // The frames after the last arrival.
  for (let f = 0; f < 4; f++) {
    t0 = performance.now();
    open.frame();
    for (let k = 0; k < 8; k++) await Promise.resolve();
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt);
    total += dt;
  }
  return { total, worst, frames };
}

/** The rows as a table. */
export function speedTable(title: string, rows: SpeedRow[]): string {
  const f = (v: number): string => v.toFixed(1).padStart(8);
  const cols = ['cold', 'fresh', 'open', 'worst', 'warm', 'late', 'stroke', 'erase'] as const;
  const head = `${'map'.padEnd(28)}${cols.map((c) => c.padStart(8)).join('')}`;
  return [title, head, ...rows.map((r) => `${r.map.padEnd(28)}${cols.map((c) => f(r[c])).join('')}`)].join('\n') + '\n';
}
