import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from '../lib/utils';

type QrCodeProps = {
  /** What the code says: a link, usually. */
  value: string;
  /** Read aloud in place of the picture. */
  label?: string;
  className?: string;
};

/**
 * A QR code drawn as one SVG path, ink on the panel colour with a four-module quiet zone. The
 * modules are crisp at any size (`shape-rendering`), so the box sets the size, not the code.
 */
function QrCode({ value, label = 'QR code', className }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { border: 4 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      data-composite="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('rounded-control bg-white', className)}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

export { QrCode };
