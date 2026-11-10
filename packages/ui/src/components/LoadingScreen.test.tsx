import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingScreen } from './LoadingScreen';

const STEPS = ['Engine', 'Library index', 'Map textures'];

describe('LoadingScreen', () => {
  it('marks the steps before the live one done, and the bar and counts follow the bytes', () => {
    render(
      <LoadingScreen
        title="Opening the map"
        steps={STEPS}
        current={2}
        progress={{ filesDone: 12, filesTotal: 40, bytesDone: 3.1 * 1024 * 1024, bytesTotal: 7.8 * 1024 * 1024 }}
      />,
    );
    const states = screen.getAllByRole('listitem').map((li) => li.getAttribute('data-step-state'));
    expect(states).toEqual(['done', 'done', 'live']);
    expect(screen.getByText('Map textures').getAttribute('aria-current')).toBe('step');
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.hasAttribute('data-indeterminate')).toBe(false);
    expect(screen.getByText('12 of 40 files · 3.1 MB of 7.8 MB')).toBeTruthy();
    expect(screen.getByTestId('loading-screen').className).toContain('bg-bg');
  });

  it('is indeterminate with no counts while filesTotal is 0', () => {
    render(
      <LoadingScreen
        title="Starting"
        steps={STEPS}
        current={0}
        progress={{ filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.hasAttribute('data-indeterminate')).toBe(true);
    expect(screen.queryByText(/files/)).toBeNull();
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('data-step-state'))).toEqual(['live', 'waiting', 'waiting']);
  });
});
