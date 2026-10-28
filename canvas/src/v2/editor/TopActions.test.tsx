import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useStore } from '@/store/store';
import { getLitPreview, resetViewPrefsForTests } from '../viewPrefs';
import { TopActions } from './TopActions';

const actions = { openExport: vi.fn(), openPublish: vi.fn(), importImage: vi.fn() };

function openMenu() {
  fireEvent.click(screen.getByTestId('v2-more'));
}

describe('TopActions menu', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    resetViewPrefsForTests();
    useStore.getState().resetToDefault();
    useStore.setState({
      activeMapId: 'm1',
      mapIndex: [{ id: 'm1', name: 'Sunken Chapel', createdAt: 1, updatedAt: 1, gridSize: { width: 0, height: 0 }, layerCount: 2 }],
    });
  });

  afterEach(() => {
    resetViewPrefsForTests();
  });

  it('asks the shell for map settings', () => {
    const onOpenSettings = vi.fn();
    render(<TopActions actions={actions} onOpenSettings={onOpenSettings} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Map settings/ }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('turns the lit preview on and off', () => {
    render(<TopActions actions={actions} onOpenSettings={vi.fn()} />);
    openMenu();
    const row = screen.getByRole('menuitemcheckbox', { name: /Lit preview/ });
    expect(row.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(row);
    expect(getLitPreview()).toBe(true);

    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: /Lit preview/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Lit preview/ }));
    expect(getLitPreview()).toBe(false);
  });

  it('offers the three focus modes, the current one checked', () => {
    render(<TopActions actions={actions} onOpenSettings={vi.fn()} />);
    openMenu();
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((r) => r.textContent)).toEqual(['Auto', 'Manual', 'Fullscreen']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Manual' }));
    expect(useStore.getState().ui.focusMode).toBe('manual');

    openMenu();
    expect(screen.getByRole('menuitemradio', { name: 'Manual' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Fullscreen' }));
    expect(useStore.getState().ui.focusMode).toBe('fullscreen');
  });
});
