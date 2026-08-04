import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  // K4: a manual onKeyDown handler used to call onChange directly on
  // Space/Enter alongside the native <button>'s own activation, which fires
  // its own click for both keys — double-firing the change. userEvent (not
  // fireEvent, which doesn't simulate native key-activates-click behavior)
  // is what actually exercises that native path.
  it('Space activates the native button exactly once, not twice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} />)
    screen.getByRole('switch').focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('Enter activates the native button exactly once, not twice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} />)
    screen.getByRole('switch').focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
