import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GalleryRoute } from './GalleryRoute';

// The order of docs/plans/canvas-v2-shell/mockups/design-system.html.
const ORDER = ['tokens', 'type', 'space', 'ibs', 'btns', 'ctls', 'tiles', 'rows', 'heads', 'dock', 'bars', 'overlays', 'gutters'];

describe('GalleryRoute', () => {
  it('mounts every design-system section in the page order', () => {
    render(<GalleryRoute />);
    const ids = [...document.querySelectorAll('[data-gallery-section]')].map((s) => s.getAttribute('data-gallery-section'));
    expect(ids).toEqual(ORDER);
  });

  it('switches the theme on <html>', () => {
    render(<GalleryRoute />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
