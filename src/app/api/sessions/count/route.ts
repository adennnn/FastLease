import { NextResponse } from 'next/server'

/**
 * Returns counts of non-terminal BU sessions:
 *   active — session has a liveUrl (browser is connected and reachable)
 *   queued — session exists but has no liveUrl yet (still initializing, or live view lost)
 * Stopped / finished sessions are excluded from both counts.
 */
export async function GET() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  const PAGE_SIZE = 100
  const MAX_PAGES = 20

  let active = 0
  let queued = 0

  try {
    await Promise.all(
      Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map(async pageNumber => {
        try {
          const resp: any = await client.sessions.list({ pageSize: PAGE_SIZE, pageNumber })
          const items: any[] = resp?.items || []
          for (const s of items) {
            if (s.finishedAt || s.status === 'stopped' || s.status === 'finished') continue
            if (s.liveUrl) active++
            else queued++
          }
        } catch {
          // ignore per-page failures
        }
      }),
    )

    return NextResponse.json({ active, queued, total: active + queued })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to count sessions' }, { status: 500 })
  }
}
