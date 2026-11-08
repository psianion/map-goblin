"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

// Default is the segmented look (hairline box, chosen tab panel-3); line is the dock's
// text tabs (text-2 at rest, text with a 1.5px ink underline when chosen).
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center text-text-2 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "h-6 overflow-hidden rounded-control border border-line",
        line: "h-7 gap-4 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full items-center justify-center gap-1.5 leading-none whitespace-nowrap text-text-2 transition-colors outline-none hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-[0.38] data-[active]:text-text group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        "group-data-[variant=default]/tabs-list:border-r group-data-[variant=default]/tabs-list:border-line group-data-[variant=default]/tabs-list:px-2.5 group-data-[variant=default]/tabs-list:text-[11px] group-data-[variant=default]/tabs-list:last:border-r-0 group-data-[variant=default]/tabs-list:hover:bg-panel-2 group-data-[variant=default]/tabs-list:data-[active]:bg-panel-3",
        "group-data-[variant=line]/tabs-list:text-[12px] after:absolute after:inset-x-0 after:bottom-0 after:h-[1.5px] after:bg-ink after:opacity-0 after:transition-opacity group-data-[variant=line]/tabs-list:data-[active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-[12px] outline-none", className)}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
