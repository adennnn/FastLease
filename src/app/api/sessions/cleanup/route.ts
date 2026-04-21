import { NextResponse } from 'next/server'

/**
 * Force-stops sessions whose running task has been in status 'started' for
 * longer than STALE_MS — these are zombie sessions (agent crashed, credits
 * exhausted mid-run, task stuck in BU state machine). Genuinely-running flows
 * finish within a few minutes, so 10 min is safely past any real task.
 */
const STALE_MS = 10 * 60 * 1000

export async function POST() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  const PAGE_SIZE = 100
  const MAX_PAGES = 20
  const now = Date.now()
  const toStop = new Set<string>()

  try {
    await Promise.all(
      Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map(async pageNumber => {
        try {
          const resp: any = await client.tasks.list({ pageSize: PAGE_SIZE, pageNumber, status: 'started' })
          const items: any[] = resp?.items || []
          for (const t of items) {
            const ts = t.startedAt ? Date.parse(t.startedAt) : (t.createdAt ? Date.parse(t.createdAt) : 0)
            if (!ts) continue
            if (now - ts > STALE_MS && t.sessionId) toStop.add(t.sessionId)
          }
        } catch {}
      }),
    )

    const stopped: string[] = []
    const failed: { id: string; error: string }[] = []
    const stopPromises = Array.from(toStop).map(id =>
      client.sessions.stop(id).then(
        () => { stopped.push(id) },
        (e: any) => { failed.push({ id, error: e?.message || 'stop failed' }) },
      ),
    )
    await Promise.all(stopPromises)

    return NextResponse.json({ stopped, failed, cleaned: stopped.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Cleanup failed' }, { status: 500 })
  }
}
