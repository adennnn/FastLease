import { NextResponse } from 'next/server'

/**
 * Returns counts of non-terminal BU sessions that actually have a running task:
 *   active — session has a liveUrl AND at least one task with status 'started'
 *   queued — session has a running task but no liveUrl yet (still initializing)
 * Sessions with no running task (idle keep-alive browsers, stopped, finished)
 * are excluded — see /api/sessions/active for the reasoning.
 */
export async function GET() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  const PAGE_SIZE = 100
  const MAX_PAGES = 20

  const sessionsById = new Map<string, { liveUrl: string | null }>()
  const runningSessionIds = new Set<string>()

  try {
    await Promise.all([
      Promise.all(
        Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map(async pageNumber => {
          try {
            const resp: any = await client.sessions.list({ pageSize: PAGE_SIZE, pageNumber })
            const items: any[] = resp?.items || []
            for (const s of items) {
              if (s.finishedAt || s.status === 'stopped' || s.status === 'finished') continue
              if (sessionsById.has(s.id)) continue
              sessionsById.set(s.id, { liveUrl: s.liveUrl ?? null })
            }
          } catch {}
        }),
      ),
      Promise.all(
        Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map(async pageNumber => {
          try {
            const resp: any = await client.tasks.list({ pageSize: PAGE_SIZE, pageNumber, status: 'started' })
            const items: any[] = resp?.items || []
            for (const t of items) {
              if (t.sessionId) runningSessionIds.add(t.sessionId)
            }
          } catch {}
        }),
      ),
    ])

    let active = 0
    let queued = 0
    for (const [id, s] of sessionsById) {
      if (!runningSessionIds.has(id)) continue
      if (s.liveUrl) active++
      else queued++
    }

    return NextResponse.json({ active, queued, total: active + queued })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to count sessions' }, { status: 500 })
  }
}
