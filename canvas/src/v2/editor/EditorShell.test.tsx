import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { EditorShell } from './EditorShell';
import { PANEL_FADE_DELAY_MS } from './usePanelFade';
import { togglePopoverRef } from '@/components/toolbar/toolConstants';
import { openPropBrowserRef } from '@/canvas/menuRegistry';

const actions = { openExport: vi.fn(), openPublish: vi.fn(), importImage: vi.fn() };

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('EditorShell', () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    // jsdom lays nothing out; the filmstrip scrolls its active layer into view on mount.
    Element.prototype.scrollIntoView ??= () => {};
    useStore.getState().resetToDefault();
    useStore.setState({
      activeMapId: 'm1',
      mapIndex: [{ id: 'm1', name: 'Sunken Chapel', createdAt: 1, updatedAt: 1, gridSize: { width: 0, height: 0 }, layerCount: 2 }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('map settings', () => {
    it('comes up with the dialog open when the home page asked for it', () => {
      render(<EditorShell actions={actions} onHome={vi.fn()} openSettings />);
      expect(screen.getByTestId('v2-map-settings-modal')).toBeTruthy();
    });

    it('comes up closed otherwise', () => {
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      expect(screen.queryByTestId('v2-map-settings-modal')).toBeNull();
    });

    it('opens even in fullscreen focus, where the top bar is gone', () => {
      useStore.getState().setFocusMode('fullscreen');
      render(<EditorShell actions={actions} onHome={vi.fn()} openSettings />);
      expect(screen.queryByTestId('v2-more')).toBeNull();
      expect(screen.getByTestId('v2-map-settings-modal')).toBeTruthy();
    });

    it('opens from the menu', () => {
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      fireEvent.click(screen.getByTestId('v2-more'));
      fireEvent.click(screen.getByRole('menuitem', { name: /Map settings/ }));
      expect(screen.getByTestId('v2-map-settings-modal')).toBeTruthy();
    });
  });

  describe('auto focus fade', () => {
    it('fades the chrome after a while and brings it back over the chrome', () => {
      vi.useFakeTimers();
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      const shell = screen.getByTestId('v2-editor');
      expect(shell.hasAttribute('data-faded')).toBe(false);

      act(() => vi.advanceTimersByTime(PANEL_FADE_DELAY_MS));
      expect(shell.hasAttribute('data-faded')).toBe(true);

      act(() => {
        fireEvent.pointerMove(screen.getByTestId('v2-rail'));
      });
      expect(shell.hasAttribute('data-faded')).toBe(false);
    });

    it('never fades while something is selected, so its card stays readable', () => {
      vi.useFakeTimers();
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      const shell = screen.getByTestId('v2-editor');
      act(() => useStore.getState().setSelectedIds(['crate']));
      act(() => vi.advanceTimersByTime(PANEL_FADE_DELAY_MS * 2));
      expect(shell.hasAttribute('data-faded')).toBe(false);
      // Nothing selected again: the fade it was holding back applies.
      act(() => useStore.getState().setSelectedIds([]));
      expect(shell.hasAttribute('data-faded')).toBe(true);
    });

    it('marks every floating region as chrome', () => {
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      for (const id of ['v2-rail', 'v2-title-card', 'v2-dock']) {
        expect(screen.getByTestId(id).closest('[data-chrome]')).not.toBeNull();
      }
      expect(screen.getByTestId('v2-more').closest('[data-chrome]')).not.toBeNull();
      expect(screen.getByTestId('v2-status').closest('[data-chrome]')).not.toBeNull();
    });

    it('never fades in manual', () => {
      vi.useFakeTimers();
      useStore.getState().setFocusMode('manual');
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      act(() => vi.advanceTimersByTime(PANEL_FADE_DELAY_MS * 2));
      expect(screen.getByTestId('v2-editor').hasAttribute('data-faded')).toBe(false);
    });
  });

  describe('sheets', () => {
    const layerSheet = () => screen.queryByTestId('v2-layer-sheet');
    const layersSheet = () => screen.queryByTestId('v2-layers-sheet');
    const openCount = () =>
      ['v2-layer-sheet', 'v2-layers-sheet', 'v2-assets-sheet', 'v2-prep-sheet'].filter((id) => screen.queryByTestId(id))
        .length;

    beforeEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* no storage: the dock starts open anyway */
      }
    });

    it('opens a layer sheet from the filmstrip and closes it on Escape', () => {
      const layer = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
      useStore.getState().setActiveLayerId(layer.id);
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Layer settings' }));
      expect(layerSheet()).not.toBeNull();
      expect(layerSheet()!.closest('[data-testid="v2-dock"]')).toBeNull();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(layerSheet()).toBeNull();
    });

    it('keeps one sheet open at a time: the layer list replaces a layer sheet and back', () => {
      const layer = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
      useStore.getState().setActiveLayerId(layer.id);
      render(<EditorShell actions={actions} onHome={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Layer settings' }));
      expect(openCount()).toBe(1);
      fireEvent.click(screen.getByTestId('v2-open-layers'));
      expect(layersSheet()).not.toBeNull();
      expect(layerSheet()).toBeNull();
      expect(openCount()).toBe(1);

      fireEvent.doubleClick(screen.getByRole('button', { name: 'Draw on Terrain' }));
      expect(layersSheet()).toBeNull();
      expect(screen.getByRole('heading', { name: 'Terrain' })).toBeTruthy();
      expect(openCount()).toBe(1);
    });

    it('opens the asset browser on floors from the selection card', () => {
      const layer = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
      useStore.getState().addChild(layer.id, {
        id: 's1',
        name: 'Hall',
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
        roughnessEnabled: false,
        textureScale: 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: '#ffffff',
      });
      useStore.getState().setSelectedIds(['s1']);
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      const card = screen.getByTestId('v2-selection-card');
      fireEvent.click(within(card).getByRole('button', { name: 'Change' }));
      expect(screen.getByTestId('v2-assets-sheet')).toBeTruthy();
      expect(openCount()).toBe(1);
    });
  });

  describe('Tab', () => {
    const pressTab = () => fireEvent.keyDown(document.body, { key: 'Tab' });
    const toggle = () => screen.getByTestId('v2-dock-toggle');

    beforeEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* no storage: the dock starts open anyway */
      }
    });

    it('folds the dock outside an edit session', () => {
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      pressTab();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('is left to a wall edit, even with no stone picked', () => {
      useStore.getState().setNodeEditWall('wall-1');
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      pressTab();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });

    it('is left to an outline edit', () => {
      useStore.getState().setShapeNodeEdit('shape-1');
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      pressTab();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('the tool key pressed again', () => {
    beforeEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* no storage: the dock starts open anyway */
      }
    });

    it('never folds the dock: B again opens a folded dock on the Props tab and leaves an open one open', () => {
      useStore.getState().setActiveTool('scatterBrush');
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      const toggle = () => screen.getByTestId('v2-dock-toggle');
      const propsTab = () => screen.getByTestId('v2-dock-tab-props');

      act(() => togglePopoverRef.current?.());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(propsTab().getAttribute('aria-selected')).toBe('true');
      act(() => togglePopoverRef.current?.());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');

      // Folded and on another tab: the press opens the dock on the tool's own tab.
      fireEvent.click(screen.getByTestId('v2-dock-tab-floors'));
      fireEvent.keyDown(document.body, { key: 'Tab' });
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      act(() => togglePopoverRef.current?.());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(propsTab().getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('props browser', () => {
    const propsSheet = () => screen.queryByTestId('v2-props-sheet');

    beforeEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* no storage */
      }
    });

    it('opens from the Assets tab and from the Props strip, never on the old asset browser', () => {
      useStore.getState().setActiveTool('scatterBrush');
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      fireEvent.click(screen.getByTestId('v2-dock-tab-assets'));
      expect(propsSheet()).not.toBeNull();
      expect(screen.queryByTestId('v2-assets-sheet')).toBeNull();
      expect(within(propsSheet()!).getByRole('heading', { name: /^Props/ })).toBeTruthy();

      fireEvent.click(screen.getByTestId('v2-dock-tab-floors'));
      expect(propsSheet()).toBeNull();
      fireEvent.click(screen.getByTestId('v2-dock-tab-props'));
      fireEvent.click(screen.getByTestId('v2-props-library'));
      expect(propsSheet()).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Close Props' }));
      expect(propsSheet()).toBeNull();
    });

    it('opens in replace mode from the menu (Replace from library), and closing it ends the replace', () => {
      render(<EditorShell actions={actions} onHome={vi.fn()} />);
      act(() => openPropBrowserRef.current?.(['p1']));
      expect(propsSheet()).not.toBeNull();
      expect(screen.getByTestId('v2-props-replace')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close Props' }));
      expect(useStore.getState().ui.propReplaceIds).toBeNull();
    });
  });
});
