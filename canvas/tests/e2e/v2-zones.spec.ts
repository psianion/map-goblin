import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { waitForBoot, waitFrame } from './helpers'

/**
 * Zones in /v2, end to end, on a copy of the goblin warren: the card's More… opens the v2
 * zone sheet (no legacy styling inside), a rename there, a trigger with Within radius and
 * its Radius, Enabled shown once, a Show text action, a note with an image, the prompt save
 * of prep edits surviving a reload, the orphaned-trigger warning on Delete, and the card's
 * X / Y fields.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

/** A 1×1 PNG, enough for the note image import. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const store = (page: Page, fn: string, arg?: unknown) =>
  page.evaluate(
    ({ fn, arg }) => new Function('s', 'arg', `return (${fn})(s, arg)`)(() => (window as Any).__store.getState(), arg),
    { fn, arg },
  )

/** Into /v2 on a copy of the warren, saved, with a circle zone selected on the active layer. */
async function openWithZone(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.evaluate(async (data) => {
    ;(window as Any).__store.getState().loadFromFile(structuredClone(data))
    // A fresh read: the state held before the load still lists the blank map's layers.
    const st = (window as Any).__store.getState()
    st.setRoomsSheetOpen(false)
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.setActiveTool('select')
    st.addChild(l.id, {
      id: 'zq', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 3, y: 3 }, radius: 2 },
    })
    await (window as Any).__store.getState().saveCurrentMap()
    ;(window as Any).__store.getState().setSelectedIds(['zq'])
  }, WARREN)
  await waitFrame(page, 3)
  await expect(page.getByTestId('v2-selection-card')).toBeVisible()
}

const zone = (page: Page) =>
  store(page, `(s) => s().layers.flatMap((l) => l.children ?? []).find((c) => c.id === 'zq') ?? null`) as Promise<Any>
const prep = (page: Page) => store(page, `(s) => s().prep ?? { triggers: [], notes: [] }`) as Promise<Any>

async function openSheet(page: Page) {
  await page.getByTestId('v2-selection-card').getByRole('button', { name: 'More…' }).click()
  const sheet = page.getByTestId('v2-zone-sheet')
  await expect(sheet).toBeVisible()
  return sheet
}

/** Types into a field and lets it go, the way a blur commits. */
async function fill(field: ReturnType<Page['getByLabel']>, value: string) {
  await field.fill(value)
  await field.press('Enter')
}

test('More… opens the v2 zone sheet, with no legacy styling anywhere inside', async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await expect(sheet.getByTestId('v2-zone-sheet-body')).toBeVisible()
  expect(await sheet.locator('.v2-legacy').count()).toBe(0)
  await expect(sheet.getByTestId('v2-zone-shape')).toContainText('Circle')
  await expect(sheet.getByRole('switch', { name: 'Blocks auto-explore' })).toBeVisible()
})

test('a rename in the sheet names the zone and the card follows', async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await fill(sheet.getByLabel('Zone name'), 'Wolf den')
  await expect.poll(async () => (await zone(page)).name).toBe('Wolf den')
  await expect(page.getByTestId('v2-selection-card').getByLabel('Zone name')).toHaveValue('Wolf den')
})

test('a trigger: Within radius shows Radius, Enabled appears once', async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  const trig = sheet.getByRole('group', { name: 'Trigger 1' })
  await expect(trig.getByRole('switch', { name: 'Enabled' })).toHaveCount(1)
  await expect(trig.getByText('Enabled', { exact: true })).toHaveCount(0)
  await expect(trig.getByLabel('Trigger radius')).toHaveCount(0)
  await trig.getByLabel('Condition').selectOption('within-radius')
  await fill(trig.getByLabel('Trigger radius'), '12.5')
  await expect.poll(async () => (await zone(page)).shape.radius).toBe(12.5)
  expect((await prep(page)).triggers[0].when).toEqual({ kind: 'within-radius', zoneId: 'zq' })
  // Four characters show whole: nothing of "12.5" is clipped.
  const field = trig.getByLabel('Trigger radius')
  await expect(field).toHaveValue('12.5')
  const fit = await field.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(fit.scroll).toBeLessThanOrEqual(fit.client)
})

test('the card’s Delete stays clickable with the Zone sheet open', async ({ page }) => {
  await openWithZone(page)
  await openSheet(page)
  await page.getByTestId('v2-sel-act-delete').click()
  await expect.poll(async () => await zone(page)).toBeNull()
})

test('a Show text action is added and its text written', async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  const trig = sheet.getByRole('group', { name: 'Trigger 1' })
  await trig.getByRole('button', { name: 'Add action' }).click()
  await trig.getByLabel('Text').fill('The wolves wake.')
  await trig.getByLabel('Trigger name').click()
  await expect.poll(async () => (await prep(page)).triggers[0].actions).toEqual([
    { kind: 'show-text', text: 'The wolves wake.', toPlayers: true },
  ])
})

test('a note with an image', async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add note' }).click()
  const note = sheet.getByRole('group', { name: 'Note 1' })
  await fill(note.getByLabel('Note title'), 'Growling')
  const grown = sheet.getByRole('group', { name: 'Growling' })
  await grown.getByTestId('v2-zone-note-file').setInputFiles({ name: 'growl.png', mimeType: 'image/png', buffer: PNG })
  await expect(grown.getByTestId('v2-zone-note-image')).toHaveCount(1)
  const n = (await prep(page)).notes[0]
  expect(n.title).toBe('Growling')
  expect(n.imageKeys).toHaveLength(1)
  expect(await store(page, `(s, k) => typeof s().assets.customImages[k]`, n.imageKeys[0])).toBe('string')
})

test('a trigger saves within seconds and survives a reload', async ({ page }) => {
  await openWithZone(page)
  const savedAt = () => store(page, `(s) => s().mapIndex.find((m) => m.id === s().activeMapId)?.updatedAt ?? 0`) as Promise<number>
  const before = await savedAt()
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  await page.waitForFunction(
    (t) => {
      const s = (window as Any).__store.getState()
      return (s.mapIndex.find((m: Any) => m.id === s.activeMapId)?.updatedAt ?? 0) > t
    },
    before,
    { timeout: 5000 },
  )
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await expect.poll(async () => (await prep(page)).triggers.map((t: Any) => t.name)).toEqual(['Trigger 1'])
})

test('Delete on a zone with a trigger warns that the trigger now references nothing', async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  // The sheet sits over the card; close it to reach the card's Delete.
  await sheet.getByRole('button', { name: 'Close Zone' }).click()
  await page.getByTestId('v2-sel-act-delete').click()
  await expect(page.getByLabel('Notifications alt+T').getByText(/1 trigger now references nothing/)).toBeVisible()
  expect(await zone(page)).toBeNull()
})

test('the zone card’s X and Y still move the zone', async ({ page }) => {
  await openWithZone(page)
  const card = page.getByTestId('v2-selection-card')
  await fill(card.getByLabel('Zone X'), '6')
  await fill(card.getByLabel('Zone Y'), '7.5')
  await expect.poll(async () => (await zone(page)).shape.position).toEqual({ x: 6, y: 7.5 })
})
