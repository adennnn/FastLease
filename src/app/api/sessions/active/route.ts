import { NextResponse } from 'next/server'

/**
 * Returns every BU session on the account that still has a *running* task.
 * BU reports `status: 'active'` for any session with keepAlive=true whose
 * browser is still spun up — even if the agent finished long ago. To match
 * the user's intuition ("is something actually happening?") we cross-reference
 * with the tasks API and only count a session as active if at least one of
 * its tasks has TaskStatus === 'started' AND started within the last
 * STALE_TASK_MS. Anything older is a zombie (agent crashed, task stuck in
 * BU state machine) and is both hidden from the dashboard and force-stopped
 * in the background so BU capacity frees up for real postings.
 */
const STALE_TASK_MS = 10 * 60 * 1000

export async function GET() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  const PAGE_SIZE = 100
  const MAX_PAGES = 20
  const now = Date.now()

  type Item = {
    id: string
    liveUrl: string | null
    status: string | null
    createdAt: string | null
    profileId: string | null
    profileName: string | null
    hasRunningTask: boolean
    taskStartedAt: number
  }

  const byId = new Map<string, Item>()
  // sessionId → most-recent task startedAt timestamp for that session.
  const freshTaskBySession = new Map<string, number>()
  const staleSessionIds = new Set<string>()

  try {
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
                taskStartedAt: 0,
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
              if (!t.sessionId) continue
              const ts = t.startedAt ? Date.parse(t.startedAt) : (t.createdAt ? Date.parse(t.createdAt) : 0)
              if (!ts) continue
              if (now - ts > STALE_TASK_MS) {
                staleSessionIds.add(t.sessionId)
              } else {
                const prev = freshTaskBySession.get(t.sessionId) ?? 0
                if (ts > prev) freshTaskBySession.set(t.sessionId, ts)
              }
            }
          } catch {}
        }),
      ),
    ])

    for (const s of byId.values()) {
      const fresh = freshTaskBySession.get(s.id)
      if (fresh) {
        s.hasRunningTask = true
        s.taskStartedAt = fresh
      }
    }

    // Fire-and-forget: stop any session whose only running tasks are stale.
    // This keeps BU capacity from being held hostage by zombies between
    // explicit Refresh clicks.
    const toStop: string[] = []
    for (const sid of staleSessionIds) {
      if (!freshTaskBySession.has(sid)) toStop.push(sid)
    }
    if (toStop.length > 0) {
      Promise.all(toStop.map(id => client.sessions.stop(id).catch(() => {}))).catch(() => {})
    }

    const items = Array.from(byId.values())
      .filter(s => s.hasRunningTask)
      .sort((a, b) => b.taskStartedAt - a.taskStartedAt)
      .map(({ taskStartedAt, ...rest }) => rest)

    const active = items.filter(s => !!s.liveUrl).length
    const queued = items.length - active
    return NextResponse.json({
      items,
      active,
      queued,
      total: items.length,
      idleSessions: byId.size - items.length,
      zombiesReaped: toStop.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list sessions' }, { status: 500 })
  }
}
