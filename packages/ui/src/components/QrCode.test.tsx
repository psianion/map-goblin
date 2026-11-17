import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { encode } from 'uqr';
import { QrCode } from './QrCode';

describe('QrCode', () => {
  it('draws every dark module of the encoded link, with a quiet zone', () => {
    const link = 'https://table.example/join/ABCD';
    render(<QrCode value={link} label="Invite QR" />);
    const svg = screen.getByRole('img', { name: 'Invite QR' });
    const qr = encode(link, { border: 4 });
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${qr.size} ${qr.size}`);
    const dark = qr.data.flat().filter(Boolean).length;
    expect(svg.querySelector('path')!.getAttribute('d')!.match(/M/g)).toHaveLength(dark);
    // The quiet zone: the first four rows hold nothing.
    expect(qr.data.slice(0, 4).flat().some(Boolean)).toBe(false);
  });
});
