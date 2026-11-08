import { cn } from '@/lib/utils';

type DockColumnProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: string;
  /** The column's one control at the right end of its caption: a dropdown, a plus. */
  control?: React.ReactNode;
};

/**
 * A dock column: the caption row, then the strip 6 below it. 8 top and bottom, 10 aside,
 * a hairline after every column but the last, and always the dock's 112 tall.
 */
function DockColumn({ title, control, children, className, ...props }: DockColumnProps) {
  return (
    <div
      data-composite="dock-column"
      className={cn(
        'flex h-[112px] shrink-0 flex-col gap-1.5 border-r border-line px-2.5 py-2 last:border-r-0',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.04em] whitespace-nowrap text-text-3 uppercase">
        {title}
        {control ? (
          <span className="ml-auto inline-flex items-center gap-1 font-normal tracking-normal normal-case">{control}</span>
        ) : null}
      </div>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

export { DockColumn };
