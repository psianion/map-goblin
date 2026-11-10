import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('./assetBoot', () => ({
  getAssetPackManager: () => ({}),
  bootAssets: async () => {},
  ensureMapAssets: async () => {},
  installLibrary: async () => {},
  collectMapTextureIds: () => [],
}));

const { AssetDownloadPill } = await import('./AssetDownloadPill');
const { useAssetLoading, resetAssetLoading } = await import('./assetLoading');

const P = { filesDone: 3, filesTotal: 12, bytesDone: 300, bytesTotal: 1200 };

beforeEach(() => resetAssetLoading());

describe('AssetDownloadPill', () => {
  it('is absent with nothing downloading', () => {
    render(<AssetDownloadPill />);
    expect(screen.queryByTestId('download-pill')).toBeNull();
  });

  it('shows a later map in phase map, ahead of the library', () => {
    useAssetLoading.setState({ map: { mode: 'pill', progress: P }, library: { status: 'running', progress: P } });
    render(<AssetDownloadPill />);
    expect(screen.getByTestId('download-pill').getAttribute('data-phase')).toBe('map');
    expect(screen.getByText('Map · 3 of 12')).toBeTruthy();
  });

  it('the first map is behind the screen, not in the pill', () => {
    useAssetLoading.setState({ map: { mode: 'screen', progress: P } });
    render(<AssetDownloadPill />);
    expect(screen.queryByTestId('download-pill')).toBeNull();
  });

  it('shows the library while it runs and is gone for the session after ×', () => {
    useAssetLoading.setState({ library: { status: 'running', progress: P, packId: 'gg-forge' } });
    render(<AssetDownloadPill />);
    expect(screen.getByTestId('download-pill').getAttribute('data-phase')).toBe('library');
    expect(screen.getByText('Library · 25%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide download progress' }));
    expect(screen.queryByTestId('download-pill')).toBeNull();
    expect(useAssetLoading.getState().pillHidden).toBe(true);
  });

  it('is gone once the library is done', () => {
    useAssetLoading.setState({ library: { status: 'done', progress: P } });
    render(<AssetDownloadPill />);
    expect(screen.queryByTestId('download-pill')).toBeNull();
  });
});
