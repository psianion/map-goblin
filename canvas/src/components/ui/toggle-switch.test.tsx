import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToggleSwitch } from './toggle-switch'

describe('ToggleSwitch', () => {
  it('renders with role="switch" and aria-checked', () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} />)
    const sw = screen.getByRole('switch')
    expect(sw).toBeDefined()
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('calls onChange with toggled value on click', () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reflects checked=true in aria-checked', () => {
    render(<ToggleSwitch checked={true} onChange={() => {}} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})
