import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EnvironmentSection } from './EnvironmentSection'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { composeGrade, NOON, timeColorAt, type MapEnvironment } from '@/store/types'
import { ribbonOffset } from '@/lib/dayRibbon'

/** The section renders collapsed by default; every test wants it open. */
function renderOpen(env: Partial<MapEnvironment> = {}) {
  useStore.getState().setEnvironmentSettings(env)
  return render(
    <EnvironmentSection openSections={new Set(['environment'])} onToggleSection={() => {}} />,
  )
}

const gradients = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>('[style*="linear-gradient"]')].map(
    (el) => el.style.background,
  )

/** jsdom serializes inline colours as `rgb(r, g, b)`, so the expectations meet it there. */
const asRgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

const scrub = (): HTMLInputElement =>
  screen.getByLabelText(/Preview clock|Fixed time/) as HTMLInputElement

describe('EnvironmentSection', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
    useStore.getState().setPreviewClock(null)
  })

  it('paints both ribbons from the engine helpers, never from its own gradient maths', () => {
    const { container } = renderOpen({ environment: 'outdoor', timePalette: { preset: 'snow' } })
    const map = useStore.getState().mapSettings

    const painted = gradients(container).join(' ')
    expect(painted).toContain(asRgb(timeColorAt(map.timePalette, NOON)))
    expect(painted).toContain(asRgb(composeGrade(map, NOON)))
  })

  it('authors the environment type as one undoable command', () => {
    renderOpen({ environment: 'outdoor' })

    fireEvent.click(screen.getByRole('radio', { name: 'Indoor' }))
    expect(useStore.getState().mapSettings.environment).toBe('indoor')

    undoManager.undo()
    expect(useStore.getState().mapSettings.environment).toBe('outdoor')
  })

  it('scrubbing previews locally — it never writes map state', () => {
    renderOpen({ environment: 'outdoor' })

    fireEvent.change(scrub(), { target: { value: String(ribbonOffset(300)) } })

    expect(useStore.getState().ui.previewClock).toBe(300)
    expect(useStore.getState().mapSettings.fixedTime).toBeUndefined()
    expect(undoManager.canUndo()).toBe(false)
    expect(screen.getByText('05:00')).toBeTruthy()
  })

  it('fixed mode pins the map at the time on screen and the scrub becomes the picker', () => {
    renderOpen({ environment: 'outdoor' })
    fireEvent.change(scrub(), { target: { value: String(ribbonOffset(1080)) } })

    fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }))
    expect(useStore.getState().mapSettings).toMatchObject({ timeMode: 'fixed', fixedTime: 1080 })
    expect(screen.getByText('Fixed time')).toBeTruthy()

    // Drag previews live, release commits — one undo entry, and the preview clock hands the
    // map back its own time rather than staying parked on top of it.
    const input = scrub()
    fireEvent.change(input, { target: { value: String(ribbonOffset(420)) } })
    fireEvent.blur(input)
    expect(useStore.getState().mapSettings.fixedTime).toBe(420)
    expect(useStore.getState().ui.previewClock).toBeNull()

    undoManager.undo()
    expect(useStore.getState().mapSettings.fixedTime).toBe(1080)
  })

  it('indoor: natural light says why it is off, and keeps the authored orientation', () => {
    renderOpen({ environment: 'indoor', orientation: 45 })

    expect(screen.getByText(/no sky to cast from/i)).toBeTruthy()
    expect(screen.getByText('E 45°')).toBeTruthy()
    expect(screen.getByText(/No auto-gate/)).toBeTruthy()
    // Still on the clock, just damped — the hour is applicable indoors.
    expect(screen.getByLabelText('Preview clock')).toBeTruthy()
  })

  it('underground: the clock is inapplicable with a reason, and the applied strip goes flat', () => {
    useStore.getState().setAmbientLight('#2d2d44')
    const { container } = renderOpen({ environment: 'underground' })

    expect(screen.getByText(/torchlit crypt looks the same at noon/i)).toBeTruthy()
    expect(screen.getByText(/no hour to pin underground/i)).toBeTruthy()
    expect(screen.queryByLabelText(/keyframe,/)).toBeNull()
    expect(screen.queryByLabelText('Preview clock')).toBeNull()

    // Damping 0 means every hour composes to the mood tint: one colour, all day.
    const applied = gradients(container).find((g) => g.includes(asRgb('#2d2d44')))!
    expect(new Set(applied.match(/rgb\([^)]+\)/g)).size).toBe(1)
  })

  it('recolouring a keyframe is one undo entry and can be reset to the preset', () => {
    renderOpen({
      environment: 'outdoor',
      timePalette: { preset: 'temperate', keyframes: { dawn: '#ff0000' } },
    })

    // The swatch on the ribbon is the handle: selecting it points the picker (and the reset)
    // at that hour of the day.
    fireEvent.click(screen.getByLabelText('Dawn keyframe, #FF0000'))
    expect(screen.getByText('Dawn key')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Reset dawn keyframe'))
    expect(useStore.getState().mapSettings.timePalette?.keyframes?.dawn).toBeUndefined()

    undoManager.undo()
    expect(useStore.getState().mapSettings.timePalette?.keyframes?.dawn).toBe('#ff0000')
  })
})
