import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "../lib/utils"

// 24 tall, 8 aside, hairline; numbers set in mono, the placeholder in sans. Focus is
// the 2px outline plus a line-strong edge.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-6 w-full min-w-[72px] rounded-control border border-line bg-panel px-2 text-[11px] leading-none text-text tabular-nums transition-colors outline-none placeholder:font-sans placeholder:text-text-3 focus-visible:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.38] aria-[invalid=true]:border-danger [&[type=number]]:font-mono [&[inputmode=decimal]]:font-mono [&[inputmode=numeric]]:font-mono",
        className
      )}
      {...props}
    />
  )
}

export { Input }
