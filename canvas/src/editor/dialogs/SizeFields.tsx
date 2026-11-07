import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import { Input } from '@/ui/input';
import { Seg } from '@/editor/components';
import { ErrorLine, Field, Hint } from './parts';

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
 * The map size control the New map and Map settings dialogs share: grows-as-you-draw or a
 * fixed frame in squares. Controlled, so each dialog keeps its own rules for what Fixed
 * starts at.
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
    <Field label="Size">
      <Seg
        aria-label="Size"
        value={mode}
        onValueChange={(v) => onModeChange(v as SizeMode)}
        options={[
          { value: 'expanding', label: 'Grows as you draw' },
          { value: 'fixed', label: 'Fixed' },
        ]}
      />
      {mode === 'fixed' && (
        <>
          <div className="flex items-center gap-1.5 text-[12px] text-text-2">
            <Input
              className="w-[72px]"
              inputMode="numeric"
              aria-label="Width in squares"
              aria-invalid={invalid || undefined}
              value={widthText}
              onChange={(e) => onWidthChange(e.target.value)}
            />
            <span>×</span>
            <Input
              className="w-[72px]"
              inputMode="numeric"
              aria-label="Height in squares"
              aria-invalid={invalid || undefined}
              value={heightText}
              onChange={(e) => onHeightChange(e.target.value)}
            />
            <span>squares</span>
          </div>
          {invalid ? (
            <ErrorLine>Whole numbers, at most {MAX_FIXED_CELLS.toLocaleString()} squares in all.</ErrorLine>
          ) : (
            <Hint>The map keeps this size; nothing can be drawn past its edge.</Hint>
          )}
        </>
      )}
    </Field>
  );
}
