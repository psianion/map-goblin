import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from './collapsible-section'
import { Palette } from 'lucide-react'

describe('CollapsibleSection', () => {
  it('renders title and starts open when defaultOpen=true', () => {
    render(
      <CollapsibleSection id="test" title="Colors" icon={Palette} defaultOpen={true}>
        <div data-testid="content">inner</div>
      </CollapsibleSection>
    )
    expect(screen.getByText('COLORS')).toBeDefined()
    expect(screen.getByTestId('content')).toBeDefined()
  })

  it('hides content when defaultOpen=false', () => {
    render(
      <CollapsibleSection id="test" title="Colors" icon={Palette} defaultOpen={false}>
        <div data-testid="content">inner</div>
      </CollapsibleSection>
    )
    expect(screen.getByText('COLORS')).toBeDefined()
    expect(screen.queryByTestId('content')).toBeNull()
  })

  it('toggles content on header click', () => {
    render(
      <CollapsibleSection id="test" title="Colors" icon={Palette} defaultOpen={false}>
        <div data-testid="content">inner</div>
      </CollapsibleSection>
    )
    expect(screen.queryByTestId('content')).toBeNull()
    fireEvent.click(screen.getByText('COLORS'))
    expect(screen.getByTestId('content')).toBeDefined()
  })

  it('shows preview when collapsed', () => {
    render(
      <CollapsibleSection id="test" title="Colors" icon={Palette} defaultOpen={false}
        preview={<span data-testid="preview">preview</span>}>
        <div>inner</div>
      </CollapsibleSection>
    )
    expect(screen.getByTestId('preview')).toBeDefined()
  })

  it('has aria-expanded on header', () => {
    render(
      <CollapsibleSection id="test" title="Colors" icon={Palette} defaultOpen={true}>
        <div>inner</div>
      </CollapsibleSection>
    )
    const header = screen.getByRole('button')
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('accepts external open state via isOpen/onToggle', () => {
    const onToggle = vi.fn()
    render(
      <CollapsibleSection id="test" title="Colors" icon={Palette} isOpen={false} onToggle={onToggle}>
        <div data-testid="content">inner</div>
      </CollapsibleSection>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledWith('test')
  })
})
