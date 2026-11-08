import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MarksLayer } from './MarksLayer';
import { useMarks } from './marks';
import { useLocalPins } from './pins';

beforeEach(() => {
  cleanup();
  useMarks.setState({
    marks: [
      { id: 'a', by: 'p1', msg: { kind: 'ping', x: 1, y: 1 }, expiresAt: Infinity },
      { id: 'b', by: 'p1', msg: { kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }, expiresAt: Infinity },
      { id: 'c', by: 'p2', msg: { kind: 'draw', points: [[0, 0], [1, 1]], ttl: 1000 }, expiresAt: Infinity },
    ],
  });
  useLocalPins.setState({ pins: [{ id: 'pin1', x: 2, y: 2, text: '', dmOnly: true }] });
});

describe('MarksLayer', () => {
  it('draws each mark and pin, the ruler with its distance', () => {
    const { container } = render(<MarksLayer />);
    expect(container.querySelector('[data-mark="ping"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="draw"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="ruler"]')?.textContent).toBe('25 ft');
    expect(screen.getAllByTestId('map-pin')).toHaveLength(1);
  });
});
