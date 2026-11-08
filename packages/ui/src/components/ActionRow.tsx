import { cn } from '../lib/utils';

/**
 * A row of 26 IconKeyButtons, 2 apart, 6 above and below, 8 aside, a hairline below.
 * A danger button (delete) is pushed to the right end.
 */
function ActionRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="toolbar"
      data-composite="action-row"
      className={cn('flex w-full gap-[2px] border-b border-line px-2 py-1.5 [&>[data-danger]]:ml-auto', className)}
      {...props}
    />
  );
}

export { ActionRow };
