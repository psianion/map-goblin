import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu, type ContextMenuItem } from './context-menu'

describe('ContextMenu', () => {
  const items: ContextMenuItem[] = [
    { label: 'Duplicate', onSelect: vi.fn() },
    { label: 'Delete', onSelect: vi.fn(), danger: true, separatorBefore: true },
  ]

  it('renders nothing when pos is null', () => {
    render(<ContextMenu pos={null} onClose={() => {}} items={items} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders items at the given position', () => {
    render(<ContextMenu pos={{ x: 10, y: 20 }} onClose={() => {}} items={items} />)
    expect(screen.getByRole('menu')).toBeDefined()
    expect(screen.getByText('Duplicate')).toBeDefined()
    expect(screen.getByText('Delete')).toBeDefined()
  })

  it('calls onSelect then onClose when an item is clicked', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <ContextMenu
        pos={{ x: 0, y: 0 }}
        onClose={onClose}
        items={[{ label: 'Duplicate', onSelect }]}
      />,
    )
    fireEvent.click(screen.getByText('Duplicate'))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
