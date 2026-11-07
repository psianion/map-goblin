import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitFrame } from './helpers'
import { dockColumns, expectFrameGeometry, expectSlot, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const store = <T,>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn)

/** The kinds in the pick, sorted. */
const pickedKinds = (page: Page) =>
  store<string[]>(
    page,
    `(s) => {
      const kinds = new Set()
      for (const id of s.selection.selectedIds) {
        for (const l of s.layers) {
          if (l.type !== 'dungeon') continue
          const c = l.children.find((x) => x.id === id)
          if (c) kinds.add(c.childType)
          if ((l.standaloneWalls ?? []).some((w) => w.id === id)) kinds.add('wall')
        }
      }
      return [...kinds].sort()
    }`,
  )

/** Where each picked child sits, by id. */
const positions = (page: Page) =>
  store<Record<string, unknown>>(
    page,
    `(s) => {
      const out = {}
      for (const l of s.layers) {
        if (l.type !== 'dungeon') continue
        for (const c of l.children) if (s.selection.selectedIds.includes(c.id)) out[c.id] = JSON.stringify(c.position ?? c.transform ?? null)
      }
      return out
    }`,
  )

/** A box drawn from empty canvas above the map to past its far corner. */
async function boxSelect(page: Page) {
  const from = { x: 360, y: 84 }
  const to = { x: 1180, y: 800 }
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 8; i++) {
    await firePointer(page, 'pointermove', from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8, 0.5, 1)
  }
  await firePointer(page, 'pointerup', to.x, to.y)
  await waitFrame(page, 4)
}

// Frame C (plan 5.3) and the Select family (6.6): Select's panel, Pick only filtering a
// box select, the Mixed card for a pick of several kinds, an arrange verb undone, and
// Previous tool back to the family tool.
test('frame C: Select picks only what its chips allow, mixes kinds, and goes back', { tag: '@shell' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  await pickFromFlyout(page, 'Design', 'Floor')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Shape', 'Edit', 'look'])

  const rail = page.getByTestId('shell-rail')
  await rail.getByRole('button', { name: 'Select' }).click()
  await expect(rail.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rail.getByRole('button', { name: 'Design' })).not.toHaveAttribute('aria-pressed', 'true')

  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel).toHaveAttribute('data-tool', 'select')
  await expect(panel.locator('[data-composite="panel-header"]')).toContainText('Select')
  await expect(panel.getByRole('button', { name: 'Back to Floor' })).toBeVisible()
  const chips = panel.getByRole('group', { name: 'Pick only' }).getByRole('button')
  await expect(chips).toHaveText(['All', 'Floors', 'Walls', 'Doors', 'Props', 'Lights', 'Labels', 'Zones'])
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('select-howto')).toContainText('drag a box')
  await expect(page.getByTestId('select-previous')).toContainText('Previous tool')
  // Setup only: nothing to reset, no preset.
  await expect(panel.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0)

  // The dock keeps the last family's Look column and drops Shape and Edit.
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'look'])
  await expect(page.getByTestId('shell-status-hint')).toHaveText('Nothing picked')
  await expectFrameGeometry(page)
  await expectSlot(page)
  await shot(page, '07-c')

  // Pick only Props: a box over the whole map grabs props and nothing else.
  await chips.filter({ hasText: 'Props' }).click()
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('shell-status-hint')).toContainText('a box picks props')
  await boxSelect(page)
  expect(await pickedKinds(page)).toEqual(['asset'])

  // Props and Lights: a pick of two kinds gets the Mixed card.
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
  await store(page, `(s) => s.setSelectedIds([])`)
  await waitFrame(page, 2)
  await page.getByTestId('shell-tool-panel').getByRole('group', { name: 'Pick only' }).getByRole('button', { name: 'Lights' }).click()
  await boxSelect(page)
  expect(await pickedKinds(page)).toEqual(['asset', 'light'])
  const card = page.getByTestId('shell-card')
  await expect(card).toHaveAttribute('data-kind', 'mixed')
  await expect(card.locator('[data-composite="panel-header"]')).toContainText('Selection /')
  await expect(page.getByTestId('mixed-kinds')).toContainText('Props')
  await expect(page.getByTestId('mixed-kinds')).toContainText('Lights')
  await expect(card.getByRole('group', { name: 'Align' })).toBeVisible()
  await expect(card.getByRole('group', { name: 'Order' }).getByRole('button')).toHaveCount(4)
  const verbs = card.locator('[data-composite="action-row"]').getByRole('button')
  await expect(verbs.last()).toHaveAttribute('aria-label', 'Delete')
  await expect(page.getByTestId('shell-floating-actions')).toHaveCount(0)
  await shot(page, '07-mixed')

  // An arrange verb moves them; Undo puts them back.
  const before = await positions(page)
  await card.getByRole('button', { name: 'Align left' }).click()
  await waitFrame(page, 2)
  expect(await positions(page)).not.toEqual(before)
  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await waitFrame(page, 2)
  expect(await positions(page)).toEqual(before)

  // Select only narrows the pick to one kind.
  await page.getByTestId('mixed-kinds').getByRole('button', { name: 'Select only' }).first().click()
  await waitFrame(page, 2)
  expect((await pickedKinds(page)).length).toBe(1)

  // Previous tool goes back to Floor, and the dock brings its drawing columns back.
  await store(page, `(s) => s.setSelectedIds([])`)
  await waitFrame(page, 2)
  await page.getByTestId('select-previous').click()
  expect(await store<string>(page, `(s) => s.tools.activeTool`)).toMatch(/^(rectangle|polygon|regularPolygon)$/)
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Shape', 'Edit', 'look'])
  expect(errors).toEqual([])
})
