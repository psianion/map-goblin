"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

import { toggleVariants } from "./toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
  orientation: "horizontal",
})

// Spacing 0 (the default) is the segmented control: one hairline box 24 tall, cells 22
// with 10px sides, the chosen cell panel-3 and no ring. Any other spacing, in px, is a
// row of toggles (2 between icon buttons).
function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ gap: spacing }}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch data-[spacing='0']:h-6 data-[spacing='0']:overflow-hidden data-[spacing='0']:rounded-control data-[spacing='0']:border data-[spacing='0']:border-line",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "shrink-0 focus:z-10 focus-visible:z-10",
        context.spacing === 0 &&
          "h-[22px] min-w-0 rounded-none border-0 border-r border-line px-2.5 last:border-r-0 hover:bg-panel-2 data-[pressed]:bg-panel-3 data-[pressed]:ring-0 focus-visible:outline-offset-[-2px]",
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
