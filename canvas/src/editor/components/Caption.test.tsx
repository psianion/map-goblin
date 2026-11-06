import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Caption } from './Caption';

describe('Caption', () => {
  it('is 10/500 uppercase with 0.04em tracking in text-3', () => {
    render(<Caption className="extra">Placement</Caption>);
    const cap = screen.getByText('Placement');
    for (const c of ['text-[10px]', 'font-medium', 'uppercase', 'tracking-[0.04em]', 'text-text-3', 'extra'])
      expect(cap.className.split(' ')).toContain(c);
  });
});
