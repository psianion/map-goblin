"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

// 28 by 16: track line-strong off and ink on, a 12px knob that is always white.
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-pill bg-line-strong p-0.5 transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus data-[size=default]:h-4 data-[size=default]:w-7 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[checked]:bg-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white transition-transform group-data-[size=default]/switch:size-3 group-data-[size=sm]/switch:size-2.5 group-data-[size=default]/switch:data-[checked]:translate-x-3 group-data-[size=sm]/switch:data-[checked]:translate-x-2.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
