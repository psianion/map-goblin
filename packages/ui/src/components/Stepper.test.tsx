import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Stepper } from './Stepper';

describe('Stepper', () => {
  it('is 24 tall with 22 cells and a mono value, steps and stops at its bounds', () => {
    const onValueChange = vi.fn();
    render(<Stepper label="Sides" value={6} min={3} max={6} onValueChange={onValueChange} />);
    const group = screen.getByRole('group', { name: 'Sides' });
    expect(group.className).toContain('h-6');
    expect(group.className).toContain('font-mono');
    expect(group.textContent).toContain('6');
    const less = screen.getByRole('button', { name: 'Decrease Sides' });
    expect(less.className).toContain('w-[22px]');
    fireEvent.click(less);
    expect(onValueChange).toHaveBeenCalledWith(5);
    expect((screen.getByRole('button', { name: 'Increase Sides' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('formats its value', () => {
    render(<Stepper label="Offset" value={2} format={(n) => (n > 0 ? `+${n}` : `${n}`)} onValueChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Offset' }).textContent).toContain('+2');
  });
});
