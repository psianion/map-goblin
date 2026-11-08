import type { LucideIcon } from 'lucide-react';
import { Button } from '@/ui/button';

type SecondaryButtonProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> & {
  icon?: LucideIcon;
  /** On shows the 1.5px inset ink ring, for a mode button such as Erase. */
  active?: boolean;
};

/** Hairline button: 24 tall, 10 aside, 11, an optional 14 icon 6 from the label. */
function SecondaryButton({ icon: Icon, active, children, ...props }: SecondaryButtonProps) {
  return (
    <Button variant="outline" size="sm" aria-pressed={active} data-composite="secondary-button" {...props}>
      {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
      {children}
    </Button>
  );
}

export { SecondaryButton };
