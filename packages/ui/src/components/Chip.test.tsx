import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Chip } from './Chip';

describe('Chip', () => {
  it('is a 22 pill, 10 aside, and on is the ink ring', () => {
    render(<Chip>Props</Chip>);
    const chip = screen.getByRole('button', { name: 'Props' });
    for (const c of ['h-[22px]', 'px-2.5', 'rounded-pill', 'text-[11px]', 'border-line']) expect(chip.className.split(' ')).toContain(c);
    expect(chip.hasAttribute('data-pressed')).toBe(false);
    fireEvent.click(chip);
    expect(chip.hasAttribute('data-pressed')).toBe(true);
    expect(chip.className).toContain('data-[pressed]:ring-[1.5px]');
    expect(chip.className).not.toMatch(/data-\[pressed\]:bg-/);
  });
});
