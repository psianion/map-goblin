import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Swatch } from './Swatch';

describe('Swatch', () => {
  it('is 24, radius 6, filled with its colour', () => {
    render(<Swatch label="Moss" color="#8c9a6c" />);
    const sw = screen.getByRole('button', { name: 'Moss' });
    for (const c of ['size-6', 'rounded-control', 'border-line']) expect(sw.className.split(' ')).toContain(c);
    expect(sw.style.backgroundColor).toBe('rgb(140, 154, 108)');
    expect(sw.hasAttribute('data-empty')).toBe(false);
  });

  it('empty means none: a bare hairline box', () => {
    render(<Swatch label="No tint" color={null} />);
    const sw = screen.getByRole('button', { name: 'No tint' });
    expect(sw.hasAttribute('data-empty')).toBe(true);
    expect(sw.style.backgroundColor).toBe('transparent');
  });
});
