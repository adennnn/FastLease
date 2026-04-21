import { NextResponse } from 'next/server'

/**
 * Returns every BU session on the account that still has a *running* task.
 * BU reports `status: 'active'` for any session with keepAlive=true whose
 * browser is still spun up — even if the agent finished long ago. To match
 * the user's intuition ("is something actually happening?") we cross-reference
 * with the tasks API and only count a session as active if at least one of
 * its tasks has TaskStatus === 'started'.
 */
export async function GET() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  const PAGE_SIZE = 100
  const MAX_PAGES = 20

  type Item = {
    id: string
    liveUrl: string | null
    status: string | null
    createdAt: string | null
    profileId: string | null
    profileName: string | null
    hasRunningTask: boolean
  }

  const byId = new Map<string, Item>()
  const runningSessionIds = new Set<string>()

  try {
    // Run the sessions listing and the running-tasks listing in parallel.
    await Promise.all([
      Promise.all(
        Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map(async pageNumber => {
          try {
            const resp: any = await client.sessions.list({ pageSize: PAGE_SIZE, pageNumber })
            const items: any[] = resp?.items || []
            for (const s of items) {
              if (s.finishedAt || s.status === 'stopped' || s.status === 'finished') continue
              if (byId.has(s.id)) continue
              byId.set(s.id, {
                id: s.id,
                liveUrl: s.liveUrl ?? null,
                status: s.status ?? null,
                createdAt: s.createdAt ?? s.startedAt ?? null,
                profileId: s.profileId ?? s.browserProfileId ?? null,
                profileName: s.profileName ?? s.browserProfileName ?? null,
                hasRunningTask: false,
              })
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

    for (const s of byId.values()) {
      s.hasRunningTask = runningSessionIds.has(s.id)
    }

    // Only sessions with a running task count as "live" from the user's POV.
    // Idle keep-alive sessions are dropped entirely — otherwise the grid fills
    // with empty "Enter URL" browsers from previous runs.
    const items = Array.from(byId.values())
      .filter(s => s.hasRunningTask)
      .sort((a, b) => {
        const at = a.createdAt ? Date.parse(a.createdAt) : 0
        const bt = b.createdAt ? Date.parse(b.createdAt) : 0
        return bt - at
      })

    const active = items.filter(s => !!s.liveUrl).length
    const queued = items.length - active
    return NextResponse.json({ items, active, queued, total: items.length, idleSessions: byId.size - items.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list sessions' }, { status: 500 })
  }
}
