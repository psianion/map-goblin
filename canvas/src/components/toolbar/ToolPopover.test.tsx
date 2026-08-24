import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ToolPopover } from './ToolPopover'

// B3: a click inside a portaled color picker (marked data-color-picker, see
// ColorField.tsx) must not be treated as "outside the popover" — it isn't a
// descendant of panelRef since it's portaled to document.body.
describe('ToolPopover outside-click', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('does not close on a pointerdown inside a [data-color-picker] element', () => {
    const onClose = vi.fn()
    render(<ToolPopover tool={'select' as never} anchorY={0} onClose={onClose} />)

    const picker = document.createElement('div')
    picker.setAttribute('data-color-picker', '')
    document.body.appendChild(picker)

    fireEvent.pointerDown(picker)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a pointerdown truly outside the popover', () => {
    const onClose = vi.fn()
    render(<ToolPopover tool={'select' as never} anchorY={0} onClose={onClose} />)

    fireEvent.pointerDown(document.body)

    expect(onClose).toHaveBeenCalledOnce()
  })
})
