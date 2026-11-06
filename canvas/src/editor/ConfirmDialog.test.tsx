import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

const baseProps = {
  open: true,
  onOpenChange: () => {},
  title: 'Delete map?',
  message: 'This will permanently delete "Dungeon". This cannot be undone.',
  confirmLabel: 'Delete',
  onConfirm: () => {},
}

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    render(<ConfirmDialog {...baseProps} />)
    expect(screen.getByText('Delete map?')).toBeDefined()
    expect(screen.getByText(/permanently delete "Dungeon"/)).toBeDefined()
  })

  it('confirms only on the confirm button, not cancel', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog {...baseProps} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    )

    fireEvent.click(screen.getByText('Cancel'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByText('Delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...baseProps} open={false} />)
    expect(screen.queryByText('Delete map?')).toBeNull()
  })
})
