import { test } from '@playwright/test'

/**
 * @sprint2-tokens — the §2.6 rows that need the token UI (`src/modules/tokens/**`:
 * TokenRenderer + drag), which is being built alongside this lane. Phase 1 shipped their
 * server-side halves as wire tests (`session/server/src/integration.test.ts`): the move
 * fan-out is already measured across 6 raw clients, and ownership is already enforced
 * against forged frames. What is missing here is the browser: a real pointer drag, and a
 * frame budget with sprites on the canvas.
 *
 * Both slots run under `playwright.sprint2.config.ts` (production build, `channel:
 * 'chromium'` + ANGLE) — a frame-time metric on the headless shell measures SwiftShader,
 * and one on the dev server measures Vite.
 */

test.describe('@sprint2-tokens', () => {
  // Two contexts; DM places a token, the player claims it, then a real pointer drag
  // (mouse.down → moves → up) with the clock stopped on the *other* context's sprite
  // reaching the snapped cell. The raw-ws equivalent measures 2–3ms today, so what this
  // adds is the optimistic-move + rubber-band path (D9), not the fan-out.
  test.skip('token drag lands on every other client in < 100ms — phase 2: needs modules/tokens drag', () => {})

  // 20 tokens on the benchmark map, then the same rAF frame-time sample the S1 metrics
  // take. Belongs beside them in `metrics.spec.ts` once TokenRenderer exists.
  test.skip('20 tokens hold 60fps — phase 2: needs modules/tokens TokenRenderer', () => {})
})
