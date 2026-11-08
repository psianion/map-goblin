import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { applyTheme } from '@dnd/ui';
import { ViewMenu } from './ViewMenu';

afterEach(() => {
  cleanup();
  applyTheme('light');
});

describe('ViewMenu', () => {
  it('switches the theme between light and dark', async () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByTestId('view-menu'));
    fireEvent.click(await screen.findByTestId('theme-dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('gg-theme')).toBe('dark');
    cleanup();
    render(<ViewMenu />);
    fireEvent.click(screen.getByTestId('view-menu'));
    fireEvent.click(await screen.findByTestId('theme-light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
