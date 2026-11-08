import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SelectRow } from './SelectRow';

describe('SelectRow', () => {
  it('is a setting row whose 24 trigger shows the chosen option by label', () => {
    render(
      <SelectRow
        label="Edge band"
        value="ink"
        onValueChange={() => {}}
        options={[
          { value: 'ink', label: 'Cave ink' },
          { value: 'oak', label: 'Oak plank' },
        ]}
      />,
    );
    const trigger = document.querySelector('[data-slot="select-trigger"]') as HTMLElement;
    expect(trigger.className).toContain('h-6');
    expect(trigger.textContent).toContain('Cave ink');
    expect(trigger.closest('[data-composite="setting-row"]')).not.toBeNull();
    const labelId = screen.getByText('Edge band').id;
    expect(trigger.getAttribute('aria-labelledby')).toBe(labelId);
  });
});
