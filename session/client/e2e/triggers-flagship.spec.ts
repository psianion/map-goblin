import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { TriggerLogEntry, TriggerPrompt } from '@dnd/mechanics/triggers'
import { TRIGGERS_FIXTURE, triggersFlagshipDoc } from './library'
import { assertMapLoaded, hostTable, joinTable, type MapUnderTest } from './table'
import { canvasPoint, createDef, placeToken, tokenPositions } from './tokens'

/**
 * @triggers — M4's flagship: the row the contract has carried as "never executed end to
 * end" — a room-revealed narration everyone hears, a trap only the claiming player is asked
 * to answer, and the DM's own bookkeeping (fired/armed/disabled, every other trigger's name
 * and text) staying off that player's wire entirely.
 *
 *   pnpm exec playwright test -c e2e/playwright.triggers.config.ts
 *
 * The map is built in memory (`library.ts`'s `triggersFlagshipDoc`) rather than a fixture
 * file on disk: one room, two zones, geometry taken straight from the wire-level proof of
 * this same cascade (`session/server/src/triggers.e2e.test.ts`).
 */

const VIEWPORT = { width: 1280, height: 720 }
const F = TRIGGERS_FIXTURE
const MAP: MapUnderTest = { doc: triggersFlagshipDoc('Triggers Vault'), name: 'Triggers Vault' }

// ── Instruments ────────────────────────────────────────────────────────────

/** Dispatch a command straight through the store, the way doors-flagship.spec.ts does. */
const sendCommand = (page: Page, module: string, action: string, payload: unknown): Promise<void> =>
  page.evaluate(
    ([m, a, p]) => {
      interface Tab {
        __sessionStore?: {
          getState(): { sendCommand(module: string, action: string, payload: unknown): void }
        }
      }
      ;(window as unknown as Tab).__sessionStore!.getState().sendCommand(m as string, a as string, p)
    },
    [module, action, payload] as [string, string, unknown],
  )

/** The drop message a move sends, sent without the drag — see doors-flagship.spec.ts. */
const sendMove = (page: Page, id: string, at: { x: number; y: number }): Promise<void> =>
  sendCommand(page, 'tokens', 'move', { id, x: at.x, y: at.y })

/** The fog tool is a mode: arming it is what puts the room list on screen. */
async function armFog(dm: Page): Promise<void> {
  if ((await dm.getByTestId('fog-bar').count()) === 0) {
    await dm.getByTestId('fog-tool-toggle').click()
    await expect(dm.getByTestId('fog-bar')).toBeVisible()
  }
}

async function revealRoom(dm: Page, roomId: string): Promise<void> {
  await armFog(dm)
  const row = dm.getByTestId('fog-rooms').locator(`[data-room-id="${roomId}"]`)
  if ((await row.getAttribute('data-fog-status')) !== 'revealed') {
    await row.getByRole('button').click()
  }
  await expect(row).toHaveAttribute('data-fog-status', 'revealed')
}

interface SceneSnapshot {
  fired: Record<string, number>
  armed: Record<string, boolean>
  disabled: Record<string, boolean>
  prompts: TriggerPrompt[]
  log: TriggerLogEntry[]
}

/** This tab's own copy of the active scene's triggers slice — redacted for a player, raw for
 *  the DM, exactly as `useModuleState('triggers')` reads it inside the app. */
function sceneTriggers(page: Page): Promise<SceneSnapshot> {
  return page.evaluate(() => {
    interface Tab {
      __sessionStore?: {
        getState(): {
          session?: { activeSceneId?: string | null; modules?: Record<string, unknown> } | null
        }
      }
    }
    const session = (window as unknown as Tab).__sessionStore!.getState().session
    const sceneId = session?.activeSceneId ?? ''
    const triggers = (session?.modules?.triggers ?? {}) as { byScene?: Record<string, unknown> }
    return (triggers.byScene?.[sceneId] ?? {
      fired: {},
      armed: {},
      disabled: {},
      prompts: [],
      log: [],
    }) as unknown as SceneSnapshot
  })
}

