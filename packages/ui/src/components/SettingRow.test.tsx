import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow } from './SettingRow';

describe('SettingRow', () => {
  it('is 248 wide and 28 minimum, label left in text-2, control right', () => {
    render(
      <SettingRow label="Edge band">
        <span>control</span>
      </SettingRow>,
    );
    const label = screen.getByText('Edge band');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toContain('text-text-2');
    expect(label.className).toContain('text-[12px]');
    const row = label.parentElement!;
    for (const c of ['w-[248px]', 'min-h-7', 'grid-cols-[1fr_auto]', 'items-center']) expect(row.className.split(' ')).toContain(c);
    expect(row.lastElementChild!.textContent).toBe('control');
  });
});
