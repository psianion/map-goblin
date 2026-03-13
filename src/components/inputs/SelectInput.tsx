import { type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}

export function SelectInput({ value, onChange, options, className, ...props }: SelectInputProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full h-7 rounded-sm appearance-none cursor-pointer',
          'bg-transparent border border-border-default',
          'font-mono text-panel-small text-text-primary',
          'pl-2 pr-7',
          'focus:border-border-focus focus:outline-none',
          'transition-colors',
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-surface-1 text-text-primary">
            {opt.label}
          </option>
        ))}
      </select>
      {/* Custom chevron */}
      <svg
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-muted"
        width="10" height="6" viewBox="0 0 10 6" fill="none"
      >
        <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
