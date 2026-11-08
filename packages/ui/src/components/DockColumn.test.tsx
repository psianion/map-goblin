import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockColumn } from './DockColumn';

describe('DockColumn', () => {
  it('is the caption row with its one control at the right, then the strip, always 112 tall', () => {
    const { container } = render(
      <DockColumn title="Layers" control={<span>plus</span>}>
        <span>tile</span>
      </DockColumn>,
    );
    const col = container.firstElementChild as HTMLElement;
    for (const c of ['h-[112px]', 'px-2.5', 'py-2', 'gap-1.5', 'border-r', 'last:border-r-0']) expect(col.className.split(' ')).toContain(c);
    const caption = col.firstElementChild as HTMLElement;
    expect(caption.className).toContain('uppercase');
    expect(caption.className).toContain('text-[10px]');
    expect(screen.getByText('plus').parentElement!.className).toContain('ml-auto');
    expect(screen.getByText('tile').parentElement!.className).toContain('gap-1.5');
  });
});
