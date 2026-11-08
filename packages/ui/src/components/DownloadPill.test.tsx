import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DownloadPill } from './DownloadPill';

const MB = 1024 * 1024;

describe('DownloadPill', () => {
  it('library: percent by bytes, per-pack lines and Pause in the popover, × hides', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onHide = vi.fn();
    render(
      <DownloadPill
        phase="library"
        progress={{ filesDone: 300, filesTotal: 900, bytesDone: 12.4 * MB, bytesTotal: 20 * MB }}
        packs={[
          { id: 'gg-forge', label: 'Forge', status: 'done' },
          { id: 'gg-demo', label: 'Demo', status: 'active', progress: { filesDone: 3, filesTotal: 12, bytesDone: MB, bytesTotal: 4 * MB } },
        ]}
        onPause={onPause}
        onResume={onResume}
        onHide={onHide}
      />,
    );
    expect(screen.getByText('Library · 62%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Library · 62%/ }));
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('3 of 12 files · 1.0 MB of 4.0 MB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Hide download progress' }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it('paused library offers Resume', () => {
    const onResume = vi.fn();
    render(
      <DownloadPill
        phase="library"
        paused
        progress={{ filesDone: 1, filesTotal: 9, bytesDone: MB, bytesTotal: 9 * MB }}
        onPause={() => {}}
        onResume={onResume}
        onHide={() => {}}
      />,
    );
    expect(screen.getByText('Library · paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('map: counts files, no Pause without the handlers', () => {
    render(<DownloadPill phase="map" progress={{ filesDone: 3, filesTotal: 12, bytesDone: 0, bytesTotal: 0 }} onHide={() => {}} />);
    expect(screen.getByTestId('download-pill').getAttribute('data-phase')).toBe('map');
    expect(screen.getByText('Map · 3 of 12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /details/ }));
    expect(screen.getByText('3 of 12 files')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});
