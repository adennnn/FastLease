import { NextResponse } from 'next/server'

const V3_BASE = 'https://api.browser-use.com/api/v3'

export async function GET() {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })
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
      const res = await fetch(url.toString(), {
        headers: { 'X-Browser-Use-API-Key': apiKey },
        cache: 'no-store',
      })
      if (!res.ok) {
        const text = await res.text()
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
