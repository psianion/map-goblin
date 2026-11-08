// The small fields the Text family's sheets share (a room's key, a zone's triggers and
// notes): a line or a few lines that write when they lose focus, a compact pick, and the
// add and remove buttons of a list.

import { useRef, useState } from 'react';
import { Plus, X, type LucideIcon } from 'lucide-react';
import {
  IconKeyButton,
  SecondaryButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@dnd/ui';

/** Keys typed in a sheet's field stay out of the canvas shortcuts. */
const keepKeys = (e: React.KeyboardEvent) => e.stopPropagation();

/**
 * A one-line field holding a draft while focused: Enter or leaving writes it when it changed,
 * Escape puts it back. `selectOnFocus` selects the whole value, so typing replaces it.
 */
export function DraftInput({
  label,
  value,
  onCommit,
  placeholder,
  className,
  autoFocus,
  selectOnFocus,
  mono,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  // The click that focused the field would put the caret back and undo the selection.
  const keepSelection = useRef(false);
  return (
    <Input
      aria-label={label}
      className={cn('min-w-0', mono && 'font-mono', className)}
      value={draft ?? value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      spellCheck={false}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(value);
        if (!selectOnFocus) return;
        e.currentTarget.select();
        keepSelection.current = true;
      }}
      onMouseUp={(e) => {
        if (!keepSelection.current) return;
        keepSelection.current = false;
        e.preventDefault();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft;
        setDraft(null);
        if (cancelled.current || next === null || next === value) return;
        onCommit(next);
      }}
      onKeyDown={(e) => {
        keepKeys(e);
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A few lines of text, written when the field loses focus. */
export function DraftArea({ label, value, onCommit, rows = 3 }: { label: string; value: string; onCommit: (v: string) => void; rows?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <textarea
      aria-label={label}
      rows={rows}
      spellCheck
      className="w-full resize-y rounded-control border border-line bg-panel px-2 py-1.5 text-[12px] leading-snug text-text outline-none placeholder:text-text-3 focus-visible:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-[0.38]"
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft;
        setDraft(null);
        if (next !== null && next !== value) onCommit(next);
      }}
      onKeyDown={keepKeys}
    />
  );
}

/** A compact pick inside a row of fields; the label is its accessible name. */
export function MiniSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <Select
      items={options as { value: T; label: string }[]}
      value={value}
      onValueChange={(next: string | null) => {
        if (next !== null) onChange(next as T);
      }}
    >
      <SelectTrigger aria-label={label} className={cn('shrink-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A list row's remove button. */
export function RemoveButton({ label, onClick, icon = X }: { label: string; onClick: () => void; icon?: LucideIcon }) {
  return <IconKeyButton size={26} icon={icon} label={label} data-tip={label} onClick={onClick} />;
}

/** The "Add …" at the foot of a list. */
export function AddButton({ children, onClick, icon = Plus }: { children: string; onClick: () => void; icon?: LucideIcon }) {
  return (
    <SecondaryButton icon={icon} className="self-start" onClick={onClick}>
      {children}
    </SecondaryButton>
  );
}

/** A quiet line under a field: what it does, or why it will not fire. */
export function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-[11px] leading-snug text-text-3', className)}>{children}</p>;
}

/** A flag beside a name: Off, Pops, Inside a room. */
export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-4 shrink-0 items-center rounded-pill border border-line px-1.5 text-[10px] text-text-2">{children}</span>;
}
