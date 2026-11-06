import { test, expect } from '@playwright/test'
import { waitFrame } from './helpers'
import { box, dockColumns, expectFrameGeometry, expectSlot, openNext, pickFromFlyout, shot } from './nextShell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// Frame D (plan 5.4): Select with a floor picked. The floor card is the stub's until the
// Design family brings the real one (step 10).
test('frame D: a picked floor puts its card in the slot and its verbs beside it', async ({ page }) => {
  await openNext(page)
  await pickFromFlyout(page, 'Design', 'Floor')
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()

  const id = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      if (l.type !== 'dungeon') continue
      const shape = l.children.find((c: Any) => c.childType === 'shape' && c.visible !== false)
      if (shape) {
        st.setActiveLayerId(l.id)
        st.setSelectedIds([shape.id])
        return shape.id as string
      }
    }
    return null
  })
  expect(id).not.toBeNull()
  await waitFrame(page, 4)

  const card = page.getByTestId('shell-card')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-kind', 'shape')
  await expect(card.locator('[data-composite="panel-header"]')).toContainText('Selection / Floor')

  const verbs = card.locator('[data-composite="action-row"]').getByRole('button')
  await expect(verbs).toHaveCount(8)
  await expect(verbs.last()).toHaveAttribute('aria-label', 'Delete')
  await expect(verbs.last()).toHaveAttribute('data-danger', '')

  const captions = await card.locator('[data-section]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.section))
  expect(captions).toEqual(['', 'Look', 'Edge'])
  await expect(card.locator('[data-setting="card.floor.size"]')).toContainText('sq')

  // The floating bar carries the quick verbs (not flip V or hide), above the selection.
  const bar = page.getByTestId('shell-floating-actions')
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button')).toHaveCount(6)
  const slot = await box(page.getByTestId('shell-slot'))
  const barBox = await box(bar)
  expect(barBox.x).toBeGreaterThan(slot.x + slot.width)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'look'])
  await expectFrameGeometry(page)
  await expectSlot(page)
  await shot(page, '06-d')
})
