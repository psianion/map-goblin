import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SliderRow } from './SliderRow';

describe('SliderRow', () => {
  it('puts the mono value beside the label and the track on its own line', () => {
    render(<SliderRow label="Opacity" value={100} format={(n) => `${n}%`} onValueChange={() => {}} />);
    const value = screen.getByText('100%');
    expect(value.className).toContain('font-mono');
    expect(value.className).toContain('text-[11px]');
    const row = value.parentElement!;
    expect(row.className).toContain('w-[248px]');
    const slider = row.querySelector('[data-slot="slider"]')!;
    expect(slider.getAttribute('class')).toContain('col-span-2');
    expect(row.querySelectorAll('[data-slot="slider-thumb"]')).toHaveLength(1);
    expect(screen.getByText('Opacity').tagName).toBe('LABEL');
    // jsdom hides the thumb until layout, so check the wiring rather than the computed name.
    expect(row.querySelector('input[type="range"]')!.getAttribute('aria-labelledby')).toBe(screen.getByText('Opacity').id);
  });
});
