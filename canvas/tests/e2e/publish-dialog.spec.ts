/**
 * PublishDialog — E2E against a stubbed /api.
 *
 * No real session server: every request is intercepted with page.route BEFORE the vite
 * dev proxy ever sees it (playwright.config.ts's webServer proxies /api to a real server
 * on :8787 that isn't running here). Assertions are on the requests themselves — method,
 * headers, body shape — since that's the whole point of this suite.
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoApp } from './helpers'

interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string>
  bodyBuffer: Buffer | null
}

interface StubRoute {
  method: string
  path: RegExp
  respond: (req: RecordedRequest) => { status?: number; json?: unknown }
}

/** Install a wildcard /api stub. Records every request; unstubbed ones 404. */
async function installStubs(page: Page, routes: StubRoute[]): Promise<RecordedRequest[]> {
  const calls: RecordedRequest[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const recorded: RecordedRequest = {
      method: request.method(),
      path: url.pathname,
      headers: request.headers(),
      bodyBuffer: request.postDataBuffer(),
    }
    calls.push(recorded)
    const match = routes.find((r) => r.method === recorded.method && r.path.test(recorded.path))
    if (!match) {
      await route.fulfill({ status: 404, json: { error: `unstubbed ${recorded.method} ${recorded.path}` } })
      return
    }
    const result = match.respond(recorded)
    if (result.json !== undefined) {
      await route.fulfill({ status: result.status ?? 200, json: result.json })
    } else {
      await route.fulfill({ status: result.status ?? 200 })
    }
  })
  return calls
}

async function openPublishDialog(page: Page): Promise<void> {
  await page.getByTitle('Publish to library').click()
}

async function expectDialogClosed(page: Page): Promise<void> {
  await expect(page.getByText('Publish to Library')).not.toBeVisible({ timeout: 5000 })
}

/**
 * Run one full stubbed first-publish through the real UI so localStorage + the
 * IndexedDB publish state are genuine, not fabricated — the honest way to reach a
 * "already published" starting point for the prep-only and 401 tests.
 */
async function seedFirstPublish(
  page: Page,
): Promise<{ campaignId: string; sceneId: string; token: string }> {
  const campaignId = 'camp-seed'
  const sceneId = 'scene-seed'
  const token = 'tok-seed'
  await installStubs(page, [
    { method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaigns: [] } }) },
    {
      method: 'POST',
      path: /^\/api\/campaigns$/,
      respond: () => ({ json: { campaignId, identityId: 'id-seed', token } }),
    },
    {
      method: 'POST',
      path: new RegExp(`^/api/campaigns/${campaignId}/maps$`),
      respond: () => ({ json: { mapId: 'map-seed', sceneId, name: 'Untitled Map', sizeBytes: 1 } }),
    },
  ])

  await openPublishDialog(page)
  await page.locator('#publish-admin-pass').fill('seed-pass')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#publish-new-campaign').fill('Seed Campaign')
  await page.getByRole('button', { name: 'Create' }).click()
  await expectDialogClosed(page)
  await page.unroute('**/api/**')

  return { campaignId, sceneId, token }
}

