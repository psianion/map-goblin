import { cn } from '@/lib/utils';

/** One status bar item: 28 tall, mono 11 in text-3, tabular numerals; keycaps may sit inside. */
function StatusChip({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-composite="status-chip"
      className={cn(
        'inline-flex h-7 items-center gap-2 font-mono text-[11px] whitespace-nowrap text-text-3 tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export { StatusChip };
