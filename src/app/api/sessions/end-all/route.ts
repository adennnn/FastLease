import { NextResponse } from 'next/server'

/**
 * Emergency kill switch — stops every active BU session on the account,
 * regardless of which task / profile / agent owns it.
 */
export async function POST() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  const stopped: string[] = []
  const failed: { id: string; error: string }[] = []

  try {
    // Pull all pages in parallel — sequential pagination was the kill-switch's
    // worst latency offender (20 pages × ~250ms = 5s before we issued the
    // FIRST stop). With concurrent fetches the whole listing phase collapses
    // to a single round-trip. Stops fire as each page arrives so the BU side
    // starts killing sessions in waves rather than after the slowest page.
    const PAGE_SIZE = 100
    const MAX_PAGES = 20
    const seen = new Set<string>()
    const stopPromises: Promise<void>[] = []

    const stopOne = (id: string) => stopPromises.push(
      client.sessions.stop(id).then(
        () => { stopped.push(id) },
        (e: any) => { failed.push({ id, error: e?.message || 'stop failed' }) },
      ),
    )

    await Promise.all(
      Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map(async pageNumber => {
        try {
          const resp: any = await client.sessions.list({ pageSize: PAGE_SIZE, pageNumber })
          const items: any[] = resp?.items || []
          for (const s of items) {
            if (s.finishedAt || s.status === 'stopped') continue
            if (seen.has(s.id)) continue
            seen.add(s.id)
            stopOne(s.id)
          }
        } catch {
          // page-level failure — ignore, other pages still run
        }
      }),
    )

    console.log(`[EndAll] Found ${seen.size} active session(s); awaiting stops...`)
    await Promise.all(stopPromises)

    console.log(`[EndAll] Stopped ${stopped.length}; ${failed.length} failed`)
    return NextResponse.json({ stopped: stopped.length, failed, totalFound: seen.size })
  } catch (e: any) {
    console.error('[EndAll] Error:', e?.message)
    return NextResponse.json({ error: e?.message || 'Failed to end sessions', stopped: stopped.length, failed }, { status: 500 })
  }
}
