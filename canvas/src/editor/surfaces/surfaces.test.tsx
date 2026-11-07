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
    // The phase-two settings (Draw or carve, the default opacity) are not registered yet.
    expect(captions).toEqual(['Placement', 'Edge']);
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
    expect(columns(dock)).toEqual(['level', 'layers', 'Shape', 'Edit', 'look']);
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
    expect(columns(getByTestId('shell-dock'))).toEqual(['level', 'layers', 'look']);
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
