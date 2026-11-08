import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ColourRow } from './ColourRow';

describe('ColourRow', () => {
  it('shows the colour in a swatch that opens a hex field', () => {
    const onValueChange = vi.fn();
    render(<ColourRow label="Tint" value="#8c9a6c" onValueChange={onValueChange} />);
    const swatch = screen.getByRole('button', { name: 'Tint' });
    expect(swatch.style.backgroundColor).toBe('rgb(140, 154, 108)');
    expect(swatch.closest('[data-composite="setting-row"]')).not.toBeNull();
    fireEvent.click(swatch);
    const hex = screen.getByLabelText('Tint hex') as HTMLInputElement;
    expect(hex.value).toBe('#8c9a6c');
    fireEvent.change(hex, { target: { value: '#ffdd8' } });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: '#ffdd88' } });
    expect(onValueChange).toHaveBeenCalledWith('#ffdd88');
  });
});
