import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  createCampaign,
  getPrep,
  listScenes,
  mapDoc,
  mintDmToken,
  openSession,
  putPrep,
  republishScene,
  triggerPrep,
  uploadMap,
  type DmSession,
} from './library'
import { DEMO, FIXTURE, SERVER_URL, assertMapRendered, joinTable, loadedMapName } from './table'

/**
 * @publish-library — M3: a campaign's scene library, published from the editor and hosted
 * straight from it. REST tests seed state the way `session/server/src/api.test.ts` already
 * proves the server accepts it (a real HTTP server, no mocks); only the fourth test drives
 * the browser, because it is the only row that is actually about the wizard's UI.
 *
 *   pnpm exec playwright test -c e2e/playwright.publish.config.ts
 */

const admin = (): string => {
  const pass = process.env.E2E_ADMIN_PASS
  if (!pass) throw new Error('E2E_ADMIN_PASS is not set — did global-setup.ts run?')
  return pass
}

test('REST round-trip: campaign, dm-token, a published map with prep, and the scene library', async () => {
  const created = await createCampaign(admin(), 'Publish Library RT')
  // The dm-token endpoint, not the create response — M3 needs a way back into a campaign
  // the admin pass already owns without minting a second one.
  const dm: DmSession = await mintDmToken(admin(), created.campaignId)
  expect(dm.campaignId).toBe(created.campaignId)

  const prep = triggerPrep('The brazier flares to life.')
  const uploaded = await uploadMap(dm.token, dm.campaignId, mapDoc('RT Scene', { prep }))
  expect(uploaded.sceneId).toBeTruthy()
  expect(uploaded.name).toBe('RT Scene')

  const got = await getPrepOf(dm, uploaded.sceneId)
  expect(got).toEqual(prep)

  const { scenes } = await listScenes(dm.token, dm.campaignId)
  expect(scenes.map((s) => s.id)).toContain(uploaded.sceneId)
})

test('prep survives a prep-less republish, and an explicit one overwrites it', async () => {
  const dm = await createCampaign(admin(), 'Publish Library Prep')
  const original = triggerPrep('Original prep.')
  const first = await uploadMap(dm.token, dm.campaignId, mapDoc('Prep Scene', { prep: original }))

  const mapIdOf = async (sceneId: string) =>
    (await listScenes(dm.token, dm.campaignId)).scenes.find((s) => s.id === sceneId)!.mapId

  const beforeMapId = await mapIdOf(first.sceneId)

  // No `prep` key at all — the server's "absent means untouched" branch.
  const quiet = await republishScene(dm.token, first.sceneId, mapDoc('Prep Scene v2'))
  expect(await getPrepOf(dm, first.sceneId)).toEqual(original)
  const midMapId = await mapIdOf(first.sceneId)
  expect(quiet.mapId).toBe(midMapId)
  expect(midMapId).not.toBe(beforeMapId) // republish repoints mapId (#1)

  // An explicit prep on the next republish overwrites it.
  const overwritten = triggerPrep('Overwritten prep.')
  await republishScene(dm.token, first.sceneId, mapDoc('Prep Scene v3', { prep: overwritten }))
  expect(await getPrepOf(dm, first.sceneId)).toEqual(overwritten)
  const afterMapId = await mapIdOf(first.sceneId)
  expect(afterMapId).not.toBe(midMapId) // republish repoints mapId (#2)
})

test('a live table stays quiet through a prep-only PUT', async ({ page }) => {
  const dm = await createCampaign(admin(), 'Publish Library Quiet')
  const uploaded = await uploadMap(
    dm.token,
    dm.campaignId,
    mapDoc('Quiet Scene', { prep: triggerPrep('Initial.') }),
  )
  const opened = await openSession(dm.token, dm.campaignId, uploaded.sceneId)
  expect(opened.inviteCode).toMatch(/^[A-Z0-9]{6}$/)

  // Connects the same way `HostSetup.enterTable` does — `store.connect` + a route push —
  // without the wizard's four steps, since this test is about the socket staying quiet,
  // not about driving the UI to get one.
  await page.goto('/?e2e=1')
  await page.evaluate((token) => {
    const store = (
      window as unknown as { __sessionStore: { getState(): { connect(t: string): void } } }
    ).__sessionStore
    store.getState().connect(token)
    window.history.pushState(null, '', '/table' + window.location.search)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, dm.token)

  await expect(page.locator('[data-page="table"]')).toBeVisible()
  await expect.poll(() => loadedMapName(page), { timeout: 30_000, intervals: [50] }).toBe('Quiet Scene')

  const activeSceneBefore = await activeSceneId(page)

  await putPrep(dm.token, uploaded.sceneId, triggerPrep('Updated — must not reload the table.'))

  // Generous window: `putScenePrep` is deliberately quiet (no `refreshScenes`, no
  // `vision.invalidateScene`). If it broadcast anyway, `scene-changed` would have already
  // nulled `mapData` and moved `activeSceneId` — see the client store's handler for it.
  await page.waitForTimeout(2000)

  const mapDataAfter = await page.evaluate(
    () => (window as unknown as { __sessionStore: { getState(): { mapData: unknown } } }).__sessionStore
      .getState().mapData,
  )
  expect(mapDataAfter).not.toBeNull()
  expect(await activeSceneId(page)).toBe(activeSceneBefore)
  expect(await loadedMapName(page)).toBe('Quiet Scene')
})

test('HostSetup opens an existing campaign straight from its scene library', async ({ browser }) => {
  const campaignName = `Library Host ${Date.now()}`
  const dm = await createCampaign(admin(), campaignName)
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>
  await uploadMap(dm.token, dm.campaignId, doc) // scene already published — the UI only picks it

  const dmContext = await browser.newContext()
  const playerContext = await browser.newContext()
  try {
    const dmPage = await dmContext.newPage()
    await dmPage.goto('/?e2e=1')
    await dmPage.getByRole('link', { name: 'Host a game' }).click()

    await dmPage.locator('#server-url').fill(SERVER_URL)
    await dmPage.locator('#admin-pass').fill(admin())
    await dmPage.getByRole('button', { name: 'Continue' }).click()

    await dmPage.getByRole('button', { name: new RegExp(campaignName) }).click()

    await dmPage.getByRole('radio', { name: new RegExp(DEMO.name) }).check()
    await dmPage.getByRole('button', { name: 'Continue' }).click()

    await dmPage.getByRole('button', { name: 'Start session' }).click()
    const code = await dmPage.getByTestId('invite-code').textContent()
    expect(code).toMatch(/^[A-Z0-9]{6}$/)

    const playerPage = await playerContext.newPage()
    await joinTable(playerPage, code!, 'Borin')
    await assertMapRendered(playerPage, DEMO)
  } finally {
    await dmContext.close()
    await playerContext.close()
  }
})

// ─── Helpers ──────────────────────────────────────────────────

async function getPrepOf(dm: DmSession, sceneId: string) {
  return (await getPrep(dm.token, sceneId)).prep
}

function activeSceneId(page: import('@playwright/test').Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __sessionStore: { getState(): { session: { activeSceneId?: string } | null } }
        }
      ).__sessionStore.getState().session?.activeSceneId,
  )
}
