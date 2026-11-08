import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Copy, Trash2 } from 'lucide-react';
import { ActionRow } from './ActionRow';
import { IconKeyButton } from './IconKeyButton';

describe('ActionRow', () => {
  it('lays 26 buttons 2 apart and pushes delete to the right end', () => {
    render(
      <ActionRow aria-label="Door actions">
        <IconKeyButton size={26} icon={Copy} label="Duplicate" />
        <IconKeyButton size={26} icon={Trash2} label="Delete" danger />
      </ActionRow>,
    );
    const row = screen.getByRole('toolbar', { name: 'Door actions' });
    for (const c of ['gap-[2px]', 'px-2', 'py-1.5', 'border-b', '[&>[data-danger]]:ml-auto']) expect(row.className.split(' ')).toContain(c);
    expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('data-danger')).toBe(true);
    expect(screen.getByRole('button', { name: 'Duplicate' }).hasAttribute('data-danger')).toBe(false);
  });
});
