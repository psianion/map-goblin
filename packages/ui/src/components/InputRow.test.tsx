import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InputRow } from './InputRow';

describe('InputRow', () => {
  it('is a setting row with a 72 wide, 24 tall input named by its label', () => {
    render(<InputRow label="Width" defaultValue="5 ft" inputMode="decimal" />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;
    expect(input.value).toBe('5 ft');
    expect(input.className).toContain('w-[72px]');
    expect(input.className).toContain('h-6');
    expect(input.closest('[data-composite="setting-row"]')).not.toBeNull();
  });
});
