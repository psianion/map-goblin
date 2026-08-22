import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, type IconName } from './icons';

const RAIL: IconName[] = [
  'initiative',
  'fog',
  'doors',
  'tokens',
  'scene',
  'world',
  'triggers',
  'log',
  'me',
  'session',
];

const INLINE: IconName[] = [
  'reveal',
  'hide',
  'brush',
  'lock',
  'unlock',
  'secret',
  'frame',
  'place',
  'copy',
  'close',
  'more',
  'plus',
  'whisper',
  'dice',
  'chevron',
  'check',
];

const ALL: IconName[] = [...RAIL, ...INLINE];

describe('Icon', () => {
  it('has exactly the rail + inline glyphs the M2 spec lists', () => {
    expect(new Set(ALL).size).toBe(ALL.length); // no duplicates
    expect(ALL.length).toBe(26);
  });

  it.each(ALL)('renders %s as an svg with at least one path or circle', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    const shapes = svg?.querySelectorAll('path, circle') ?? [];
    expect(shapes.length).toBeGreaterThan(0);
  });

  it('defaults to 16px, hides from a11y tree without a title', () => {
    const { container } = render(<Icon name="close" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
  });

  it('exposes an accessible name and role when given a title', () => {
    const { container } = render(<Icon name="close" size={20} title="Close" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('aria-hidden')).toBe('false');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('title')?.textContent).toBe('Close');
  });
});