/** The whole `triggers` module this tab holds, serialized — the definition-leak probe walks
 *  this string rather than a parsed shape, so nothing about *how* a marker might be nested
 *  gives it a place to hide. */
function fullTriggersJson(page: Page): Promise<string> {
  return page.evaluate(() => {
    interface Tab {
      __sessionStore?: { getState(): { session?: { modules?: Record<string, unknown> } | null } }
    }
    const modules = (window as unknown as Tab).__sessionStore!.getState().session?.modules ?? {}
    return JSON.stringify(modules.triggers ?? null)
  })
}

const triggerRow = (page: Page, name: string) =>
  page.getByTestId('trigger-list').locator('li', { hasText: name })

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@triggers flagship', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let tokenId: string
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, MAP)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapLoaded(dm, MAP)

    playerContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    await assertMapLoaded(player, MAP)

    // A token for the trap flow, parked at the fixture's spawn point — placed before anyone
    // has claimed it, and moved with an exact dispatch rather than a canvas click because
    // this spec cares about exact world coordinates against the zone's rect.
    await createDef(dm, 'Scout')
    await placeToken(dm, 'Scout', await canvasPoint(dm, 0.5, 0.5))
    tokenId = Object.keys(await tokenPositions(dm))[0]!
    await sendMove(dm, tokenId, F.spawn)
    await expect.poll(() => tokenPositions(dm).then((p) => p[tokenId])).toEqual(F.spawn)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the triggers flagship flow:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('room text on reveal: the player hears it, and the DM sees the trigger fired', async () => {
    await revealRoom(dm, F.roomId)

    await expect(player.getByTestId('toast')).toContainText(F.roomText, { timeout: 20_000 })
    await expect(triggerRow(dm, 'Room revealed narration')).toContainText('Fired', { timeout: 20_000 })
  })

  test('Reveal All also fires the room-revealed trigger, from unrevealed fog', async () => {
    const before = (await sceneTriggers(dm)).log.filter(
      (e) => e.triggerId === F.triggerIds.room,
    ).length
    // Fired once already, by the single-room reveal above.
    expect(before).toBeGreaterThanOrEqual(1)

    // `reset` is the one path with no button — same dispatch the sprint3/doors specs use for
    // moves, here for the fog command a `fog reset` UI control does not exist on.
    await sendCommand(dm, 'fog', 'reset', {})
    const row = dm.getByTestId('fog-rooms').locator(`[data-room-id="${F.roomId}"]`)
    await armFog(dm)
    await expect(row).toHaveAttribute('data-fog-status', 'never_revealed', { timeout: 20_000 })

    // The bulk path (`set-bulk`, not a single-room `reveal`) is what this test is for — both
    // cascade into `triggers`, but only this one is the "Reveal All" row N5 asked to cover.
    await dm.getByTestId('fog-reveal-all').click()
    await expect(row).toHaveAttribute('data-fog-status', 'revealed', { timeout: 20_000 })

    await expect
      .poll(
        async () =>
          (await sceneTriggers(dm)).log.filter((e) => e.triggerId === F.triggerIds.room).length,
        { timeout: 20_000 },
      )
      .toBe(before + 1)
    await expect(triggerRow(dm, 'Room revealed narration')).toContainText('Fired')
  })

  test('trap flow: the prompt lands only on the claimant, rolls to an outcome, and clears both sides', async () => {
    const row = player.getByTestId('token-layer').locator(`[data-token-id="${tokenId}"]`)
    await expect(row).toHaveCount(1, { timeout: 20_000 })
    await row.getByRole('button').click()
    await player.getByTestId('claim-button').click()
    await expect(row).toHaveAttribute('data-owner', /.+/, { timeout: 20_000 })

    await sendMove(player, tokenId, F.trapPoint)
    await expect.poll(() => tokenPositions(player).then((p) => p[tokenId])).toEqual(F.trapPoint)

    const card = player.getByTestId('trigger-prompt')
    await expect(card).toHaveCount(1, { timeout: 20_000 })
    await expect(card).toContainText(F.trapText)
    await expect(card).toContainText(F.trapAbilityLabel)
    const rollButton = card.getByRole('button', { name: /^Roll:/ })
    await expect(rollButton).toBeVisible()

    const beforeRoll = await sceneTriggers(player)
    expect(beforeRoll.fired).toEqual({})
    expect(beforeRoll.armed).toEqual({})
    expect(beforeRoll.disabled).toEqual({})
    expect(beforeRoll.prompts).toHaveLength(1)
    expect(beforeRoll.prompts[0]).toMatchObject({ triggerId: F.triggerIds.trap })

    await rollButton.click()

    await expect(player.getByTestId('toast')).toContainText(`vs DC ${F.trapDc}`, { timeout: 20_000 })
    await expect(dm.getByTestId('trigger-log')).toContainText(`vs DC ${F.trapDc}`, { timeout: 20_000 })

    await expect(player.getByTestId('trigger-prompt')).toHaveCount(0)
    await expect(dm.getByTestId('trigger-prompt')).toHaveCount(0)
  })

  test('definition-leak probe: the player holds nothing beyond what is theirs', async () => {
    // A third trigger, authored off and anchored only so it can be found: force-fired from
    // the DM's own button, never by the automatic cascade (module.ts skips a disabled
    // trigger's `event` evaluation outright, and `fireCommand` is the one path that does not
    // care).
    await dm.getByRole('button', { name: `Fire: ${F.secretName}` }).click()
    await expect(dm.getByTestId('trigger-log')).toContainText(F.secretPromptText, { timeout: 20_000 })

    const playerHtml = await player.content()
    expect(playerHtml).not.toContain(F.secretPromptText)
    expect(playerHtml).not.toContain(F.secretName)

    const playerModule = await fullTriggersJson(player)
    expect(playerModule).not.toContain(F.secretPromptText)
    expect(playerModule).not.toContain(F.secretName)
    expect(playerModule).not.toContain(F.triggerIds.initiative)

    const scene = await sceneTriggers(player)
    expect(scene.fired).toEqual({})
    expect(scene.armed).toEqual({})
    expect(scene.disabled).toEqual({})
    expect(scene.log.some((e) => e.kind === 'prompt')).toBe(false)

    // Every trigger id the player's own log carries is one addressed to them — the
    // room-revealed narration (`toPlayers`) and their own trap roll outcome — and nothing
    // else, id or name, rides along with it.
    const allowed = new Set<string>([F.triggerIds.room, F.triggerIds.trap])
    const stray = scene.log.filter((e) => e.triggerId && !allowed.has(e.triggerId))
    expect(stray).toEqual([])
  })

  test('a DM-driven move cascades too: out and back re-fires the once:false trigger', async () => {
    const before = (await sceneTriggers(dm)).log.filter(
      (e) => e.triggerId === F.triggerIds.rearm,
    ).length
    // Fired once already, when the player walked the token in during the trap-flow test.
    expect(before).toBeGreaterThanOrEqual(1)

    await sendMove(dm, tokenId, F.spawn)
    await expect.poll(() => tokenPositions(dm).then((p) => p[tokenId])).toEqual(F.spawn)
    await sendMove(dm, tokenId, F.trapPoint)
    await expect.poll(() => tokenPositions(dm).then((p) => p[tokenId])).toEqual(F.trapPoint)

    await expect
      .poll(
        async () =>
          (await sceneTriggers(dm)).log.filter((e) => e.triggerId === F.triggerIds.rearm).length,
        { timeout: 20_000 },
      )
      .toBe(before + 1)
  })
})
