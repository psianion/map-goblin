import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { measureGridSize } from '@dnd/core/src/store/slices/maps';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import { MapSettingsModal } from './MapSettingsModal';

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/toast', () => ({ notify }));

/** Put a floor on the open map so `measureGridSize` has something to report. */
function drawSomething() {
  const dl = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  useStore.setState({
    layers: useStore
      .getState()
      .layers.map((l) =>
        l.id === dl.id ? { ...dl, mergedFloor: [[[2, 2], [12, 2], [12, 8], [2, 8]]] } : l,
      ) as DungeonLayer[],
  });
}

const save = () => screen.getByTestId('v2-map-settings-save');

describe('MapSettingsModal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.getState().resetToDefault();
    useStore.setState({
      activeMapId: 'm1',
      mapIndex: [{ id: 'm1', name: 'Sunken Chapel', createdAt: 1, updatedAt: 1, gridSize: { width: 0, height: 0 }, layerCount: 2 }],
      saveCurrentMap: vi.fn(async () => {}),
      renameMap: vi.fn(async () => {}),
    });
  });

  it('opens on the map as it is: its name, growing, 5 ft a square', () => {
    render(<MapSettingsModal open onOpenChange={() => {}} />);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Sunken Chapel');
    expect(screen.getByRole('radio', { name: 'Grows as you draw' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Distance per square') as HTMLInputElement).value).toBe('5');
    expect(screen.getByRole('radio', { name: 'ft' }).getAttribute('aria-checked')).toBe('true');
    expect(save().hasAttribute('disabled')).toBe(false);
  });

  it('starts Fixed at the size the map already measures', () => {
    drawSomething();
    const measured = measureGridSize(useStore.getState().layers);
    expect(measured.width).toBeGreaterThan(0);
    render(<MapSettingsModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }));

    expect((screen.getByLabelText('Width in squares') as HTMLInputElement).value).toBe(String(measured.width));
    expect((screen.getByLabelText('Height in squares') as HTMLInputElement).value).toBe(String(measured.height));
  });

  it.each([
    ['zero', '0'],
    ['a negative', '-5'],
    ['nothing', ''],
    ['not a number', 'five'],
  ])('refuses %s as a cell scale', (_label, text) => {
    render(<MapSettingsModal open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Distance per square'), { target: { value: text } });

    expect(screen.getByRole('alert').textContent).toContain('above zero');
    expect(save().hasAttribute('disabled')).toBe(true);
  });

  it('refuses a fixed size that is not whole squares', () => {
    render(<MapSettingsModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }));
    fireEvent.change(screen.getByLabelText('Width in squares'), { target: { value: '12.5' } });

    expect(screen.getByRole('alert').textContent).toContain('Whole numbers');
    expect(save().hasAttribute('disabled')).toBe(true);
  });

  it('saves name, size and scale onto the open map', async () => {
    const onOpenChange = vi.fn();
    render(<MapSettingsModal open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Guard Barracks  ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }));
    fireEvent.change(screen.getByLabelText('Width in squares'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Height in squares'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Distance per square'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('radio', { name: 'm' }));
    fireEvent.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const state = useStore.getState();
    expect(state.renameMap).toHaveBeenCalledWith('m1', 'Guard Barracks');
    expect(state.mapSettings.fixedSize).toEqual({ width: 40, height: 25 });
    expect(state.mapSettings.cellScale).toEqual({ value: 1.5, unit: 'm' });
    expect(state.saveCurrentMap).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('Settings saved');
  });

  it('leaves the name alone when it is emptied or unchanged', async () => {
    const onOpenChange = vi.fn();
    render(<MapSettingsModal open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(useStore.getState().renameMap).not.toHaveBeenCalled();
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
  });

  it('closes on Escape from a field or the dialog itself, and the canvas never hears it', () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    try {
      const onOpenChange = vi.fn();
      render(<MapSettingsModal open onOpenChange={onOpenChange} />);
      fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenLastCalledWith(false);

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledTimes(2);
      expect(heard).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', heard);
    }
  });
});
