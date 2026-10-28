import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlideOverProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  /** Replaces the plain title row (a sheet with its own buttons, or a second page). */
  header?: ReactNode;
  /**
   * The body hosts a v1 panel by default (`v2-legacy` restyles it); a sheet built for v2
   * passes false and styles itself.
   */
  legacy?: boolean;
  /** Extra class on the sheet (a v2 sheet that styles itself). */
  className?: string;
  /** A line pinned under the body. */
  footer?: ReactNode;
}

/** A right-hand sheet: the full v1 panels the shell has no room for, and v2's own sheets. */
export function SlideOver({ title, open, onClose, children, testId, header, legacy = true, className, footer }: SlideOverProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A field inside the sheet keeps its own Escape (rename, filter).
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <aside className={cn('v2-sheet v2-float', className)} data-testid={testId} aria-label={title}>
      {header ?? (
        <header className="v2-sheet__head">
          <h2>{title}</h2>
          <button type="button" className="v2-ib" aria-label={`Close ${title}`} onClick={onClose}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>
      )}
      <div className={cn('v2-sheet__body', legacy && 'v2-legacy')}>{children}</div>
      {footer}
    </aside>
  );
}
