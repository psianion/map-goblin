import { cn } from '@/lib/utils';

/** The float: panel, hairline, radius 8, the float shadow, 8px from its edge to its content. */
function FloatBox({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-composite="float-box"
      className={cn('rounded-float border border-line bg-panel p-2 text-text shadow-e', className)}
      {...props}
    />
  );
}

export { FloatBox };
