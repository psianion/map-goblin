import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { KeyHint } from './KeyHint';

describe('KeyHint', () => {
  it('is a keycap and its label, 6 apart', () => {
    const { container } = render(<KeyHint keys="Enter">close</KeyHint>);
    const hint = container.firstElementChild as HTMLElement;
    expect(hint.className).toContain('gap-1.5');
    const kbd = hint.querySelector('[data-slot="kbd"]')!;
    expect(kbd.textContent).toBe('Enter');
    expect(hint.textContent).toBe('Enterclose');
  });

  it('a chord draws one keycap per key', () => {
    const { container } = render(<KeyHint keys={['Ctrl', 'E']}>export</KeyHint>);
    expect(container.querySelectorAll('[data-slot="kbd"]')).toHaveLength(2);
  });
});
