import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortraitUrl } from './portrait';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
});
afterEach(() => vi.unstubAllGlobals());

describe('usePortraitUrl', () => {
  it('resolves to an object URL and fetches an asset only once', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob() }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePortraitUrl('asset-1'));
    expect(result.current).toBeNull(); // loading

    await waitFor(() => expect(result.current).toBe('blob:mock-url'));

    // A second hook asking for the same asset reuses the cached fetch.
    renderHook(() => usePortraitUrl('asset-1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays null for a missing asset id', () => {
    const { result } = renderHook(() => usePortraitUrl(null));
    expect(result.current).toBeNull();
  });

  it('resolves to null when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, blob: async () => new Blob() })),
    );
    const { result } = renderHook(() => usePortraitUrl('asset-missing'));
    await waitFor(() => expect(result.current).toBeNull());
  });
});
