import { expect, type Page } from '@playwright/test'

/**
 * The token steps the sprint-2 specs share: put a def in the library, place one on the map
 * with the DM's click-to-place flow, read what everyone can see, drag one with a real
 * pointer.
 *
 * Everything here works in *canvas* coordinates and never converts a world position back
 * into one. It cannot: `__pixiApp` — the only handle on the camera transform — is exposed
 * under `import.meta.env.DEV`, and these specs run the production build. So a token is
 * always grabbed at the point it was placed at, which is inside its box by construction
 * (the server snaps to the nearest cell centre, i.e. within half a cell of the click), and
 * where it *lands* is read back rather than predicted.
 *
 * Positions are read off `data-testid="token-layer"` — the panel's DOM mirror of the scene,
 * where every `<li>` carries `data-token-id/x/y/hidden/owner`. That is the same tokens
 * slice the Pixi overlay draws from, in world units already snapped by the server, so an
 * assertion here is about the authoritative position and not about pixels.
 */

export interface Point {
  x: number
  y: number
}

/** A viewport point at fractional offsets into the map canvas — `page.mouse`'s space. */
export async function canvasPoint(page: Page, fx: number, fy: number): Promise<Point> {
  const box = await page.locator('[data-testid="game-canvas"] canvas').boundingBox()
  if (!box) throw new Error('the map canvas is not on screen')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

/** The active scene's tokens as `{id: {x, y}}` — world units, server-snapped. */
export function tokenPositions(page: Page): Promise<Record<string, Point>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(
        document.querySelectorAll('[data-testid="token-layer"] [data-token-id]'),
        (li): [string, { x: number; y: number }] => {
          const { tokenId, x, y } = (li as HTMLElement).dataset
          return [String(tokenId), { x: Number(x), y: Number(y) }]
        },
      ),
    ),
  )
}

/** DM: library form → one def. */
export async function createDef(page: Page, name: string): Promise<void> {
  await page.getByTestId('token-name').fill(name)
  await page.getByTestId('token-save').click()
  await expect(page.getByTestId('token-library')).toContainText(name)
}

/**
 * DM: arm the def, click the map. Resolves once the table has been told about the new
 * token — the server mints the id and snaps the position, so both are read back after.
 */
export async function placeToken(page: Page, defName: string, at: Point): Promise<void> {
  const before = Object.keys(await tokenPositions(page)).length
  await page.getByTestId('token-library').getByRole('button', { name: defName, exact: true }).click()
  await expect(page.getByTestId('place-hint')).toBeVisible()

  await page.mouse.click(at.x, at.y)
  // The hint clears on pointerdown (the click was taken as a placement, not a pan); the row
  // arrives with the server's `state-update`.
  await expect(page.getByTestId('place-hint')).toHaveCount(0)
  await expect(page.getByTestId('token-layer').locator('[data-token-id]')).toHaveCount(before + 1, {
    timeout: 15_000,
  })
}

/**
 * Clicks `at` until the token overlay answers with a selection — the gate every drag needs.
 *
 * The overlay is mounted by a 200ms poll that starts when the engine singleton appears
 * (§4), so "the map has rendered" does not yet mean "a click on a token hits one". A hit
 * is the only observable proof that the Pixi layer is live, and it leaves the token
 * selected, which is also what the claim button needs.
 */
export async function selectOnCanvas(page: Page, at: Point, name: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.mouse.click(at.x, at.y)
        return page.getByTestId('token-selection').textContent({ timeout: 1000 }).catch(() => null)
      },
      { timeout: 20_000, intervals: [250] },
    )
    .toContain(name)
}

/**
 * A real pointer drag across the canvas: down on the token, two moves, up. `drag.ts` wires
 * capture-phase DOM listeners, so trusted input is the only way in — and the intermediate
 * move is what makes the 10 Hz throttle behave the way it does under a hand.
 */
export async function dragToken(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2)
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}
