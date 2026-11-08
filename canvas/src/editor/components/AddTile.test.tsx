import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddTile } from './AddTile';

describe('AddTile', () => {
  it('is the dashed line-strong tile with a plus and its name', () => {
    const onClick = vi.fn();
    render(<AddTile name="From library" onClick={onClick} />);
    const tile = screen.getByRole('button', { name: 'From library' });
    const thumb = tile.querySelector('[data-slot="tile-thumb"]') as HTMLElement;
    for (const c of ['h-11', 'w-14', 'border-dashed', 'border-line-strong']) expect(thumb.className.split(' ')).toContain(c);
    expect(thumb.querySelector('svg')).not.toBeNull();
    fireEvent.click(tile);
    expect(onClick).toHaveBeenCalled();
  });
});
