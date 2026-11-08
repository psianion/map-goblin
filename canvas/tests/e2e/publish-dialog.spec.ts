/**
 * The publish dialog, end to end against a stubbed /api (see publishStubs.ts): a first
 * publish, a republish and a prep-only update through the stored token, nothing changed
 * with Publish anyway, an expired token, a scene deleted at the table, a failed check and
 * its Retry, the pass field keeping tool keys to itself, a table server that is down, the
 * frame keeping its height from step to step, and Publish pressed while a map loads.
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoApp } from './helpers'
import { installStubs } from './publishStubs'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const CAMPAIGN = 'camp-seed'
const SCENE = 'scene-seed'
const TOKEN = 'tok-seed'
const HINT = 'Light edits made at the table are kept on republish.'
const UNREACHABLE = 'Could not reach the table server. Check it is running and try again.'

function dialog(page: Page) {
  return page.getByTestId('v2-publish-dialog')
}

/** The dialog's layout height, which a transform (the open animation) does not change. */
function dialogHeight(page: Page): Promise<number> {
  return dialog(page).evaluate((el) => (el as HTMLElement).offsetHeight)
}

async function openPublish(page: Page) {
  await page.getByTestId('shell-publish').click()
  await expect(dialog(page)).toBeVisible()
  return dialog(page)
}

/** A publish ends on the done step; Close dismisses it. */
async function closeAfterPublish(page: Page): Promise<void> {
  await expect(dialog(page).getByTestId('v2-publish-done')).toBeVisible({ timeout: 5000 })
  await dialog(page).getByRole('button', { name: 'Close' }).last().click()
  await expect(dialog(page)).toBeHidden({ timeout: 5000 })
}

/** The open map's publish record, read straight from IndexedDB. */
function publishRecord(page: Page): Promise<Any> {
  return page.evaluate(async () => {
    const id = (window as Any).__store.getState().activeMapId
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('mapbuilder-maps', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise((resolve, reject) => {
      const req = db.transaction('maps', 'readonly').objectStore('maps').get(id)
      req.onsuccess = () => resolve(req.result?.publish ?? null)
      req.onerror = () => reject(req.error)
    })
  })
}

/** A change to the map itself (not prep), so the hash moves. */
async function renameMap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as Any).__store
    store.setState({ mapSettings: { ...store.getState().mapSettings, name: 'Renamed Map' } })
  })
}

/** One first publish through the real dialog, so the token and the publish record are genuine. */
async function seedFirstPublish(page: Page): Promise<void> {
  await installStubs(page, [
    { method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaigns: [] } }) },
    {
      method: 'POST',
      path: /^\/api\/campaigns$/,
      respond: () => ({ json: { campaignId: CAMPAIGN, identityId: 'id-seed', token: TOKEN } }),
    },
    {
      method: 'POST',
      path: new RegExp(`^/api/campaigns/${CAMPAIGN}/maps$`),
      respond: () => ({ json: { mapId: 'map-seed', sceneId: SCENE, name: 'Untitled Map', sizeBytes: 1 } }),
    },
  ])
  const d = await openPublish(page)
  await d.getByLabel('Admin pass').fill('seed-pass')
  await d.getByRole('button', { name: 'Continue' }).click()
  await d.getByLabel('Create new campaign').fill('Seed Campaign')
  await d.getByRole('button', { name: 'Create' }).click()
  await closeAfterPublish(page)
  await page.unroute('**/api/**')
}

