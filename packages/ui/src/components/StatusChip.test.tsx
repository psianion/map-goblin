import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it('is 28 tall, mono 11 in text-3 with tabular numerals', () => {
    render(<StatusChip>Grid 5 ft</StatusChip>);
    const chip = screen.getByText('Grid 5 ft');
    for (const c of ['h-7', 'font-mono', 'text-[11px]', 'text-text-3', 'tabular-nums']) expect(chip.className.split(' ')).toContain(c);
  });
});
