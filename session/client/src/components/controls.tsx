// The two chrome shapes more than one panel needs. Both were written inside `FogTool.tsx`,
// where they were the fog panel's own markup written once; the World block is the second
// caller, so they move here rather than becoming a third private copy.
//
// Nothing else moved with them: this is the same markup, the same tokens, the same roles.

import type { ReactNode } from 'react';

/**
 * A one-of-N choice. `role="radiogroup"` and not a row of `aria-pressed` buttons: pressed
 * says "this is on", which would leave a screen reader hearing two independent toggles where
 * a DM sees one either/or.
 *
 * `glyph` is for a vocabulary the eye reads faster than the word (the moon's phases) — it
 * sits *above* the label, never instead of it, so the choice never depends on the picture.
 * `disabled` is the inapplicable case: the control stays on screen, spelled out and unusable,
 * because a missing control teaches a DM nothing about why it is missing.
 */
export function Segmented<T extends string>({
  label,
  testId,
  value,
  options,
  onPick,
  disabled,
  describedBy,
}: {
  label: string;
  testId: string;
  value: T | null;
  options: readonly { value: T; label: string; glyph?: ReactNode }[];
  onPick: (value: T) => void;
  disabled?: boolean;
  /** The id of the sentence that says why this control is unusable — read with the group,
   *  not left as a paragraph a keyboard user never lands on. */
  describedBy?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span id={`${testId}-label`} className="text-xs text-text-secondary">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${testId}-label`}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        data-value={value ?? ''}
        className="flex gap-0.5 rounded border border-border-default bg-surface-1 p-0.5"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={disabled}
            data-value={option.value}
            onClick={() => onPick(option.value)}
            className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${
              option.value === value
                ? 'bg-surface-3 font-medium text-text-primary'
                : 'text-text-secondary enabled:hover:bg-surface-2 enabled:hover:text-text-primary enabled:active:bg-surface-1'
            }`}
          >
            {option.glyph ? (
              <span className="flex flex-col items-center gap-1">
                {option.glyph}
                <span className="max-w-full truncate">{option.label}</span>
              </span>
            ) : (
              option.label
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The conceal toggle's own markup, lifted so every switch in this chrome is one thing. */
export function Switch({
  testId,
  checked,
  onToggle,
  children,
}: {
  testId: string;
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      onClick={onToggle}
      className="flex items-center gap-2 rounded px-1 py-1 text-left text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-chip border ${
          checked ? 'border-border-focus bg-surface-3 text-text-primary' : 'border-border-default'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      {children}
    </button>
  );
}
