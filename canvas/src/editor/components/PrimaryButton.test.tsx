import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { PrimaryButton } from './PrimaryButton';

describe('PrimaryButton', () => {
  it('is the 28 ink button, 14 aside, 12/500, and forwards its ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <PrimaryButton ref={ref} className="extra">
        Publish
      </PrimaryButton>,
    );
    const btn = screen.getByRole('button', { name: 'Publish' });
    expect(ref.current).toBe(btn);
    for (const c of ['h-7', 'px-3.5', 'text-[12px]', 'font-medium', 'bg-ink', 'text-on-ink', 'hover:bg-ink-hover', 'border-0', 'extra'])
      expect(btn.className.split(' ')).toContain(c);
  });
});
