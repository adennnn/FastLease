import { NextResponse } from 'next/server'

const V3_BASE = 'https://api.browser-use.com/api/v3'

export async function GET() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })
  }

  // 429-aware fetch. BU's profiles endpoint shares the same per-account rate
  // bucket as session-list/sync/fetch-profile-url etc., so a flurry of warmup
  // sync calls wipes out our ability to even *list* the accounts. Retrying
  // the throttled page with exponential backoff (capped at 4 attempts) makes
  // the page resilient to that without the user seeing "Loading accounts…"
  // forever and assuming their data is gone.
  const fetchPageWithRetry = async (url: string): Promise<Response> => {
    const delays = [0, 500, 1500, 4000] // total worst case ~6s
    let lastRes: Response | null = null
    for (const d of delays) {
      if (d) await new Promise(r => setTimeout(r, d))
      const res = await fetch(url, {
        headers: { 'X-Browser-Use-API-Key': apiKey },
        cache: 'no-store',
      })
      if (res.status !== 429) return res
      lastRes = res
    }
    return lastRes!
  }

  try {
    // The v3 SDK doesn't expose profiles.list yet, but the REST endpoint exists
    // and is what the Browser Profiles dashboard is backed by.
    const all: any[] = []
    let pageToken: string | undefined = undefined
    for (let i = 0; i < 20; i++) {
      const url = new URL(`${V3_BASE}/profiles`)
      url.searchParams.set('pageSize', '100')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const res = await fetchPageWithRetry(url.toString())
      if (!res.ok) {
        const text = await res.text()
        // Bubble up rate-limit specifically so the client can show a useful
        // message instead of generic "fetch failed".
        if (res.status === 429) {
          return NextResponse.json(
            { error: 'Browser-use is rate-limiting your account. Wait ~30s and retry.', code: 'RATE_LIMITED' },
            { status: 429 },
          )
        }
        throw new Error(`browser-use ${res.status}: ${text.slice(0, 200)}`)
      }
      const data = await res.json()
      const items = data.items || data.data || []
      all.push(...items)
      pageToken = data.nextPageToken || data.next_page_token || undefined
      if (!pageToken) break
    }
    return NextResponse.json({ profiles: all })
  } catch (e: any) {
    console.error('[Profiles] Error:', e.message)
    return NextResponse.json({ error: e.message || 'Failed to fetch profiles' }, { status: 500 })
  }
}
