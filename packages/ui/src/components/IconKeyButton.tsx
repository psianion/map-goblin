import type { LucideIcon } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { Button } from '../primitives/button';
import { cn } from '../lib/utils';

export type IconKeySize = 26 | 28 | 32 | 36;
export type IconPx = 14 | 16 | 18;

// Rail 36 with an 18 icon, dock 32 with 14, bar 28 with 16, row 26 with 14.
const ICON_PX: Record<IconKeySize, IconPx> = { 26: 14, 28: 16, 32: 14, 36: 18 };
const ICON_CLASS: Record<IconPx, string> = { 14: 'size-3.5', 16: 'size-4', 18: 'size-[18px]' };

// The box. Hover fills panel-3; active is the 1.5px inset ink ring with no fill, so both
// can show at once. Focus (2px outline, offset 1) and disabled (38%) come from Button.
const iconKeyBoxVariants = cva(
  'group/ikb relative inline-flex shrink-0 items-center justify-center border-0 p-0 text-text-2',
  {
    variants: {
      size: {
        '26': 'size-[26px] rounded-control',
        '28': 'size-7 rounded-control',
        '32': 'size-8 rounded-control',
        '36': 'size-9 rounded-float',
      },
    },
    defaultVariants: { size: '28' },
  },
);

// The key letter owns the bottom right corner; offsets and sizes are the page's, per size.
const keyVariants = cva(
  'pointer-events-none absolute font-mono font-normal leading-none text-text-3 group-data-[active]/ikb:text-text-2',
  {
    variants: {
      size: {
        '26': 'right-[3px] bottom-[2px] text-[8px]',
        '28': 'right-[3px] bottom-[2px] text-[8px]',
        '32': 'right-1 bottom-[3px] text-[8px]',
        '36': 'right-[5px] bottom-1 text-[9px]',
      },
    },
  },
);

// With a key the icon moves up and left so the letter has room; without one it stays centred.
const SHIFT: Record<IconKeySize, string> = {
  26: '-translate-x-[1.5px] -translate-y-[1.5px]',
  28: '-translate-x-[1.5px] -translate-y-[1.5px]',
  32: '-translate-x-[1.5px] -translate-y-[1.5px]',
  36: '-translate-x-[2px] -translate-y-[2px]',
};

type GlyphProps = {
  icon: LucideIcon;
  size: IconKeySize;
  shortcut?: string;
  iconSize?: IconPx;
};

/** The icon and its key without the button. FlyoutRow puts it inside its own row button. */
function IconKeyGlyph({ icon: Icon, size, shortcut, iconSize }: GlyphProps) {
  return (
    <>
      <Icon
        aria-hidden
        data-slot="icon-key-icon"
        strokeWidth={1.75}
        className={cn('pointer-events-none shrink-0', ICON_CLASS[iconSize ?? ICON_PX[size]], shortcut && SHIFT[size])}
      />
      {shortcut ? (
        <span aria-hidden data-slot="icon-key-key" className={keyVariants({ size: `${size}` })}>
          {shortcut}
        </span>
      ) : null}
    </>
  );
}

type IconKeyButtonProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'size' | 'variant'> & {
  icon: LucideIcon;
  /** Accessible name; the visible tooltip belongs to the surface. */
  label: string;
  size?: IconKeySize;
  shortcut?: string;
  active?: boolean;
  danger?: boolean;
  /** Only for the places the page breaks the size rule: the flyout's 32 with 16, help's 28 with 14. */
  iconSize?: IconPx;
};

function IconKeyButton({
  icon,
  label,
  size = 28,
  shortcut,
  active,
  danger,
  iconSize,
  className,
  ...props
}: IconKeyButtonProps) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      aria-pressed={active}
      data-active={active ? '' : undefined}
      data-danger={danger ? '' : undefined}
      data-composite="icon-key-button"
      className={cn(
        iconKeyBoxVariants({ size: `${size}` }),
        'hover:bg-panel-3 hover:text-text data-[active]:text-text data-[active]:ring-[1.5px] data-[active]:ring-inset data-[active]:ring-ink',
        danger && 'text-danger hover:text-danger data-[active]:text-danger',
        className,
      )}
      {...props}
    >
      <IconKeyGlyph icon={icon} size={size} shortcut={shortcut} iconSize={iconSize} />
    </Button>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { IconKeyButton, IconKeyGlyph, iconKeyBoxVariants };
