import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu, clampMenuPosition, type ContextMenuItem } from './context-menu'

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

  // D2: Delete Layer needs to render greyed out and inert when the layer is
  // locked, matching the disabled item's onSelect/onClose contract.
  it('a disabled item is inert — no onSelect, no onClose', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <ContextMenu
        pos={{ x: 0, y: 0 }}
        onClose={onClose}
        items={[{ label: 'Delete Layer', onSelect, disabled: true }]}
      />,
    )
    fireEvent.click(screen.getByText('Delete Layer'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  // D6: Escape is table-stakes keyboard support even before the full contract.
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={onClose} items={items} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  // K3: full keyboard contract — focus-on-open, arrow cycling (skipping
  // disabled), Home/End, Escape returning focus to the invoker, Tab closing.
  describe('keyboard contract (K3)', () => {
    it('moves focus to the first enabled item on open', () => {
      render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={() => {}} items={items} />)
      expect(document.activeElement).toBe(screen.getByText('Duplicate'))
    })

    it('skips a disabled item when focusing on open', () => {
      const withDisabled: ContextMenuItem[] = [
        { label: 'Rename', onSelect: vi.fn(), disabled: true },
        { label: 'Delete', onSelect: vi.fn() },
      ]
      render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={() => {}} items={withDisabled} />)
      expect(document.activeElement).toBe(screen.getByText('Delete'))
    })

    it('ArrowDown/ArrowUp cycle focus between items, wrapping at the ends', () => {
      render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={() => {}} items={items} />)
      fireEvent.keyDown(document, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByText('Delete'))
      fireEvent.keyDown(document, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByText('Duplicate'))
      fireEvent.keyDown(document, { key: 'ArrowUp' })
      expect(document.activeElement).toBe(screen.getByText('Delete'))
    })

    it('Home/End jump to the first/last item', () => {
      render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={() => {}} items={items} />)
      fireEvent.keyDown(document, { key: 'End' })
      expect(document.activeElement).toBe(screen.getByText('Delete'))
      fireEvent.keyDown(document, { key: 'Home' })
      expect(document.activeElement).toBe(screen.getByText('Duplicate'))
    })

    it('Escape closes and returns focus to the element that opened the menu', () => {
      const onClose = vi.fn()
      function Harness({ open }: { open: boolean }) {
        return (
          <div>
            <button type="button">Invoker</button>
            <ContextMenu pos={open ? { x: 0, y: 0 } : null} onClose={onClose} items={items} />
          </div>
        )
      }
      const { rerender } = render(<Harness open={false} />)
      const invoker = screen.getByText('Invoker')
      invoker.focus()
      rerender(<Harness open={true} />)
      expect(document.activeElement).toBe(screen.getByText('Duplicate'))

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(invoker)
    })

    it('Tab closes the menu', () => {
      const onClose = vi.fn()
      render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={onClose} items={items} />)
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('has aria-orientation="vertical"', () => {
      render(<ContextMenu pos={{ x: 0, y: 0 }} onClose={() => {}} items={items} />)
      expect(screen.getByRole('menu').getAttribute('aria-orientation')).toBe('vertical')
    })

    // H1: activation used to close the menu without restoring focus — only
    // Escape did. An item that doesn't itself move focus should still send
    // it back to whatever opened the menu.
    it('activating an item restores focus to the invoker, same as Escape', () => {
      const onClose = vi.fn()
      const onSelect = vi.fn()
      function Harness({ open }: { open: boolean }) {
        return (
          <div>
            <button type="button">Invoker</button>
            <ContextMenu
              pos={open ? { x: 0, y: 0 } : null}
              onClose={onClose}
              items={[{ label: 'Duplicate', onSelect }]}
            />
          </div>
        )
      }
      const { rerender } = render(<Harness open={false} />)
      const invoker = screen.getByText('Invoker')
      invoker.focus()
      rerender(<Harness open={true} />)

      fireEvent.click(screen.getByText('Duplicate'))
      expect(onSelect).toHaveBeenCalledOnce()
      expect(onClose).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(invoker)
    })
  })

  // L3: neither the mouse nor the keyboard opener clamped the menu's
  // position — it could render partly off-screen.
  describe('clampMenuPosition (L3)', () => {
    it('leaves an on-screen position untouched', () => {
      const result = clampMenuPosition({ x: 10, y: 20 }, { width: 160, height: 100 }, { width: 1024, height: 768 })
      expect(result).toEqual({ left: 10, top: 20 })
    })

    it('pulls the left edge in so the menu fits before the right viewport edge', () => {
      const result = clampMenuPosition({ x: 900, y: 20 }, { width: 200, height: 100 }, { width: 1024, height: 768 })
      expect(result.left).toBe(1024 - 200)
    })

    it('pulls the top edge in so the menu fits before the bottom viewport edge', () => {
      const result = clampMenuPosition({ x: 10, y: 700 }, { width: 160, height: 300 }, { width: 1024, height: 768 })
      expect(result.top).toBe(768 - 300)
    })

    it('never goes negative when the menu is bigger than the viewport', () => {
      const result = clampMenuPosition({ x: 0, y: 0 }, { width: 2000, height: 2000 }, { width: 1024, height: 768 })
      expect(result).toEqual({ left: 0, top: 0 })
    })
  })
})
