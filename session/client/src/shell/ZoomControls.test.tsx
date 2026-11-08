import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ZoomControls } from './ZoomControls';

afterEach(cleanup);

describe('ZoomControls', () => {
  it('shows no zoom before there is a map, and its buttons are safe without an engine', () => {
    render(<ZoomControls />);
    expect(screen.getByTestId('zoom-percent').textContent).toBe('—');
    fireEvent.click(screen.getByTestId('zoom-in'));
    fireEvent.click(screen.getByTestId('zoom-out'));
    fireEvent.click(screen.getByTestId('zoom-fit'));
    expect(screen.getByTestId('zoom-percent').textContent).toBe('—');
  });
});
