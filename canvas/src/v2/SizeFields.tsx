import { AlertCircle } from 'lucide-react';
import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import { cn } from '@/lib/utils';

export type SizeMode = 'expanding' | 'fixed';

export interface SizeFieldsProps {
  mode: SizeMode;
  onModeChange: (mode: SizeMode) => void;
  widthText: string;
  heightText: string;
  onWidthChange: (text: string) => void;
  onHeightChange: (text: string) => void;
  /** Fixed is chosen and the two numbers are not a size `normalizeFixedSize` accepts. */
  invalid: boolean;
}

/**
 * The map size control both v2 dialogs share: grows-as-you-draw or a fixed frame in
 * squares. Controlled, so each dialog keeps its own rules for what Fixed starts at.
 */
export function SizeFields({
  mode,
  onModeChange,
  widthText,
  heightText,
  onWidthChange,
  onHeightChange,
  invalid,
}: SizeFieldsProps) {
  return (
    <div>
      <span className="v2-label">Size</span>
      <div className="v2-segs" role="radiogroup" aria-label="Size">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'expanding'}
          className={cn('v2-seg', mode === 'expanding' && 'v2-seg--on')}
          onClick={() => onModeChange('expanding')}
        >
          Grows as you draw
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'fixed'}
          className={cn('v2-seg', mode === 'fixed' && 'v2-seg--on')}
          onClick={() => onModeChange('fixed')}
        >
          Fixed
        </button>
      </div>
      {mode === 'fixed' && (
        <>
          <div className="v2-size-row">
            <input
              className="v2-input v2-input--num"
              inputMode="numeric"
              aria-label="Width in squares"
              value={widthText}
              onChange={(e) => onWidthChange(e.target.value)}
            />
            <span>×</span>
            <input
              className="v2-input v2-input--num"
              inputMode="numeric"
              aria-label="Height in squares"
              value={heightText}
              onChange={(e) => onHeightChange(e.target.value)}
            />
            <span>squares</span>
          </div>
          {invalid ? (
            <p role="alert" className="v2-error">
              <AlertCircle size={14} className="mt-px shrink-0" />
              Whole numbers, at most {MAX_FIXED_CELLS.toLocaleString()} squares in all.
            </p>
          ) : (
            <p className="v2-hint">The map keeps this size; nothing can be drawn past its edge.</p>
          )}
        </>
      )}
    </div>
  );
}
