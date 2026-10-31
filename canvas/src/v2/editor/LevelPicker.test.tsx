import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import { LevelPicker } from './LevelPicker';
import { TitleCard } from './TitleCard';
import { openLevelMenuRef, stepLevel } from './layerActions';

vi.mock('@/lib/toast', () => ({
  notify: { action: vi.fn(), subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

/** Ground (two layers) and Cellar (one layer); Ground on show. */
function seed() {
  const ground = useStore.getState().levels[0];
  useStore.getState().updateLevel(ground.id, { name: 'Ground floor' });
  useStore.getState().addLevel({ id: 'lv-cellar', name: 'Cellar' });
  const extra = createDungeonLayer('Props', ground.id);
  const cellar = createDungeonLayer('Cellar floor', 'lv-cellar');
  useStore.getState().addLayer(extra);
  useStore.getState().addLayer(cellar);
  useStore.getState().setActiveLevelId(ground.id);
  return { ground: ground.id, extra, cellar };
}

const openMenu = () => fireEvent.click(screen.getByTestId('v2-level-button'));
const item = (testId: string) => screen.getByTestId(testId) as HTMLButtonElement;
const levelIds = () => useStore.getState().levels.map((l) => l.id);

describe('LevelPicker', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('offers switch, new, rename, reorder, move, settings and delete', () => {
    seed();
    render(<LevelPicker />);
    openMenu();
    for (const id of ['v2-level-new', 'v2-level-rename', 'v2-level-up', 'v2-level-down', 'v2-level-move', 'v2-level-settings', 'v2-level-delete']) {
      expect(item(id)).toBeTruthy();
    }
  });

  it('moves the level on show down the order in one undo step', () => {
    const { ground } = seed();
    render(<LevelPicker />);
    openMenu();
    expect(item('v2-level-up').disabled).toBe(true);
    fireEvent.click(item('v2-level-down'));
    expect(levelIds()).toEqual(['lv-cellar', ground]);
    act(() => undoManager.undo());
    expect(levelIds()).toEqual([ground, 'lv-cellar']);
  });

  it('greys Delete level on a one-level map', () => {
    render(<LevelPicker />);
    openMenu();
    expect(item('v2-level-delete').disabled).toBe(true);
  });

  it('Delete level asks; "Move its layers" keeps the layers on the level picked', () => {
    const { ground, cellar } = seed();
    useStore.getState().setActiveLevelId('lv-cellar');
    render(<LevelPicker />);
    openMenu();
    fireEvent.click(item('v2-level-delete'));
    expect(screen.getByTestId('v2-level-delete-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('v2-level-delete-confirm'));
    expect(levelIds()).toEqual([ground]);
    expect(useStore.getState().layers.find((l) => l.id === cellar.id)!.levelId).toBe(ground);
  });

  it('"Delete the layers too" takes them out with the level, and undo brings both back on show', () => {
    const { cellar } = seed();
    useStore.getState().setActiveLevelId('lv-cellar');
    render(<LevelPicker />);
    openMenu();
    fireEvent.click(item('v2-level-delete'));
    fireEvent.click(screen.getByTestId('v2-level-delete-all'));
    fireEvent.click(screen.getByTestId('v2-level-delete-confirm'));
    expect(useStore.getState().layers.some((l) => l.id === cellar.id)).toBe(false);
    act(() => undoManager.undo());
    expect(useStore.getState().layers.some((l) => l.id === cellar.id)).toBe(true);
    expect(useStore.getState().ui.activeLevelId).toBe('lv-cellar');
  });

  it('Cancel leaves the level alone', () => {
    seed();
    render(<LevelPicker />);
    openMenu();
    fireEvent.click(item('v2-level-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('v2-level-delete-dialog')).toBeNull();
    expect(levelIds()).toHaveLength(2);
  });

  it('shows Page Up and Page Down on the neighbouring levels', () => {
    seed();
    render(<LevelPicker />);
    openMenu();
    expect(screen.getByTestId('v2-level-lv-cellar').textContent).toContain('PgDn');
  });

  it('Page Down and Page Up step through the levels, clamped at the ends', () => {
    const { ground } = seed();
    expect(stepLevel(1)).toBe(true);
    expect(useStore.getState().ui.activeLevelId).toBe('lv-cellar');
    expect(stepLevel(1)).toBe(false);
    expect(stepLevel(-1)).toBe(true);
    expect(useStore.getState().ui.activeLevelId).toBe(ground);
    expect(stepLevel(-1)).toBe(false);
  });

  it('refuses to move the last layer off a level', () => {
    seed();
    useStore.getState().setActiveLevelId('lv-cellar');
    render(<LevelPicker />);
    openMenu();
    fireEvent.click(item('v2-level-move'));
    fireEvent.click(screen.getByText('Ground floor'));
    expect(useStore.getState().levels).toHaveLength(2);
    expect(useStore.getState().layers.filter((l) => l.levelId === 'lv-cellar')).toHaveLength(1);
  });

  it('opens its menu when the title card asks', () => {
    seed();
    render(<LevelPicker />);
    act(() => openLevelMenuRef.current?.());
    expect(screen.getByRole('menu', { name: 'Levels' })).toBeTruthy();
  });
});

describe('TitleCard level', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
  });

  it('names no level on a one-level map', () => {
    render(<TitleCard onHome={() => {}} />);
    expect(screen.queryByTestId('v2-title-level')).toBeNull();
  });

  it('names the level on show when there are two or more', () => {
    seed();
    useStore.getState().setActiveLevelId('lv-cellar');
    render(<TitleCard onHome={() => {}} />);
    expect(screen.getByTestId('v2-title-level').textContent).toBe('· Cellar');
  });

  it('opens the level menu from the level name', () => {
    seed();
    const open = vi.fn();
    openLevelMenuRef.current = open;
    render(<TitleCard onHome={() => {}} />);
    fireEvent.click(screen.getByTestId('v2-title-level'));
    expect(open).toHaveBeenCalled();
    openLevelMenuRef.current = null;
  });
});
