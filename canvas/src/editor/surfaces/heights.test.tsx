import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { setClipperModule } from '@/geometry/Clipper2Engine';
import { useStore } from '@/store/store';
import type { DungeonLayer, PlateauChild } from '@/store/types';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { levelDungeons } from '@/editor/models/roomModel';
import { heightLabel, heightThumbKey, levelHeights, nextHeightPin } from '@/editor/models/heightModel';
import { snapshotOf, thumbKeys } from '@/editor/models/layerThumbs';
import { HeightsColumn } from './HeightsColumn';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

beforeEach(() => {
  useStore.getState().resetToDefault();
  resetShell();
});

afterEach(cleanup);

function plat(id: string, x0: number, y0: number, x1: number, y1: number, height: number): PlateauChild {
  return {
    id,
    name: id,
    childType: 'plateau',
    visible: true,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    height,
    edge: 'cliff',
  };
}

const layerOf = (children: PlateauChild[]) => ({ type: 'dungeon', children }) as unknown as DungeonLayer;

/** Adds plateaus to the first layer of the level being edited. */
function raise(...children: PlateauChild[]) {
  const s = useStore.getState();
  const target = levelDungeons(s.layers, s.levels, s.ui.activeLevelId)[0];
  act(() => useStore.setState({ layers: s.layers.map((l) => (l === target ? { ...target, children: [...target.children, ...children] } : l)) }));
}

const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-testid="shell-height-card"]')];

describe('the heights of a level', () => {
  it('lists each height once, highest first, then 0 for the ground', () => {
    const a = layerOf([plat('a', 0, 0, 4, 4, 2), plat('b', 10, 10, 14, 14, -1)]);
    const b = layerOf([plat('c', 20, 20, 24, 24, 2), plat('d', 30, 30, 34, 34, 3)]);
    expect(levelHeights([a, b])).toEqual([3, 2, -1, 0]);
    expect(levelHeights([a, b]).map(heightLabel)).toEqual(['+3', '+2', '-1', '0']);
  });

  it('lists none on a flat level, plateaus with no height included', () => {
    expect(levelHeights([layerOf([plat('flat', 0, 0, 4, 4, 0)])])).toEqual([]);
    expect(levelHeights([])).toEqual([]);
  });

  it('gives each card of the level being edited a picture to paint', () => {
    raise(plat('top', 0, 0, 4, 4, 2));
    const s = useStore.getState();
    const keys = thumbKeys(snapshotOf(s));
    expect(keys).toContain(heightThumbKey(s.ui.activeLevelId, 2));
    expect(keys).toContain(heightThumbKey(s.ui.activeLevelId, 0));
  });
});

describe('the kept highlight', () => {
  it('a click keeps a height, a second click lets it go, another card takes over', () => {
    expect(nextHeightPin(null, 2)).toBe(2);
    expect(nextHeightPin(2, 2)).toBeNull();
    expect(nextHeightPin(2, -1)).toBe(-1);
  });
});

describe('HeightsColumn', () => {
  it('is absent on a flat level', () => {
    const { container } = render(<HeightsColumn />);
    expect(container.querySelector('[data-column="heights"]')).toBeNull();
  });

  it('shows one card per height and toggles the kept highlight, leaving the selection and tool alone', () => {
    raise(plat('top', 0, 0, 4, 4, 2), plat('pit', 10, 10, 14, 14, -2));
    const before = useStore.getState();
    const { container } = render(<HeightsColumn />);
    expect(cards(container).map((c) => c.textContent)).toEqual(['+2', '-2', '0']);

    const [top, pit] = cards(container);
    fireEvent.pointerEnter(top);
    expect(useShell.getState().heightHover).toBe(2);
    fireEvent.pointerLeave(top);
    expect(useShell.getState().heightHover).toBeNull();

    fireEvent.click(top);
    expect(useShell.getState().heightPin).toBe(2);
    expect(top.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pit);
    expect(useShell.getState().heightPin).toBe(-2);
    fireEvent.click(pit);
    expect(useShell.getState().heightPin).toBeNull();

    fireEvent.click(top);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().heightPin).toBeNull();

    const after = useStore.getState();
    expect(after.selection).toBe(before.selection);
    expect(after.tools).toBe(before.tools);
    expect(after.layers).toBe(before.layers);
  });
});
