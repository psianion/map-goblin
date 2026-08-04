import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SliderInput } from './SliderInput'

// F4 (MEDIUM-5): opacity commit precision + keyboard undo.
describe('SliderInput', () => {
  it('commits the raw pre-drag value via rawValue, not the rounded `value` round-tripped', () => {
    const onChangeCommit = vi.fn()
    render(
      <SliderInput
        value={43}
        rawValue={42.51}
        min={0}
        max={100}
        step={1}
        onChange={() => {}}
        onChangeCommit={onChangeCommit}
      />,
    )
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '60' } })
    fireEvent.pointerUp(slider, { target: { value: '60' } })
    expect(onChangeCommit).toHaveBeenCalledWith(60, 42.51)
  })

  it('commits once on blur after a keyboard-only change (no pointer interaction)', () => {
    const onChangeCommit = vi.fn()
    render(<SliderInput value={5} min={0} max={10} step={1} onChange={() => {}} onChangeCommit={onChangeCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.focus(slider)
    fireEvent.change(slider, { target: { value: '6' } })
    fireEvent.change(slider, { target: { value: '7' } })
    expect(onChangeCommit).not.toHaveBeenCalled() // live preview only, not committed yet
    fireEvent.blur(slider, { target: { value: '7' } })
    expect(onChangeCommit).toHaveBeenCalledTimes(1)
    expect(onChangeCommit).toHaveBeenCalledWith(7, 5)
  })

  it('does not double-commit on blur right after a pointer drag committed the same value', () => {
    const onChangeCommit = vi.fn()
    render(<SliderInput value={5} min={0} max={10} step={1} onChange={() => {}} onChangeCommit={onChangeCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '8' } })
    fireEvent.pointerUp(slider, { target: { value: '8' } })
    expect(onChangeCommit).toHaveBeenCalledTimes(1)

    fireEvent.blur(slider, { target: { value: '8' } })
    expect(onChangeCommit).toHaveBeenCalledTimes(1) // unchanged since the drag's commit — no second entry
  })

  it('does not commit on blur when the value never changed', () => {
    const onChangeCommit = vi.fn()
    render(<SliderInput value={5} min={0} max={10} step={1} onChange={() => {}} onChangeCommit={onChangeCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.focus(slider)
    fireEvent.blur(slider, { target: { value: '5' } })
    expect(onChangeCommit).not.toHaveBeenCalled()
  })
})
