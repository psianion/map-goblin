import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

type PrimaryButtonProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'>;

/** The one ink button per surface: 28 tall, 14 aside, 12/500, no border (the page's is 0). */
function PrimaryButton({ className, ...props }: PrimaryButtonProps) {
  return (
    <Button
      variant="default"
      size="default"
      data-composite="primary-button"
      className={cn('border-0', className)}
      {...props}
    />
  );
}

export { PrimaryButton };
