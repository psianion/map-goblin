import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SquareDashed } from 'lucide-react';
import { FlyoutRow } from './FlyoutRow';

describe('FlyoutRow', () => {
  it('is 44 tall: a 32 icon with its key, the name 13/500 over an 11 one-line description', () => {
    const onClick = vi.fn();
    render(
      <FlyoutRow icon={SquareDashed} shortcut="F" name="Floor" description="Rectangle, polygon, regular polygon" onClick={onClick} />,
    );
    const row = screen.getByRole('button', { name: /Floor/ });
    for (const c of ['h-11', 'grid-cols-[32px_1fr]', 'gap-3', 'px-2']) expect(row.className.split(' ')).toContain(c);
    const box = row.firstElementChild as HTMLElement;
    expect(box.className).toContain('size-8');
    expect(box.querySelector('[data-slot="icon-key-key"]')!.textContent).toBe('F');
    expect(box.querySelector('[data-slot="icon-key-icon"]')!.getAttribute('class')).toContain('size-4');
    // The row is the one button; the icon box inside it is not a second one.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Floor').className).toContain('text-[13px]');
    const desc = screen.getByText('Rectangle, polygon, regular polygon');
    expect(desc.className).toContain('text-[11px]');
    expect(desc.className).toContain('truncate');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalled();
  });
});
