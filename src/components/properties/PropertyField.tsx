import type { ReactNode } from 'react'

interface PropertyFieldProps {
  label: string
  children: ReactNode
}

export function PropertyField({ label, children }: PropertyFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-panel-small text-text-secondary">{label}</span>
      {children}
    </div>
  )
}
