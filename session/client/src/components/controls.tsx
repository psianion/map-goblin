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
 *
 * `inline` sets the label beside the control (a fixed 64px column) instead of stacked above
 * it — the World block's row idiom, where the label reads once for the whole row rather than
 * over every dial in it. Default stays stacked; existing callers are untouched.
 */
export function Segmented<T extends string>({
  label,
  testId,
  value,
  options,
  onPick,
  disabled,
  describedBy,
  inline,
  ariaLabel,
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
  inline?: boolean;
  /** Overrides the group's accessible name with this exact text instead of the visible
   *  `label` — for a control whose caption stays short (e.g. "Type") but needs a fuller
   *  name (e.g. "Layer 2 type"). Pass `label=""` alongside it to drop the caption entirely
   *  when the context around the control already says what it is. */
  ariaLabel?: string;
}) {
  return (
    <div className={inline ? 'flex items-center gap-2' : 'flex flex-col gap-0.5'}>
      {label && (
        <span
          id={`${testId}-label`}
          className={inline ? 'w-16 shrink-0 text-xs text-text-muted' : 'text-xs text-text-secondary'}
        >
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-labelledby={ariaLabel || !label ? undefined : `${testId}-label`}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        data-value={value ?? ''}
        className={`flex gap-0.5 rounded border border-border-default bg-surface-1 p-0.5 ${inline ? 'flex-1' : ''}`}
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

/** The conceal toggle's own markup, lifted so every switch in this chrome is one thing.
 *  `disabled`/`title` are for a row-level switch with no room for a visible label (the
 *  Triggers list): the label rides in `children` as `sr-only` instead, and `title` gives it
 *  back as a hover tooltip. */
export function Switch({
  testId,
  checked,
  onToggle,
  children,
  disabled,
  title,
}: {
  testId: string;
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onToggle}
      className="flex items-center gap-2 rounded px-1 py-1 text-left text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-text-secondary motion-reduce:transition-none"
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
