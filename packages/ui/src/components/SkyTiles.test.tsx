import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaceTiles, TimeTiles } from './SkyTiles';

const names = (group: HTMLElement) =>
  Array.from(group.querySelectorAll('[data-slot="tile-name"]')).map((n) => n.textContent);

describe('TimeTiles', () => {
  it('lists dawn, day, dusk and night, marks the chosen one and reports a pick', () => {
    const onPick = vi.fn();
    render(<TimeTiles value="dusk" onPick={onPick} />);
    expect(names(screen.getByRole('group', { name: 'Time of day' }))).toEqual(['Dawn', 'Day', 'Dusk', 'Night']);
    expect(screen.getByRole('button', { name: /Dusk/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Day/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Night/ }));
    expect(onPick).toHaveBeenCalledWith('night');
  });

  it('has no Unlit entry unless asked for', () => {
    render(<TimeTiles value="day" onPick={() => {}} />);
    expect(screen.queryByRole('button', { name: /Unlit/ })).toBeNull();
  });

  it('leads with Unlit when asked, chosen while the value is unlit', () => {
    const onPick = vi.fn();
    render(<TimeTiles value="unlit" unlit onPick={onPick} />);
    expect(names(screen.getByRole('group', { name: 'Time of day' }))).toEqual(['Unlit', 'Dawn', 'Day', 'Dusk', 'Night']);
    const unlit = screen.getByRole('button', { name: /Unlit/ });
    expect(unlit.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Dawn/ }));
    expect(onPick).toHaveBeenCalledWith('dawn');
    fireEvent.click(unlit);
    expect(onPick).toHaveBeenCalledWith('unlit');
  });

  it('multiplies a time’s tint over its whole picture, and only that time’s', () => {
    render(<TimeTiles value="day" unlit tints={{ night: '#ff0000' }} onPick={() => {}} />);
    const tintOf = (name: RegExp) => screen.getByRole('button', { name }).querySelector<HTMLElement>('[data-slot="sky-tint"]');
    expect(tintOf(/Night/)?.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(tintOf(/Night/)?.className).toContain('mix-blend-multiply');
    expect(tintOf(/Day/)).toBeNull();
    expect(tintOf(/Unlit/)).toBeNull();
  });
});

describe('PlaceTiles', () => {
  it('lists outdoor, indoor and underground and reports a pick', () => {
    const onPick = vi.fn();
    render(<PlaceTiles value="indoor" onPick={onPick} />);
    expect(names(screen.getByRole('group', { name: 'Place' }))).toEqual(['Outdoor', 'Indoor', 'Underground']);
    expect(screen.getByRole('button', { name: /Indoor/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Underground/ }));
    expect(onPick).toHaveBeenCalledWith('underground');
  });

  it('has no inherit entry unless asked for', () => {
    render(<PlaceTiles value="outdoor" onPick={() => {}} />);
    expect(screen.queryByRole('button', { name: /Follows/ })).toBeNull();
  });

  it('leads with the inherit entry, chosen while the value is null, and picks null', () => {
    const onPick = vi.fn();
    render(<PlaceTiles value={null} inherit={{ label: 'Follows', resolves: 'underground' }} onPick={onPick} />);
    const group = screen.getByRole('group', { name: 'Place' });
    expect(names(group)).toEqual(['Follows', 'Outdoor', 'Indoor', 'Underground']);
    const follows = screen.getByRole('button', { name: /Follows/ });
    expect(follows.getAttribute('aria-pressed')).toBe('true');
    // drawn faded as the place it resolves to
    expect(follows.querySelector('[data-slot="sky-picture"]')?.className).toContain('opacity-45');
    expect(screen.getByRole('button', { name: /Outdoor/ }).querySelector('[data-slot="sky-picture"]')?.className).not.toContain('opacity-45');
    fireEvent.click(screen.getByRole('button', { name: /Indoor/ }));
    expect(onPick).toHaveBeenCalledWith('indoor');
    fireEvent.click(follows);
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it('supports a different inherit label such as As built', () => {
    render(<PlaceTiles value="outdoor" inherit={{ label: 'As built', resolves: 'indoor' }} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /As built/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('wide shares the row width between the tiles', () => {
    const { rerender } = render(<PlaceTiles value="outdoor" onPick={() => {}} />);
    expect(screen.getByRole('group', { name: 'Place' }).className).toContain('flex-wrap');
    expect(screen.getByRole('button', { name: /Outdoor/ }).className).not.toContain('flex-1');
    rerender(<PlaceTiles value="outdoor" wide onPick={() => {}} />);
    expect(screen.getByRole('group', { name: 'Place' }).className).toContain('flex-nowrap');
    expect(screen.getByRole('button', { name: /Outdoor/ }).className).toContain('flex-1');
  });
});
