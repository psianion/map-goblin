import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TokenArtEditor } from './TokenArtEditor';
import { RING_COLOURS } from './artCrop';

vi.mock('./portrait', () => ({ usePortrait: () => null, uploadArt: vi.fn(async () => 'new-art') }));

afterEach(cleanup);

describe('Token art editor', () => {
  it('offers ten ring colours and no ring, starting on the seat colour', () => {
    render(<TokenArtEditor name="Bram" imageAssetId={null} defaultRing="#15803d" onSave={() => {}} />);
    for (const c of RING_COLOURS) expect(screen.getByTestId(`token-art-ring-${c.slice(1)}`)).toBeTruthy();
    expect(screen.getByTestId('token-art-ring-none')).toBeTruthy();
    expect(screen.getByTestId('token-art-ring-15803d').getAttribute('aria-pressed')).toBe('true');
  });

  it('starts on the ring the token already has', () => {
    render(<TokenArtEditor name="Bram" imageAssetId={null} ring="none" defaultRing="#15803d" onSave={() => {}} />);
    expect(screen.getByTestId('token-art-ring-none').getAttribute('aria-pressed')).toBe('true');
  });

  it('saves a ring change on the old picture without uploading a new one', async () => {
    const onSave = vi.fn();
    render(<TokenArtEditor name="Bram" imageAssetId="old-art" defaultRing="#15803d" onSave={onSave} />);
    fireEvent.click(screen.getByTestId('token-art-ring-none'));
    fireEvent.click(screen.getByTestId('token-art-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ imageAssetId: 'old-art', ring: 'none' }));
    const { uploadArt } = await import('./portrait');
    expect(uploadArt).not.toHaveBeenCalled();
  });

  it('shows the token at map size beside the editor', () => {
    render(<TokenArtEditor name="Bram Ash" imageAssetId={null} defaultRing="#15803d" onSave={() => {}} />);
    expect(screen.getByTestId('token-art-preview').textContent).toBe('BA');
  });
});
