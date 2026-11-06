import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Seg } from './Seg';

const options = [
  { value: 'draw', label: 'Draw' },
  { value: 'carve', label: 'Carve out' },
];

describe('Seg', () => {
  it('shows one chosen cell in panel-3 and reports a new pick', () => {
    const onValueChange = vi.fn();
    render(<Seg aria-label="Mode" options={options} value="draw" onValueChange={onValueChange} />);
    const draw = screen.getByRole('button', { name: 'Draw' });
    expect(draw.hasAttribute('data-pressed')).toBe(true);
    expect(draw.className).toContain('data-[pressed]:bg-panel-3');
    expect(draw.className).toContain('h-[22px]');
    expect(draw.className).toContain('px-2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Carve out' }));
    expect(onValueChange).toHaveBeenCalledWith('carve');
  });

  it('pressing the chosen cell keeps it chosen', () => {
    const onValueChange = vi.fn();
    render(<Seg options={options} value="draw" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
