import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LevelList } from './LevelList';

const levels = [
  { id: '3', label: 'L3 Attic' },
  { id: '2', label: 'L2 Cellars' },
  { id: '1', label: 'L1 Ground' },
];

describe('LevelList', () => {
  it('draws mono rows, radius 4, the current one panel-3, and reports a pick', () => {
    const onValueChange = vi.fn();
    render(<LevelList levels={levels} value="2" onValueChange={onValueChange} />);
    const current = screen.getByRole('button', { name: 'L2 Cellars' });
    expect(current.getAttribute('aria-pressed')).toBe('true');
    for (const c of ['rounded-key', 'font-mono', 'text-[10px]', 'px-1.5', 'py-0.5', 'data-[active]:bg-panel-3'])
      expect(current.className.split(' ')).toContain(c);
    expect(screen.getByRole('button', { name: 'L3 Attic' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'L1 Ground' }));
    expect(onValueChange).toHaveBeenCalledWith('1');
  });
});
