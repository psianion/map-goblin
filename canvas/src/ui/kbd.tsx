import { cn } from "@/lib/utils"

// Keycap: 18 tall and at least 18 wide, mono 10 in text-3 on panel-2. Inside an
// ink tooltip it goes clear with a faint on-ink edge.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[18px] w-fit min-w-[18px] items-center justify-center gap-1 rounded-key border border-line bg-panel-2 px-[5px] font-mono text-[10px] leading-none text-text-3 select-none [[data-slot=tooltip-content]_&]:border-on-ink/30 [[data-slot=tooltip-content]_&]:bg-transparent [[data-slot=tooltip-content]_&]:text-on-ink [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
