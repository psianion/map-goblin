import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useStore } from '@/store/store';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { StatusBar } from './StatusBar';
import { selectHintFor } from './selectHint';

const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

beforeEach(() => {
  useStore.getState().resetToDefault();
  useStore.getState().setActiveTool('select');
});
afterEach(cleanup);

describe('status bar: the marquee chip', () => {
  it('reads “Select: Everything” by default', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('v2-marquee-chip').textContent).toContain('Select: Everything');
  });

  it('switches the marquee to the tab’s kind and says so', () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByTestId('v2-marquee-chip'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /This tab’s kind/ }));
    expect(useStore.getState().ui.marqueeFilter).toBe('tab');
    expect(screen.getByTestId('v2-marquee-chip').textContent).toContain('This tab’s kind');
  });

  it('follows the store when the filter is set elsewhere', () => {
    render(<StatusBar />);
    act(() => useStore.getState().setMarqueeFilter('tab'));
    expect(screen.getByTestId('v2-marquee-chip').textContent).toContain('This tab’s kind');
  });

  it('names the Select tool’s gestures with nothing selected, the verbs with something selected', () => {
    expect(selectHintFor(useStore.getState())?.segments.map((s) => s.text).join(' ')).toContain('Drag marquee');
    const p = { id: 'p', name: 'p', childType: 'asset', visible: true, position: { x: 0, y: 0 }, rotation: 0, scale: 1, width: 1, height: 1 } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, p);
    useStore.getState().setSelectedIds(['p']);
    const hint = selectHintFor(useStore.getState())!;
    expect(hint.label).toBe('1 prop');
    expect(hint.segments.map((s) => s.text).join(' ')).toContain('Arrows nudge');
    useStore.getState().updateChild(layer().id, 'p', { locked: true } as Partial<AnyChild>);
    expect(selectHintFor(useStore.getState())!.segments[0].text).toContain('Unlock in the card');
  });

  it('a locked light’s line is the locked one, ahead of the light’s own keys', () => {
    const l = { id: 'l', name: 'Torch', childType: 'light', visible: true, locked: true, color: '#ffffff', radius: 4, featherRadius: 2, intensity: 1, falloff: 'linear', position: { x: 0, y: 0 } } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, l);
    useStore.getState().setSelectedIds(['l']);
    render(<StatusBar />);
    const hint = screen.getByTestId('v2-status-hint').textContent ?? '';
    expect(hint).toContain('Unlock in the card');
    expect(hint).not.toContain('Del');
  });
});
