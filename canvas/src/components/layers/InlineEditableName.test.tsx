import { useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineEditableName } from './InlineEditableName'

// F10 (NIT-11): if the underlying value changes while editing (e.g. an undo
// fires), the draft used to go stale — it was only ever reseeded on the
// false→true edit-mode transition.
describe('InlineEditableName', () => {
  it('resyncs the draft input when the external value changes mid-edit', () => {
    const { rerender } = render(
      <InlineEditableName
        value="Layer 1"
        editing={true}
        onStartEdit={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Layer 1')

    // Simulate an undo landing while the rename input is still open.
    rerender(
      <InlineEditableName
        value="Layer 0 (undone)"
        editing={true}
        onStartEdit={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(input.value).toBe('Layer 0 (undone)')
  })

  it('does not clobber the user\'s own in-progress typing on an unrelated rerender', () => {
    const onCommit = vi.fn()
    const { rerender } = render(
      <InlineEditableName
        value="Layer 1"
        editing={true}
        onStartEdit={() => {}}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Layer 1 renamed' } })

    // A rerender with the SAME external value (e.g. an unrelated store
    // update) must not touch the draft the user is typing.
    rerender(
      <InlineEditableName
        value="Layer 1"
        editing={true}
        onStartEdit={() => {}}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    )
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Layer 1 renamed')
  })
})

// H1: focus used to drop to <body> once Escape/Enter unmounted the input —
// restoreFocusRef gives the caller a way to hand focus back to the row.
describe('InlineEditableName — focus restore on exit (H1)', () => {
  function Harness({ editing, onCancel }: { editing: boolean; onCancel: () => void }) {
    const rowRef = useRef<HTMLDivElement>(null)
    return (
      <div ref={rowRef} tabIndex={-1} data-testid="row">
        <InlineEditableName
          value="Layer 1"
          editing={editing}
          onStartEdit={() => {}}
          onCommit={() => {}}
          onCancel={onCancel}
          restoreFocusRef={rowRef}
        />
      </div>
    )
  }

  it('restores focus to the row after Escape cancels', () => {
    let editing = true
    const onCancel = vi.fn(() => { editing = false })
    const { rerender } = render(<Harness editing={editing} onCancel={onCancel} />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    rerender(<Harness editing={editing} onCancel={onCancel} />)

    expect(document.activeElement).toBe(screen.getByTestId('row'))
  })

  it('does not force focus onto the row on a plain blur (click/tab away, not Enter/Escape)', () => {
    let editing = true
    const onCancel = vi.fn(() => { editing = false })
    const { rerender } = render(<Harness editing={editing} onCancel={onCancel} />)

    fireEvent.blur(screen.getByRole('textbox'))
    editing = false
    rerender(<Harness editing={editing} onCancel={onCancel} />)

    expect(document.activeElement).not.toBe(screen.getByTestId('row'))
  })
})