test.describe('publish dialog', () => {
  test('first publish creates a campaign, uploads the map and stores the token', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    const calls = await installStubs(page, [
      { method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaigns: [] } }) },
      {
        method: 'POST',
        path: /^\/api\/campaigns$/,
        respond: () => ({ json: { campaignId: 'camp-1', identityId: 'id-1', token: 'tok-1' } }),
      },
      {
        method: 'POST',
        path: /^\/api\/campaigns\/camp-1\/maps$/,
        respond: () => ({ json: { mapId: 'map-1', sceneId: 'scene-1', name: 'Untitled Map', sizeBytes: 1 } }),
      },
    ])

    const d = await openPublish(page)
    await expect(d.getByRole('heading', { name: 'Publish to table' })).toBeVisible()
    await expect(d.getByText('The pass printed by your table server on first run.')).toBeVisible()
    await d.getByLabel('Admin pass').fill('adminpass')
    // Enter in the field submits the pass step; Continue is never clicked.
    await d.getByLabel('Admin pass').press('Enter')

    await expect(d.getByText('No campaigns on this server yet.')).toBeVisible()
    await expect(d.getByText(HINT)).toHaveCount(0)
    await d.getByLabel('Create new campaign').fill('My Campaign')
    await d.getByLabel('Create new campaign').press('Enter')
    await closeAfterPublish(page)
    await expect(page.getByText(/^Published ".*" to My Campaign — first publish$/)).toBeVisible()

    const createCall = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns')
    expect(createCall?.headers['authorization']).toBe('Bearer adminpass')
    expect(JSON.parse(createCall!.bodyBuffer!.toString())).toEqual({ name: 'My Campaign' })

    const uploadCall = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns/camp-1/maps')
    expect(uploadCall?.headers['authorization']).toBe('Bearer tok-1')
    expect(uploadCall?.headers['content-type']).toBe('application/octet-stream')
    expect(uploadCall!.bodyBuffer!.subarray(0, 5).toString('latin1')).toBe('MPBLD')

    expect(await page.evaluate(() => localStorage.getItem('goblin.publish.token.camp-1'))).toBe('tok-1')
    const record = await publishRecord(page)
    expect(record['camp-1']).toMatchObject({ sceneId: 'scene-1', campaignName: 'My Campaign' })
    expect(typeof record['camp-1'].publishedAt).toBe('number')
  })

  test('Open the table after a publish opens the handoff link in a new tab', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await renameMap(page)
    const tableUrl = 'http://127.0.0.1:9/host#handoff=code-1'
    const calls = await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${SCENE}/publish$`),
        respond: () => ({ json: { sceneId: SCENE, mapId: 'map-seed', name: 'Renamed Map', sizeBytes: 1 } }),
      },
      {
        method: 'POST',
        path: new RegExp(`^/api/campaigns/${CAMPAIGN}/handoff$`),
        respond: () => ({ json: { code: 'code-1', tableUrl } }),
      },
    ])

    const d = await openPublish(page)
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(d.getByTestId('v2-publish-done')).toHaveText('Published to Seed Campaign.')
    const [tab] = await Promise.all([page.waitForEvent('popup'), d.getByTestId('v2-publish-open-table').click()])
    await expect.poll(() => tab.url()).toContain('#handoff=code-1')
    await expect(dialog(page)).toBeHidden()

    const handoff = calls.find((c) => c.method === 'POST' && c.path === `/api/campaigns/${CAMPAIGN}/handoff`)
    expect(handoff?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  test('a map change republishes through the stored token', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await renameMap(page)
    const calls = await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${SCENE}/publish$`),
        respond: () => ({ json: { sceneId: SCENE, mapId: 'map-seed', name: 'Renamed Map', sizeBytes: 1 } }),
      },
    ])

    const d = await openPublish(page)
    await expect(d.getByTestId('v2-publish-change')).toHaveText('Map changed since your last publish.')
    await expect(d.getByText(HINT)).toBeVisible()
    await expect(d.getByTestId('v2-publish-campaign')).toHaveText('Seed Campaign')
    await expect(d.getByText(/^Last published/)).toBeVisible()
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await closeAfterPublish(page)

    const put = calls.find((c) => c.method === 'PUT' && c.path === `/api/scenes/${SCENE}/publish`)
    expect(put?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(put?.headers['content-type']).toBe('application/octet-stream')
    expect(calls.some((c) => c.path.endsWith('/maps'))).toBe(false)
  })

  test('a prep-only change goes to the prep route, with no upload', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await page.evaluate(() => (window as Any).__store.setState({ prep: { version: 1, triggers: [] } }))
    const calls = await installStubs(page, [
      { method: 'PUT', path: new RegExp(`^/api/scenes/${SCENE}/prep$`), respond: () => ({ status: 200 }) },
    ])

    const d = await openPublish(page)
    await expect(d.getByTestId('v2-publish-change')).toHaveText('Only trigger prep has changed.')
    await expect(d.getByText(HINT)).toHaveCount(0)
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await closeAfterPublish(page)

    const prepCall = calls.find((c) => c.method === 'PUT' && c.path === `/api/scenes/${SCENE}/prep`)
    expect(JSON.parse(prepCall!.bodyBuffer!.toString())).toEqual({ version: 1, triggers: [] })
    expect(calls.some((c) => /\/maps$|\/publish$/.test(c.path))).toBe(false)
  })

  test('nothing changed says so, and Publish anyway republishes', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    const calls = await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${SCENE}/publish$`),
        respond: () => ({ json: { sceneId: SCENE, mapId: 'map-seed', name: 'Untitled Map', sizeBytes: 1 } }),
      },
    ])

    const d = await openPublish(page)
    await expect(d.getByTestId('v2-publish-change')).toHaveText('No changes since your last publish.')
    await expect(d.getByText(HINT)).toHaveCount(0)
    await expect(d.getByRole('button', { name: 'Close' }).last()).toBeVisible()
    await d.getByRole('button', { name: 'Publish anyway' }).click()
    await closeAfterPublish(page)

    const put = calls.find((c) => c.method === 'PUT' && c.path === `/api/scenes/${SCENE}/publish`)
    expect(put?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  test('a 401 drops the token and asks for the pass again', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await renameMap(page)
    await installStubs(page, [
      { method: 'PUT', path: new RegExp(`^/api/scenes/${SCENE}/publish$`), respond: () => ({ status: 401 }) },
    ])

    const d = await openPublish(page)
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(d.getByLabel('Admin pass')).toBeVisible()
    await expect(d.getByText('Session expired — reconnect to publish.')).toBeVisible()
    expect(await page.evaluate((id) => localStorage.getItem(`goblin.publish.token.${id}`), CAMPAIGN)).toBeNull()
  })

  test('a scene deleted at the table publishes as a new one in the same click', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await renameMap(page)
    const calls = await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${SCENE}/publish$`),
        respond: () => ({ status: 404, json: { error: 'no such scene' } }),
      },
      {
        method: 'POST',
        path: new RegExp(`^/api/campaigns/${CAMPAIGN}/maps$`),
        respond: () => ({ json: { mapId: 'map-new', sceneId: 'scene-new', name: 'Renamed Map', sizeBytes: 1 } }),
      },
    ])

    const d = await openPublish(page)
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await closeAfterPublish(page)

    const upload = calls.find((c) => c.method === 'POST' && c.path === `/api/campaigns/${CAMPAIGN}/maps`)
    expect(upload?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
    await expect(page.getByText(/as a new scene — the old one was removed at the table/)).toBeVisible()
    await expect(page.getByText('no such scene')).toHaveCount(0)
    const record = await publishRecord(page)
    expect(record[CAMPAIGN].sceneId).toBe('scene-new')
  })

  test('a failed check shows an error, and Retry recovers', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await page.evaluate(() => {
      const store = (window as Any).__store
      ;(window as Any).__realSerialize = store.getState().getSerializableState
      store.setState({
        getSerializableState: () => {
          throw new Error('Could not read the map.')
        },
      })
    })

    const d = await openPublish(page)
    await expect(d.getByRole('alert')).toHaveText('Could not read the map.')
    await page.evaluate(() =>
      (window as Any).__store.setState({ getSerializableState: (window as Any).__realSerialize }),
    )
    await d.getByRole('button', { name: 'Retry' }).click()
    await expect(d.getByTestId('v2-publish-change')).toHaveText('No changes since your last publish.')
  })

  test('typing in the pass field changes no tool', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    const before = await page.evaluate(() => (window as Any).__store.getState().tools.activeTool)
    const d = await openPublish(page)
    const pass = d.getByLabel('Admin pass')
    await expect(pass).toBeFocused()
    await page.keyboard.press('v')
    await page.keyboard.press('b')
    await page.keyboard.press('l')
    await expect(pass).toHaveValue('vbl')
    expect(await page.evaluate(() => (window as Any).__store.getState().tools.activeTool)).toBe(before)
  })

  test('a gateway error page reads as an unreachable server, and Publish tries again', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await renameMap(page)
    let down = true
    const calls = await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${SCENE}/publish$`),
        respond: () =>
          down
            ? { status: 502, body: '<html><body><h1>502 Bad Gateway</h1></body></html>' }
            : { json: { sceneId: SCENE, mapId: 'map-seed', name: 'Renamed Map', sizeBytes: 1 } },
      },
    ])

    const d = await openPublish(page)
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(d.getByRole('alert')).toHaveText(UNREACHABLE)
    await expect(page.getByText(/request failed/)).toHaveCount(0)

    down = false
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await closeAfterPublish(page)
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(2)
  })

  test('a request that never gets an answer reads as an unreachable server', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await installStubs(page, [{ method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ abort: true }) }])

    const d = await openPublish(page)
    await d.getByLabel('Admin pass').fill('adminpass')
    await d.getByLabel('Admin pass').press('Enter')
    await expect(d.getByRole('alert')).toHaveText(UNREACHABLE)
    await expect(d.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  test('the frame keeps its height from the pass step to the campaigns step to the summary', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await installStubs(page, [
      {
        method: 'GET',
        path: /^\/api\/campaigns$/,
        respond: () => ({ json: { campaigns: [{ id: 'c-a', name: 'Alpha' }, { id: 'c-b', name: 'Beta' }] } }),
      },
      {
        method: 'POST',
        path: /^\/api\/campaigns$/,
        respond: () => ({ json: { campaignId: CAMPAIGN, identityId: 'id-seed', token: TOKEN } }),
      },
      {
        method: 'POST',
        path: new RegExp(`^/api/campaigns/${CAMPAIGN}/maps$`),
        respond: () => ({ json: { mapId: 'map-seed', sceneId: SCENE, name: 'Untitled Map', sizeBytes: 1 } }),
      },
    ])

    const d = await openPublish(page)
    await expect(d.getByLabel('Admin pass')).toBeVisible()
    const passHeight = await dialogHeight(page)
    await d.getByLabel('Admin pass').fill('adminpass')
    await d.getByLabel('Admin pass').press('Enter')
    await expect(d.getByRole('button', { name: 'Beta' })).toBeVisible()
    expect(await dialogHeight(page)).toBe(passHeight)
    await d.getByLabel('Create new campaign').fill('Gamma')
    await d.getByLabel('Create new campaign').press('Enter')
    await closeAfterPublish(page)

    await renameMap(page)
    await openPublish(page)
    await expect(d.getByTestId('v2-publish-change')).toHaveText('Map changed since your last publish.')
    expect(await dialogHeight(page)).toBe(passHeight)
  })

  test('Publish pressed while a map is still loading waits on Checking', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await page.evaluate(() => (window as Any).__store.setState({ isMapSwitching: true }))

    const d = await openPublish(page)
    await expect(d.getByText('Checking what changed since your last publish…')).toBeVisible()
    await page.evaluate(() => (window as Any).__store.setState({ isMapSwitching: false }))
    await expect(d.getByTestId('v2-publish-change')).toHaveText('No changes since your last publish.')
  })

  test('Publish pressed at once after a reload always shows a state', { tag: '@publish' }, async ({ page }) => {
    await gotoApp(page)
    await seedFirstPublish(page)
    await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())

    await page.reload()
    await page.getByTestId('v2-map-card').first().click()
    await page.getByTestId('shell-publish').click()
    const d = dialog(page)
    await expect(d).toBeVisible()
    await expect(
      d.getByText(/^Checking what changed since your last publish…$|^No changes since your last publish\.$/),
    ).toBeVisible()
    await expect(d.getByTestId('v2-publish-change')).toHaveText('No changes since your last publish.')
  })
})
