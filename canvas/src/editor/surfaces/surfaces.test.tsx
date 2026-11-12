import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDefaultState } from '@/store/factories';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { validateRegistry } from '@/editor/registry/validate';
import { RegistryProvider } from '@/editor/shell/RegistryProvider';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { registry, type ObjectOf } from '@/editor/registry';
import { Dock } from './Dock';
import { Slot } from './Slot';
import { ToolPanel } from './ToolPanel';

const floor = registry.toolById('floor')!;
const ids = (home: 'panel' | 'dock') => registry.settingsByHome('floor', home).map((s) => s.id);
const shown = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-setting]')].map((el) => el.dataset.setting);
const columns = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-composite="dock-column"]')].map((el) => el.dataset.column);

function withRegistry(node: React.ReactNode) {
  return render(<RegistryProvider registry={registry}>{node}</RegistryProvider>);
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  resetShell();
});

afterEach(cleanup);

describe('the registry', () => {
  it('keeps every registry rule', () => {
    expect(validateRegistry(registry, createDefaultState())).toEqual([]);
  });
});

describe('ToolPanel', () => {
  it('renders the panel settings under their captions in registry order', () => {
    const { getByTestId } = withRegistry(<ToolPanel tool={floor} />);
    const panel = getByTestId('shell-tool-panel');
    const captions = [...panel.querySelectorAll<HTMLElement>('[data-section]')].map((el) => el.dataset.section);
    expect(captions).toEqual(['Mode', 'Placement', 'Edge', 'Defaults for new floors']);
    expect(shown(panel)).toEqual(ids('panel'));
  });

  it('renders none of the dock settings', () => {
    const { getByTestId } = withRegistry(<ToolPanel tool={floor} />);
    const panel = getByTestId('shell-tool-panel');
    for (const id of ids('dock')) expect(panel.querySelector(`[data-setting="${id}"]`)).toBeNull();
  });
});

