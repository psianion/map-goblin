import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

type SwatchProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'children' | 'color'> & {
  /** A CSS colour; empty means none and shows the bare hairline box. */
  color?: string | null;
  label: string;
};

/** A 24 colour swatch, radius 6, hairline. */
function Swatch({ color, label, className, style, ...props }: SwatchProps) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      data-composite="swatch"
      data-empty={color ? undefined : ''}
      className={cn('size-6 rounded-control border border-line p-0 hover:bg-transparent', className)}
      style={{ ...style, backgroundColor: color || 'transparent' }}
      {...props}
    />
  );
}

export { Swatch };
