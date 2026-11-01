/**
 * A stubbed /api for the publish specs. No real session server: every request is
 * intercepted with page.route BEFORE the vite dev proxy ever sees it (playwright.config.ts's
 * webServer proxies /api to a real server on :8787 that isn't running here).
 */
import type { Page } from '@playwright/test'

export interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string>
  bodyBuffer: Buffer | null
}

export interface StubRoute {
  method: string
  path: RegExp
  /** `body` answers with raw text (an HTML error page); `abort` fails the request like a dead network. */
  respond: (req: RecordedRequest) => { status?: number; json?: unknown; body?: string; abort?: boolean }
}

/** Install a wildcard /api stub. Records every request; unstubbed ones 404. */
export async function installStubs(page: Page, routes: StubRoute[]): Promise<RecordedRequest[]> {
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
    if (result.abort) {
      await route.abort('failed')
    } else if (result.body !== undefined) {
      await route.fulfill({ status: result.status ?? 200, contentType: 'text/html', body: result.body })
    } else if (result.json !== undefined) {
      await route.fulfill({ status: result.status ?? 200, json: result.json })
    } else {
      await route.fulfill({ status: result.status ?? 200 })
    }
  })
  return calls
}