describe('Dock', () => {
  it('renders the dock settings and none of the panel settings', () => {
    act(() => useStore.getState().setActiveTool('regularPolygon'));
    const { getByTestId } = withRegistry(<Dock />);
    const dock = getByTestId('shell-dock');
    expect(shown(dock)).toEqual(ids('dock'));
    for (const id of ids('panel')) expect(dock.querySelector(`[data-setting="${id}"]`)).toBeNull();
    expect(columns(dock)).toEqual(['level', 'layers', 'family', 'setup', 'Shape', 'Edit', 'Height', 'look']);
  });

  it('shows the family of the tool in hand, else of the open flyout, and picks from it', () => {
    act(() => useStore.getState().setActiveTool('wall'));
    const { getByTestId } = withRegistry(<Dock />);
    const family = () => getByTestId('shell-dock').querySelector<HTMLElement>('[data-column="family"]')!;
    const names = () => [...family().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names()).toEqual(registry.familyOfTool('wall')!.tools.map((t) => t.label));
    expect(family().querySelector('[aria-label="Wall"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => useShell.getState().setFlyout('text'));
    expect(names()).toEqual(registry.families.find((f) => f.id === 'text')!.tools.map((t) => t.label));
    act(() => family().querySelector<HTMLElement>('[aria-label="Zone"]')!.click());
    expect(useStore.getState().tools.activeTool).toBe('zone');
    expect(useShell.getState().flyout).toBeNull();
  });

  it('sets up the walls from the Rooms tool’s Set up tab, Rooms staying in hand, and goes back on a tool change', () => {
    act(() => useStore.getState().setActiveTool('roomRect'));
    const { getByTestId } = withRegistry(<Dock />);
    const dock = () => getByTestId('shell-dock');
    expect(columns(dock())).toEqual(['level', 'layers', 'family', 'setup', 'Draw', 'look']);
    const setup = () => dock().querySelector<HTMLElement>('[data-column="setup"]')!;
    expect([...setup().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Rooms', 'Walls', 'Doors']);
    act(() => [...setup().querySelectorAll('button')].find((b) => b.textContent === 'Walls')!.click());
    expect(useShell.getState().dockTab).toBe('walls');
    expect(useStore.getState().tools.activeTool).toBe('roomRect');
    expect(columns(dock())).toContain('look');
    expect(shown(dock())).toEqual(expect.arrayContaining(['wall.cornerStyle']));
    expect(shown(dock())).not.toContain('rooms.mode');
    expect(dock().querySelector('[data-column="look"]')?.getAttribute('data-testid')).toBe('design-wall-look');
    act(() => useStore.getState().setActiveTool('wall'));
    expect(useShell.getState().dockTab).toBeNull();
    expect([...setup().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Wall', 'Floor', 'Doors']);
  });

  it('hides Sides unless Regular is picked', () => {
    act(() => useStore.getState().setActiveTool('polygon'));
    const { getByTestId } = withRegistry(<Dock />);
    expect(getByTestId('shell-dock').querySelector('[data-setting="floor.sides"]')).toBeNull();
  });

  it('keeps one height whatever the tool, and only the last tool\'s own columns under Select', () => {
    const { getByTestId } = withRegistry(<Dock />);
    const heights: string[] = [];
    const height = () => {
      const dock = getByTestId('shell-dock');
      // Every column is the dock's own height too, so none can push it.
      for (const col of dock.querySelectorAll('[data-composite="dock-column"]')) expect(col.className).toContain('h-[112px]');
      heights.push(dock.className.match(/\bh-\[\d+px\]/)?.[0] ?? '');
    };
    for (const tool of ['rectangle', 'regularPolygon', 'wall', 'terrain', 'select'] as const) {
      act(() => useStore.getState().setActiveTool(tool));
      height();
    }
    expect(new Set(heights)).toEqual(new Set(['h-[112px]']));
    expect(columns(getByTestId('shell-dock'))).toEqual(['level', 'layers']);
    act(() => useShell.getState().setLastTool('floor'));
    expect(columns(getByTestId('shell-dock'))).toEqual(['level', 'layers', 'family', 'look']);
  });
});

describe('the Zone tool', () => {
  it('shows a picked zone’s card with More and Prep overview, and Prep overview with nothing picked', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    const zone = { id: 'z1', name: 'Pit', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 3, y: 3 }, radius: 1 } } as unknown as AnyChild;
    act(() => {
      state.addChild(layer.id, zone);
      useStore.getState().setActiveTool('zone');
    });
    const { getByTestId, queryByTestId } = withRegistry(<Slot />);
    const panel = getByTestId('shell-tool-panel');
    expect(panel.dataset.tool).toBe('zone');
    const prep = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Prep overview')!;
    act(() => prep.click());
    expect(useShell.getState().sheet).toBe('prep');
    act(() => useStore.getState().setSelectedIds(['z1']));
    expect(queryByTestId('shell-tool-panel')).toBeNull();
    const card = getByTestId('shell-card');
    expect(card.dataset.kind).toBe('zone');
    const names = [...card.querySelectorAll('button')].map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(['More…', 'Prep overview']));
  });
});

describe('Card', () => {
  it('renders the picked kind\'s fields and verbs, delete last', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    const shape = {
      id: 'floor-1', name: 'Floor', childType: 'shape', visible: true, locked: false, opacity: 1,
      shapeType: 'rectangle', contours: [[[0, 0], [6, 0], [6, 4], [0, 4]]],
      textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    } as unknown as AnyChild;
    act(() => {
      state.addChild(layer.id, shape);
      useStore.getState().setActiveTool('select');
      useStore.getState().setSelectedIds(['floor-1']);
    });
    const { getByTestId } = withRegistry(<Slot />);
    const card = getByTestId('shell-card');
    expect(card.dataset.kind).toBe('shape');
    // A field that only means something with a texture (Tint, the Fill fold) stays out for a plain floor.
    const live = useStore.getState().layers.flatMap((l) => ('children' in l ? l.children : [])).find((c) => c.id === 'floor-1') as ObjectOf<'shape'>;
    const fields = registry.cardForKind('shape')!.fields;
    expect(shown(card)).toEqual(fields.filter((f) => !f.visibleWhen || f.visibleWhen(live)).map((f) => f.id));
    expect(card.querySelector('[data-setting="card.floor.size"]')?.textContent).toContain('6 × 4 sq');
    const verbs = [...card.querySelectorAll('[data-composite="action-row"] button')];
    expect(verbs).toHaveLength(8);
    expect(verbs.at(-1)?.getAttribute('aria-label')).toBe('Delete');
  });
});
