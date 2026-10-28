import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useStore } from '@/store/store';
import { AssetBrowserPanel } from './AssetBrowserPanel';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: () => <i />,
}));

beforeEach(() => {
  useStore.getState().resetToDefault();
  useStore.getState().setActiveTool('select');
  useStore.setState((s) => {
    s.assets.manifest = {
      categories: [
        {
          id: 'p:floor',
          label: 'Floor',
          assets: [{ id: 'p:stone', name: 'stone', url: '', thumbnailUrl: '', cellWidth: 1, cellHeight: 1 }],
        },
      ],
    } as never;
  });
});

afterEach(cleanup);

describe('AssetBrowserPanel hint', () => {
  it('says a click stamps by default', () => {
    render(<AssetBrowserPanel />);
    expect(screen.getByTestId('asset-browser-hint').textContent).toBe('Click an asset to stamp it');
  });

  it('never says stamp on the Floor tab, even with the scatter brush in hand', () => {
    useStore.getState().setActiveTool('scatterBrush');
    render(<AssetBrowserPanel initialType="floor" hint="Click an asset to stamp it" floorHint="Click a texture to apply it to every floor on this layer" />);
    expect(screen.getByTestId('asset-browser-hint').textContent).toBe('Click a texture to apply it to every floor on this layer');
  });

  it('shows the hint the host passes', () => {
    render(<AssetBrowserPanel hint="Click a texture to assign it to slot 1" />);
    expect(screen.getByTestId('asset-browser-hint').textContent).toBe('Click a texture to assign it to slot 1');
  });
});

describe('AssetBrowserPanel type tabs', () => {
  it('opens on Object with the props brush in hand, its props listed, and has no Scatter tab', () => {
    useStore.setState((s) => {
      s.assets.manifest = {
        categories: [
          {
            id: 'p:object',
            label: 'Barrels',
            assets: [{ id: 'p:barrel', name: 'barrel', url: '', thumbnailUrl: '', cellWidth: 1, cellHeight: 1 }],
          },
        ],
      } as never;
    });
    useStore.getState().setActiveTool('scatterBrush');
    render(<AssetBrowserPanel />);
    expect(screen.queryByRole('button', { name: 'Scatter' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Barrels' }));
    expect(screen.getByTitle('barrel')).toBeTruthy();
  });
});
