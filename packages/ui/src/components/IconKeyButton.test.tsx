import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Mountain } from 'lucide-react';
import { IconKeyButton, type IconKeySize } from './IconKeyButton';

const icon = (btn: HTMLElement) => btn.querySelector('[data-slot="icon-key-icon"]') as SVGElement;
const key = (btn: HTMLElement) => btn.querySelector('[data-slot="icon-key-key"]') as HTMLElement | null;
const classes = (el: Element) => el.getAttribute('class')!.split(/\s+/);

// size → box, icon size class, key placement and size, icon shift with a key
const SIZES: [IconKeySize, string, string, string[], string[]][] = [
  [26, 'size-[26px]', 'size-3.5', ['right-[3px]', 'bottom-[2px]', 'text-[8px]'], ['-translate-x-[1.5px]', '-translate-y-[1.5px]']],
  [28, 'size-7', 'size-4', ['right-[3px]', 'bottom-[2px]', 'text-[8px]'], ['-translate-x-[1.5px]', '-translate-y-[1.5px]']],
  [32, 'size-8', 'size-3.5', ['right-1', 'bottom-[3px]', 'text-[8px]'], ['-translate-x-[1.5px]', '-translate-y-[1.5px]']],
  [36, 'size-9', 'size-[18px]', ['right-[5px]', 'bottom-1', 'text-[9px]'], ['-translate-x-[2px]', '-translate-y-[2px]']],
];

describe('IconKeyButton', () => {
  it.each(SIZES)('size %i: box, icon, key corner and the icon shift with a key', (size, box, iconCls, keyCls, shift) => {
    render(<IconKeyButton icon={Mountain} label="Terrain" size={size} shortcut="T" />);
    const btn = screen.getByRole('button', { name: 'Terrain' });
    expect(classes(btn)).toContain(box);
    expect(classes(icon(btn))).toContain(iconCls);
    for (const c of shift) expect(classes(icon(btn))).toContain(c);
    const k = key(btn)!;
    expect(k.textContent).toBe('T');
    expect(k.getAttribute('aria-hidden')).toBe('true');
    for (const c of [...keyCls, 'absolute', 'font-mono', 'text-text-3']) expect(classes(k)).toContain(c);
  });

  it.each(SIZES)('size %i without a key: no key and the icon centred, unshifted', (size, box, iconCls) => {
    render(<IconKeyButton icon={Mountain} label="Terrain" size={size} />);
    const btn = screen.getByRole('button', { name: 'Terrain' });
    expect(classes(btn)).toContain(box);
    expect(classes(btn)).toEqual(expect.arrayContaining(['items-center', 'justify-center']));
    expect(key(btn)).toBeNull();
    expect(classes(icon(btn))).toContain(iconCls);
    expect(icon(btn).getAttribute('class')).not.toMatch(/translate/);
  });

  it('rest: text-2, no fill, no ring', () => {
    render(<IconKeyButton icon={Mountain} label="Terrain" />);
    const btn = screen.getByRole('button', { name: 'Terrain' });
    expect(classes(btn)).toEqual(expect.arrayContaining(['text-text-2', 'bg-transparent']));
    expect(btn.hasAttribute('data-active')).toBe(false);
  });

  it('hover fills panel-3; active is the 1.5px inset ink ring with no fill; both can show', () => {
    render(<IconKeyButton icon={Mountain} label="Terrain" active shortcut="T" />);
    const btn = screen.getByRole('button', { name: 'Terrain' });
    expect(btn.hasAttribute('data-active')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(classes(btn)).toEqual(
      expect.arrayContaining([
        'hover:bg-panel-3',
        'data-[active]:ring-[1.5px]',
        'data-[active]:ring-inset',
        'data-[active]:ring-ink',
        'data-[active]:text-text',
      ]),
    );
    // Active never fills and never cancels the hover fill.
    expect(btn.getAttribute('class')).not.toMatch(/data-\[active\]:(hover:)?bg-/);
    expect(classes(key(btn)!)).toContain('group-data-[active]/ikb:text-text-2');
  });

  it('focus is the 2px outline in the focus token, offset 1', () => {
    render(<IconKeyButton icon={Mountain} label="Terrain" />);
    expect(classes(screen.getByRole('button', { name: 'Terrain' }))).toEqual(
      expect.arrayContaining(['focus-visible:outline-2', 'focus-visible:outline-offset-1', 'focus-visible:outline-focus']),
    );
  });

  it('disabled is 38% opacity', () => {
    render(<IconKeyButton icon={Mountain} label="Terrain" disabled />);
    const btn = screen.getByRole('button', { name: 'Terrain' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(classes(btn)).toContain('disabled:opacity-[0.38]');
  });

  it('the icon never moves between states', () => {
    const { rerender } = render(<IconKeyButton icon={Mountain} label="Terrain" shortcut="T" />);
    const at = () => icon(screen.getByRole('button', { name: 'Terrain' })).getAttribute('class');
    const rest = at();
    rerender(<IconKeyButton icon={Mountain} label="Terrain" shortcut="T" active />);
    expect(at()).toBe(rest);
    rerender(<IconKeyButton icon={Mountain} label="Terrain" shortcut="T" disabled />);
    expect(at()).toBe(rest);
    rerender(<IconKeyButton icon={Mountain} label="Terrain" shortcut="T" danger />);
    expect(at()).toBe(rest);
  });

  it('danger paints the icon in the danger token and marks itself for the action row', () => {
    render(<IconKeyButton icon={Mountain} label="Delete" danger />);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(classes(btn)).toContain('text-danger');
    expect(btn.hasAttribute('data-danger')).toBe(true);
  });

  it('forwards the ref and the className', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconKeyButton ref={ref} icon={Mountain} label="Terrain" className="extra" />);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Terrain' }));
    expect(classes(ref.current!)).toContain('extra');
  });
});
