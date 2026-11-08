import { cn } from '../lib/utils';

/** Section caption: 10/500, uppercase, 0.04em tracking, text-3. */
function Caption({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-composite="caption"
      className={cn('text-[10px] font-medium tracking-[0.04em] text-text-3 uppercase', className)}
      {...props}
    />
  );
}

export { Caption };
