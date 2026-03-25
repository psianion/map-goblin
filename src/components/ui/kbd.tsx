import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface KbdProps {
  className?: string;
  children: ReactNode;
}

function Kbd({ className, children }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono bg-surface-2 border border-border-subtle rounded text-text-secondary min-w-[1.5rem] text-center',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

interface KbdGroupProps {
  className?: string;
  children: ReactNode;
}

function KbdGroup({ className, children }: KbdGroupProps) {
  return (
    <span className={cn('inline-flex gap-0.5 items-center', className)}>
      {children}
    </span>
  );
}

export { Kbd, KbdGroup };
