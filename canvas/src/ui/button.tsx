import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Primary (default) is the ink-filled 28 button, one per surface; outline is the
// hairline secondary at 24. Focus is the 2px outline in the focus token, offset 1.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border border-transparent leading-none whitespace-nowrap transition-colors outline-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-[0.38] aria-[invalid=true]:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-ink font-medium text-on-ink hover:bg-ink-hover",
        outline:
          "border-line bg-transparent text-text-2 hover:bg-panel-2 hover:text-text aria-expanded:bg-panel-2 aria-expanded:text-text aria-pressed:border-transparent aria-pressed:text-text aria-pressed:ring-[1.5px] aria-pressed:ring-inset aria-pressed:ring-ink",
        secondary:
          "bg-panel-2 text-text hover:bg-panel-3 aria-expanded:bg-panel-3",
        ghost:
          "bg-transparent text-text-2 hover:bg-panel-3 hover:text-text aria-expanded:bg-panel-3 aria-expanded:text-text",
        destructive:
          "border-line bg-transparent text-danger hover:bg-panel-2",
        link: "text-text underline-offset-2 hover:underline",
      },
      size: {
        default: "h-7 px-3.5 text-[12px]",
        xs: "h-[22px] gap-1 px-2 text-[11px]",
        sm: "h-6 px-2.5 text-[11px]",
        lg: "h-8 px-4 text-[12px]",
        icon: "size-8",
        "icon-xs": "size-[26px]",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-9 rounded-float [&_svg:not([class*='size-'])]:size-[18px]",
      },
    },
    compoundVariants: [
      // The secondary beside a primary in a dialog's action row: 28 tall, 12 aside.
      { variant: "outline", size: "default", className: "px-3" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
