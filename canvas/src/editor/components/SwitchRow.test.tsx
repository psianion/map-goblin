import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SwitchRow } from './SwitchRow';

describe('SwitchRow', () => {
  it('is a setting row whose switch is named by its label', () => {
    const onCheckedChange = vi.fn();
    render(<SwitchRow label="Snap to grid" checked={false} onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: 'Snap to grid' });
    expect(sw.closest('[data-composite="setting-row"]')).not.toBeNull();
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
