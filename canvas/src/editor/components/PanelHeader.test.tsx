import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrickWall, SquareDashed } from 'lucide-react';
import { IconKeyButton } from './IconKeyButton';
import { PanelHeader } from './PanelHeader';

describe('PanelHeader', () => {
  it('is 40 tall with the breadcrumb at 11/12 and the switcher row at the right', () => {
    const { container } = render(
      <PanelHeader path={['Design']} title="Floor">
        <IconKeyButton size={26} icon={SquareDashed} label="Floor" shortcut="F" active />
        <IconKeyButton size={26} icon={BrickWall} label="Wall" shortcut="W" />
      </PanelHeader>,
    );
    const head = container.firstElementChild as HTMLElement;
    for (const c of ['h-10', 'pl-3', 'pr-2', 'gap-2', 'border-b', 'border-line']) expect(head.className.split(' ')).toContain(c);
    const crumb = head.firstElementChild as HTMLElement;
    expect(crumb.textContent).toBe('Design / Floor');
    expect(crumb.className).toContain('text-[11px]');
    const title = screen.getByText('Floor', { selector: 'b' });
    expect(title.className).toContain('text-[12px]');
    const right = head.lastElementChild as HTMLElement;
    expect(right.className).toContain('ml-auto');
    expect(right.className).toContain('gap-[2px]');
    expect(screen.getByRole('button', { name: 'Wall' }).className).toContain('size-[26px]');
  });
});
