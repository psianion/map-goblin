import { type KeyboardEvent } from 'react'

interface ToggleSwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}

export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(!checked)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      onKeyDown={handleKeyDown}
      className={`
        relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer
        rounded-full border border-border-default
        transition-colors duration-150 ease-in-out
        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus
        ${checked ? 'bg-text-primary' : 'bg-surface-3'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-[14px] w-[14px]
          rounded-full transition-transform duration-150 ease-in-out
          translate-y-[1px]
          ${checked
            ? 'translate-x-[15px] bg-surface-0'
            : 'translate-x-[1px] bg-text-muted'
          }
        `}
      />
    </button>
  )
}
