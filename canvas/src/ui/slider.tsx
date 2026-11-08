import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

// Track 2 in line-strong, a 12px thumb on panel with a 1.5px ink ring. Only a range (two
// thumbs) shows the span between them in ink; a single thumb has no fill. The ring is an inset shadow: Chromium snaps a 1.5px border to 1px.
// The value readout lives in the row composite, not here.
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-[orientation=horizontal]:h-3.5 data-[disabled]:opacity-[0.38] data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-3.5 data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow rounded-[1px] bg-line-strong select-none data-[orientation=horizontal]:h-0.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-0.5"
        >
          {_values.length > 1 ? (
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              className="rounded-[1px] bg-ink select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            />
          ) : null}
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-3 shrink-0 rounded-full bg-panel ring-[1.5px] ring-inset ring-ink select-none after:absolute after:-inset-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus disabled:pointer-events-none"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
