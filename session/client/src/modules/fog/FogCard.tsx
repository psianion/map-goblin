import type { ReactNode } from 'react';
import { Kbd, cn } from '@dnd/ui';
import type { LucideIcon } from '@dnd/ui/icons';

interface FogCardProps {
  title: string;
  caption: string;
  on: boolean;
  /** The icon while off; `onIcon` replaces it while on, when the state changes the picture. */
  icon: LucideIcon;
  onIcon?: LucideIcon;
  /** A shortcut keycap in the corner instead of ON / OFF (the brush cards). */
  shortcut?: string;
  /** Off, the switches stand on the strong line and the brushes on the plain one. */
  quiet?: boolean;
  className?: string;
  onClick: () => void;
  'data-testid'?: string;
}

/**
 * One whole-card button of the Fog tab: an icon chip and its state in the top row, the name
 * and what it does now below. Off is a hairline with a muted chip; on is an ink ring with the
 * chip filled.
 */
export function FogCard({ title, caption, on, icon, onIcon, shortcut, quiet, className, onClick, 'data-testid': testId }: FogCardProps) {
  const Icon = on && onIcon ? onIcon : icon;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      data-state={on ? 'on' : 'off'}
      onClick={onClick}
      className={cn(
        'flex shrink-0 flex-col justify-between rounded-float border bg-panel p-2 text-left text-text transition-colors outline-none',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        on ? 'border-transparent ring-[1.5px] ring-ink ring-inset' : cn(quiet ? 'border-line' : 'border-line-strong', 'hover:bg-panel-2'),
        className,
      )}
    >
      <span className="flex items-center justify-between">
        <span
          aria-hidden
          data-testid={testId && `${testId}-icon`}
          data-icon={Icon.displayName}
          className={cn('grid size-7 place-items-center rounded-control', on ? 'bg-ink text-on-ink' : 'bg-bg text-text-2')}
        >
          <Icon strokeWidth={2.25} className="size-4" />
        </span>
        {shortcut ? <Kbd>{shortcut}</Kbd> : <Status on={on} />}
      </span>
      <span className="flex flex-col gap-px">
        <span className="text-[13px] leading-tight font-semibold">{title}</span>
        <span className="text-[11px] leading-tight text-text-3">{caption}</span>
      </span>
    </button>
  );
}

function Status({ on }: { on: boolean }) {
  return <span className={cn('font-mono text-[10px] font-medium', on ? 'text-text' : 'text-text-3')}>{on ? 'ON' : 'OFF'}</span>;
}

/** A zone of the tab: its small uppercase name over what it holds. */
export function FogZone({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn('flex min-h-0 shrink-0 flex-col gap-1.5', className)}>
      <span className="text-[9.5px] leading-none font-semibold tracking-[0.07em] text-text-3 uppercase">{label}</span>
      {children}
    </section>
  );
}

/** The hairline between zones. */
export const ZoneRule = () => <span aria-hidden className="w-px shrink-0 self-stretch bg-line" />;
