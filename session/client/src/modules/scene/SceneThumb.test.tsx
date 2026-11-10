import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SceneThumb } from './SceneThumb';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SceneThumb', () => {
  it('falls back to the first letter and fetches nothing when the scene has no picture', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<SceneThumb scene={{ name: 'crypt', mapId: 'm1' }} className="h-9" />);
    expect(screen.getByTestId('scene-thumb').textContent).toBe('C');
    expect(screen.getByTestId('scene-thumb').getAttribute('data-image')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the picture of a scene that has one, asked for with the given token', async () => {
    // A plain stand-in: a jsdom Blob inside a Node Response does not read back on every Node.
    const fetchSpy = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchSpy);
    URL.createObjectURL = vi.fn(() => 'blob:thumb');
    render(<SceneThumb scene={{ name: 'Crypt', mapId: 'm2', thumbnail: true }} token="dm-token" className="h-9" />);
    await waitFor(() => expect(screen.getByTestId('scene-thumb').getAttribute('data-image')).toBe('true'));
    expect(screen.getByTestId('scene-thumb').querySelector('img')?.getAttribute('src')).toBe('blob:thumb');
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/maps/m2/thumbnail'), { headers: { Authorization: 'Bearer dm-token' } });
  });

  it('keeps the letter when the picture cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    render(<SceneThumb scene={{ name: 'Barrow', mapId: 'm3', thumbnail: true }} className="h-9" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('scene-thumb').textContent).toBe('B');
  });
});
