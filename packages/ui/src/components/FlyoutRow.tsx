import type { LucideIcon } from 'lucide-react';
import { Button } from '../primitives/button';
import { cn } from '../lib/utils';
import { IconKeyGlyph, iconKeyBoxVariants } from './IconKeyButton';

type FlyoutRowProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'children'> & {
  icon: LucideIcon;
  shortcut?: string;
  name: string;
  description: string;
  active?: boolean;
};

/** 44 tall: the 32 icon with its key, 12 apart from the name 13/500 over an 11 one-line description. */
function FlyoutRow({ icon, shortcut, name, description, active, className, ...props }: FlyoutRowProps) {
  return (
    <Button
      variant="ghost"
      data-composite="flyout-row"
      data-active={active ? '' : undefined}
      className={cn(
        'grid h-11 w-full grid-cols-[32px_1fr] items-center gap-3 rounded-control border-0 px-2 text-left leading-[1.25] whitespace-normal text-text hover:bg-panel-2 hover:text-text data-[active]:bg-panel-2',
        className,
      )}
      {...props}
    >
      {/* The page draws the flyout's 32 with a 16 icon, not the dock's 14. */}
      <span className={iconKeyBoxVariants({ size: '32' })}>
        <IconKeyGlyph icon={icon} size={32} shortcut={shortcut} iconSize={16} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium">{name}</span>
        <span className="truncate text-[11px] text-text-3">{description}</span>
      </span>
    </Button>
  );
}

export { FlyoutRow };
