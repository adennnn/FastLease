import { NextResponse, NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Returns every BU session on the account that still has a *running* task.
 * BU reports `status: 'active'` for any session with keepAlive=true whose
 * browser is still spun up — even if the agent finished long ago. To match
 * the user's intuition ("is something actually happening?") we cross-reference
 * with the tasks API and only count a session as active if at least one of
 * its tasks has TaskStatus === 'started'.
 *
 * Query params:
 *   ?all=1 — skip the staleness filter and return every live-task session,
 *            no matter how long it's been running. Used by the Refresh
 *            button so the user always sees BU ground truth.
 *
 * Without ?all=1, tasks 'started' for longer than STALE_TASK_MS are treated
 * as zombies and hidden — legitimate FB posts finish well under this, so
 * anything older has crashed/stuck.
 */
const STALE_TASK_MS = 15 * 60 * 1000

export async function GET(req: NextRequest) {
  const showAll = req.nextUrl.searchParams.get('all') === '1'
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
  const taskStartedBySession = new Map<string, number>()

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
              const prev = taskStartedBySession.get(t.sessionId) ?? 0
              if (ts > prev) taskStartedBySession.set(t.sessionId, ts)
            }
          } catch {}
        }),
      ),
    ])

    for (const s of byId.values()) {
      const ts = taskStartedBySession.get(s.id)
      if (ts) {
        s.hasRunningTask = true
        s.taskStartedAt = ts
      }
    }

    const items = Array.from(byId.values())
      .filter(s => s.hasRunningTask)
      .filter(s => showAll || (now - s.taskStartedAt) <= STALE_TASK_MS)
      .sort((a, b) => b.taskStartedAt - a.taskStartedAt)
      .map(({ taskStartedAt, ...rest }) => rest)

    const active = items.filter(s => !!s.liveUrl).length
    const queued = items.length - active
    const withRunning = Array.from(byId.values()).filter(s => s.hasRunningTask).length
    return NextResponse.json({
      items,
      active,
      queued,
      total: items.length,
      idleSessions: byId.size - withRunning,
      hiddenZombies: withRunning - items.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list sessions' }, { status: 500 })
  }
}
