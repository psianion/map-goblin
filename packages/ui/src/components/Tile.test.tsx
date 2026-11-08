import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tile } from './Tile';

describe('Tile', () => {
  it('is a 56 by 44 thumb with its name under it, 3 apart, cut with an ellipsis', () => {
    render(<Tile name="Cracked earth is long" color="#a08f74" />);
    const tile = screen.getByRole('button', { name: /Cracked earth/ });
    expect(tile.className).toContain('gap-[3px]');
    const thumb = tile.querySelector('[data-slot="tile-thumb"]') as HTMLElement;
    for (const c of ['h-11', 'w-14', 'rounded-control', 'border-line']) expect(thumb.className.split(' ')).toContain(c);
    expect(thumb.style.backgroundColor).toBe('rgb(160, 143, 116)');
    const name = tile.querySelector('[data-slot="tile-name"]') as HTMLElement;
    for (const c of ['text-[10px]', 'text-text-2', 'truncate', 'max-w-14']) expect(name.className.split(' ')).toContain(c);
  });

  it('active rings the thumb; locked shows the badge top right', () => {
    render(<Tile name="Walls" active locked />);
    const tile = screen.getByRole('button', { name: /Walls/ });
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    const thumb = tile.querySelector('[data-slot="tile-thumb"]') as HTMLElement;
    expect(thumb.className).toContain('ring-[1.5px]');
    expect(thumb.className).toContain('ring-ink');
    const lock = screen.getByLabelText('Locked');
    expect(lock.getAttribute('class')).toContain('top-[3px]');
    expect(lock.getAttribute('class')).toContain('right-[3px]');
  });
});
