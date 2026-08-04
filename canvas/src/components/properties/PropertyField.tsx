import { useId, type ReactNode } from 'react'

interface PropertyFieldProps {
  label: ReactNode
  children: ReactNode
}

// Children are whatever control the caller passes — SliderInput, ColorField,
// a native <select>, ToggleSwitch — none sharing an `id`/`htmlFor`-friendly
// API, so a real <label htmlFor> per field isn't practical here without
// reworking every one of them. `role="group"` + `aria-labelledby` gets the
// same "announce the label with the control" result without that.
export function PropertyField({ label, children }: PropertyFieldProps) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-1" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="font-mono text-panel-label uppercase text-text-muted">{label}</span>
      {children}
    </div>
  )
}
