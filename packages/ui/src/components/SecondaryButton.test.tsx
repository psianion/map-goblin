import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Eraser } from 'lucide-react';
import { SecondaryButton } from './SecondaryButton';

describe('SecondaryButton', () => {
  it('is the 24 hairline button, 10 aside, 11, with a 14 icon 6 from the label', () => {
    render(
      <SecondaryButton icon={Eraser} active>
        Erase
      </SecondaryButton>,
    );
    const btn = screen.getByRole('button', { name: 'Erase' });
    for (const c of ['h-6', 'px-2.5', 'text-[11px]', 'border-line', 'gap-1.5']) expect(btn.className.split(' ')).toContain(c);
    expect(btn.querySelector('svg')!.getAttribute('class')).toContain('size-3.5');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.className).toContain('aria-pressed:ring-ink');
  });
});
