import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

// An icon button that stays on: hover fills panel-3, on is a 1.5px inset ink ring
// with no fill, the icon never moves between states.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1.5 rounded-control text-[11px] leading-none whitespace-nowrap text-text-2 transition-colors outline-none hover:bg-panel-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-[0.38] data-[pressed]:text-text data-[pressed]:ring-[1.5px] data-[pressed]:ring-inset data-[pressed]:ring-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-line bg-transparent data-[pressed]:border-transparent",
      },
      size: {
        default: "h-7 min-w-7 px-1.5",
        sm: "h-[26px] min-w-[26px] px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 min-w-8 px-2 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Toggle, toggleVariants }
