import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useStore } from '@/store/store';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { marqueeTabKinds } from '@dnd/core/src/engine/marqueeFilter';
import { registry } from '@/editor/registry';
import { bindingOf } from '@/editor/registry/binding';
import { RegistryProvider } from '@/editor/shell/RegistryProvider';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { Slot } from '@/editor/surfaces/Slot';
import { pickOnly, selectTool } from './index';
import { pickOnlyKinds } from './pickOnly';
import { selectHint } from './hint';

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

function add(child: Partial<AnyChild> & { id: string; childType: AnyChild['childType'] }) {
  useStore.getState().addChild(layer().id, { name: child.id, visible: true, locked: false, opacity: 1, ...child } as AnyChild);
}

const prop = (id: string, locked = false) =>
  add({ id, childType: 'asset', locked, position: { x: 1, y: 1 }, assetId: 'x', width: 1, height: 1, rotation: 0, scale: 1 } as never);
const light = (id: string) => add({ id, childType: 'light', position: { x: 3, y: 3 }, radius: 4 } as never);

function slot() {
  return render(
    <RegistryProvider registry={registry}>
      <Slot />
    </RegistryProvider>,
  );
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  resetShell();
  act(() => bindingOf(pickOnly).write(useStore, []));
});

afterEach(cleanup);

describe('Pick only', () => {
  it('turns the marquee filter on with the chips and off with All', () => {
    act(() => bindingOf(pickOnly).write(useStore, ['props', 'lights']));
    expect(useStore.getState().ui.marqueeFilter).toBe('tab');
    expect(marqueeTabKinds()).toEqual(['asset', 'light']);
    expect(bindingOf(pickOnly).read(useStore.getState())).toEqual(['props', 'lights']);
    act(() => bindingOf(pickOnly).write(useStore, []));
    expect(useStore.getState().ui.marqueeFilter).toBe('all');
    expect(bindingOf(pickOnly).read(useStore.getState())).toEqual([]);
  });

  it('lets Floors grab plateaus with the floors', () => {
    expect(pickOnlyKinds(['floors'])).toEqual(['shape', 'plateau']);
    expect(pickOnlyKinds([])).toBeNull();
  });

  it('rejects a chip that does not exist', () => {
    expect(pickOnly.schema.safeParse(['rooms']).success).toBe(false);
  });

  it('says in the hint what a box will pick', () => {
    act(() => bindingOf(pickOnly).write(useStore, ['props']));
    expect(selectHint(useStore.getState()).segments.map((s) => s.text).join(' ')).toContain('a box picks props');
  });
});

describe('Select panel', () => {
  it('shows the chips, the how-to and the way back to the last tool', () => {
    act(() => {
      useStore.getState().setActiveTool('select');
      useShell.getState().setLastTool('floor');
    });
    const { getByTestId, getByRole } = slot();
    expect(getByTestId('shell-tool-panel').dataset.tool).toBe('select');
    expect(getByRole('group', { name: 'Pick only' }).querySelectorAll('button')).toHaveLength(8);
    expect(getByTestId('select-howto').textContent).toContain('drag a box');
    fireEvent.click(getByTestId('select-previous'));
    expect(useStore.getState().tools.activeTool).toBe(registry.toolById('floor')!.engine[0]);
  });
});

describe('card host', () => {
  it('shows the Mixed card for several kinds, with Select only per kind', () => {
    act(() => {
      prop('p1');
      prop('p2');
      light('l1');
      useStore.getState().setActiveTool('select');
      useStore.getState().setSelectedIds(['p1', 'p2', 'l1']);
    });
    const { getByTestId } = slot();
    expect(getByTestId('shell-card').dataset.kind).toBe('mixed');
    const kinds = getByTestId('mixed-kinds');
    expect(kinds.textContent).toContain('Props · 2');
    expect(kinds.textContent).toContain('Lights · 1');
    fireEvent.click(kinds.querySelector('button')!);
    expect(useStore.getState().selection.selectedIds).toEqual(['p1', 'p2']);
  });

  it('holds the writes back while a member is locked, and says how many', () => {
    act(() => {
      prop('p1', true);
      prop('p2');
      useStore.getState().setActiveTool('select');
      useStore.getState().setSelectedIds(['p1', 'p2']);
    });
    const { getByTestId } = slot();
    expect(getByTestId('mixed-locked').textContent).toBe('1 locked');
    const card = getByTestId('shell-card');
    for (const fs of card.querySelectorAll('fieldset')) expect(fs.disabled).toBe(true);
  });

  it('shows the kind\'s own card for one thing that has one', () => {
    act(() => {
      useStore.getState().addChild(layer().id, {
        id: 'f1', name: 'Floor', childType: 'shape', visible: true, locked: false, opacity: 1, shapeType: 'rectangle',
        contours: [[[0, 0], [2, 0], [2, 2], [0, 2]]], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0,
        textureFillRotation: 0, textureTint: '#ffffff',
      } as unknown as AnyChild);
      useStore.getState().setActiveTool('select');
      useStore.getState().setSelectedIds(['f1']);
    });
    const { getByTestId } = slot();
    expect(getByTestId('shell-card').dataset.kind).toBe('shape');
  });

  it('belongs to Select: Pan keeps no card', () => {
    act(() => {
      prop('p1');
      useStore.getState().setActiveTool('pan');
      useStore.getState().setSelectedIds(['p1']);
    });
    const { queryByTestId } = slot();
    expect(queryByTestId('shell-card')).toBeNull();
    expect(selectTool.selectionPanel).toBeDefined();
  });
});
