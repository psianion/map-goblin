import { FloatBox } from '@dnd/ui';
import { ZoomControls } from './ZoomControls';

/** Bottom right on the player side; the DM has the same controls in the dock row. */
export function ZoomPill() {
  return (
    <FloatBox className="absolute right-3 bottom-3 z-20 max-sm:bottom-16 flex h-10 items-center rounded-pill px-1 py-0" data-testid="zoom-pill" data-chrome>
      <ZoomControls />
    </FloatBox>
  );
}
