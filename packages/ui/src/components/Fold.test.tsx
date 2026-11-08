import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Fold } from './Fold';

describe('Fold', () => {
  it('shut is one line with a mono summary; open shows its rows', () => {
    render(
      <Fold title="Fill" summary="scale 1 · 0° · offset 0, 0">
        <div>Scale row</div>
      </Fold>,
    );
    const head = screen.getByRole('button', { name: /Fill/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.className).toContain('min-h-7');
    const summary = screen.getByText('scale 1 · 0° · offset 0, 0');
    expect(summary.className).toContain('font-mono');
    expect(screen.queryByText('Scale row')).toBeNull();
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Scale row')).toBeTruthy();
    expect(screen.queryByText('scale 1 · 0° · offset 0, 0')).toBeNull();
  });
});