test.describe('PublishDialog', () => {
  test('first publish creates a new campaign and uploads the map', async ({ page }) => {
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

    await openPublishDialog(page)
    await expect(page.locator('#publish-admin-pass')).toBeVisible()
    await page.locator('#publish-admin-pass').fill('adminpass')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByText('No campaigns on this server yet.')).toBeVisible()
    await page.locator('#publish-new-campaign').fill('My Campaign')
    await page.getByRole('button', { name: 'Create' }).click()
    await expectDialogClosed(page)

    const createCall = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns')
    expect(createCall?.headers['authorization']).toBe('Bearer adminpass')
    expect(JSON.parse(createCall!.bodyBuffer!.toString())).toEqual({ name: 'My Campaign' })

    const uploadCall = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns/camp-1/maps')
    expect(uploadCall?.headers['authorization']).toBe('Bearer tok-1')
    expect(uploadCall?.headers['content-type']).toBe('application/octet-stream')
    const bytes = uploadCall!.bodyBuffer!
    // MAGIC_HEADER = 'MPBLD\x00' (mapFormat.ts) — 5 ASCII bytes then a NUL terminator.
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('MPBLD')
    expect(bytes[5]).toBe(0)

    const storedToken = await page.evaluate(() => localStorage.getItem('goblin.publish.token.camp-1'))
    expect(storedToken).toBe('tok-1')
  })

  test('existing campaign publishes via a minted dm-token', async ({ page }) => {
    await gotoApp(page)
    const calls = await installStubs(page, [
      {
        method: 'GET',
        path: /^\/api\/campaigns$/,
        respond: () => ({ json: { campaigns: [{ id: 'camp-9', name: 'Camp Nine' }] } }),
      },
      {
        method: 'POST',
        path: /^\/api\/campaigns\/camp-9\/dm-token$/,
        respond: () => ({ json: { token: 'dm-tok-9', campaignId: 'camp-9', name: 'Camp Nine' } }),
      },
      {
        method: 'POST',
        path: /^\/api\/campaigns\/camp-9\/maps$/,
        respond: () => ({ json: { mapId: 'map-9', sceneId: 'scene-9', name: 'Untitled Map', sizeBytes: 1 } }),
      },
    ])

    await openPublishDialog(page)
    await page.locator('#publish-admin-pass').fill('secret-pass')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByRole('button', { name: 'Camp Nine' }).click()
    await expectDialogClosed(page)

    const tokenCall = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns/camp-9/dm-token')
    expect(tokenCall?.headers['authorization']).toBe('Bearer secret-pass')

    const uploadCall = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns/camp-9/maps')
    expect(uploadCall?.headers['authorization']).toBe('Bearer dm-tok-9')
  })

  test('prep-only change publishes via the prep endpoint, not a map upload', async ({ page }) => {
    await gotoApp(page)
    const { sceneId } = await seedFirstPublish(page)

    // Reopen with nothing changed: no-op summary, no prep authored yet.
    await openPublishDialog(page)
    await expect(page.getByText('No changes since your last publish.')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    // No trigger-authoring UI exists yet (scene prep editor is a later sprint) — the
    // store's `prep` field is what getSerializableState() reads, so setting it directly
    // through the E2E-only window.__store hook (main.tsx, dev builds) is the honest
    // shortcut: same code path a real editor would eventually drive through the store.
    await page.evaluate(() => {
      interface StoreHook { setState: (partial: Record<string, unknown>) => void }
      const store = (window as unknown as { __store: StoreHook }).__store
      store.setState({ prep: { version: 1, triggers: [] } })
    })

    const calls = await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${sceneId}/prep$`),
        respond: () => ({ status: 200 }),
      },
    ])

    await openPublishDialog(page)
    await expect(page.getByText('Only trigger prep has changed.')).toBeVisible()
    await page.getByRole('button', { name: 'Publish' }).click()
    await expectDialogClosed(page)

    const prepCall = calls.find((c) => c.method === 'PUT' && c.path === `/api/scenes/${sceneId}/prep`)
    expect(prepCall?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(prepCall!.bodyBuffer!.toString())).toEqual({ version: 1, triggers: [] })

    const mapWrite = calls.find((c) => /\/maps$/.test(c.path) || /\/publish$/.test(c.path))
    expect(mapWrite).toBeUndefined()
  })

  test('a 401 on publish drops the stored token and falls back to the password step', async ({ page }) => {
    await gotoApp(page)
    const { campaignId, sceneId } = await seedFirstPublish(page)

    // Force a real map change (not just prep) so the summary click issues a network
    // call at all — an unchanged map short-circuits to a no-op with no fetch.
    await page.evaluate(() => {
      interface StoreHook {
        getState: () => { mapSettings: Record<string, unknown> }
        setState: (partial: Record<string, unknown>) => void
      }
      const store = (window as unknown as { __store: StoreHook }).__store
      const { mapSettings } = store.getState()
      store.setState({ mapSettings: { ...mapSettings, name: 'Renamed Map' } })
    })

    await installStubs(page, [
      {
        method: 'PUT',
        path: new RegExp(`^/api/scenes/${sceneId}/publish$`),
        respond: () => ({ status: 401 }),
      },
    ])

    await openPublishDialog(page)
    await expect(page.getByText('Map changed since your last publish.')).toBeVisible()
    await page.getByRole('button', { name: 'Publish' }).click()

    await expect(page.locator('#publish-admin-pass')).toBeVisible()
    await expect(page.getByText('Session expired — reconnect to publish.')).toBeVisible()

    const storedToken = await page.evaluate(
      (id) => localStorage.getItem(`goblin.publish.token.${id}`),
      campaignId,
    )
    expect(storedToken).toBeNull()
  })
})
