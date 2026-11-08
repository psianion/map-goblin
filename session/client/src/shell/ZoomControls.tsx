import { useEffect, useState } from 'react';
import { IconKeyButton, cn } from '@dnd/ui';
import { Maximize, Minus, Plus } from '@dnd/ui/icons';
import { readZoomPercent, zoomFit, zoomIn, zoomOut } from './zoom';

function useZoomPercent(): number | null {
  const [pct, setPct] = useState<number | null>(readZoomPercent);
  useEffect(() => {
    const timer = setInterval(() => setPct(readZoomPercent()), 200);
    return () => clearInterval(timer);
  }, []);
  return pct;
}

/** −, the zoom, +, fit: the dock row's zoom on the DM side, the zoom pill on the player side. */
export function ZoomControls({ className }: { className?: string }) {
  const pct = useZoomPercent();
  return (
    <div className={cn('flex items-center gap-0.5', className)} data-testid="zoom-controls">
      <IconKeyButton size={28} icon={Minus} label="Zoom out" onClick={zoomOut} data-testid="zoom-out" />
      <span className="w-12 text-center font-mono text-xs text-text-2" data-testid="zoom-percent">
        {pct === null ? '' : `${pct}%`}
      </span>
      <IconKeyButton size={28} icon={Plus} label="Zoom in" onClick={zoomIn} data-testid="zoom-in" />
      <IconKeyButton size={28} icon={Maximize} label="Fit map" shortcut="0" onClick={zoomFit} data-testid="zoom-fit" />
    </div>
  );
}
