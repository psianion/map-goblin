import type { ReactNode } from 'react'

interface PropertyFieldProps {
  label: ReactNode
  children: ReactNode
}

export function PropertyField({ label, children }: PropertyFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-panel-label uppercase text-text-muted">{label}</span>
      {children}
    </div>
  )
}
