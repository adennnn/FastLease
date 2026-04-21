import { NextRequest, NextResponse } from 'next/server'

/**
 * Read-only sync of current Facebook profile state for a single account.
 *
 * Fires a single browser-use session (bu-max, like fetch-profile-url) that
 * navigates to facebook.com/me and reads back the live name, bio, profile
 * pic URL, cover URL, city, and a short list of currently-visible timeline
 * items. Server-side then fetches the scontent.fbcdn.net image URLs (which
 * are signed and expire) and returns them as base64 data URLs so the client
 * can drop them straight into IndexedDB / render them immediately — matching
 * the format the warmup flow already uses for generated images.
 *
 * Called per-account by the "Sync latest data" button in the Warm Accounts
 * tab. The client fires these concurrently with a small concurrency cap.
 */

export async function POST(req: NextRequest) {
  const { profileId } = await req.json()
  if (!profileId) return NextResponse.json({ error: 'No profileId' }, { status: 400 })

  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk/v3')
  const client = new BrowserUse({ apiKey })

  const prompt = `Read-only data-gathering task. Already logged into Facebook — do NOT log in, do NOT post, do NOT edit anything, do NOT click any destructive buttons, do NOT send messages. Just look and read.

1. Navigate to https://www.facebook.com/me and wait 4 seconds for the page to fully render.

2. Read these values from the rendered profile page:
   - firstName and lastName: split the display name shown in the large heading (h1) next to the profile picture. If the heading is "Alex Rivera", firstName="Alex" and lastName="Rivera". If it's a single word, put it all in firstName and leave lastName empty.
   - bio: the short tagline / bio text shown directly under the name on the profile (one short line, usually with emojis or pipes). If there is none, use "".
   - profilePicUrl: the src URL of the main profile picture image — the round avatar at the top-left of the profile. Should look like https://scontent.*.fbcdn.net/....jpg or .webp with a long signed query string.
   - coverUrl: the src URL of the cover photo — the wide banner at the very top of the profile. Same URL format.
   - city: the city shown in "Lives in" or "From" in the Intro card on the left side. If none visible, use "".
   - attachments: a list of the 5 most recent visible items on the profile timeline (posts, photos, shares, life events). Each item should be one short line like "Mar 2: photo of dog in park" or "Feb 10: shared news article about rates" or "Jan 15: status update about work". Only list items visible without scrolling past the first ~2 viewports — do NOT scroll forever.

3. Output EXACTLY ONE line of compact JSON matching this schema — no markdown, no code fences, no commentary, no extra text:
{"firstName":"...","lastName":"...","bio":"...","profilePicUrl":"...","coverUrl":"...","city":"...","attachments":["..."]}

If a field can't be read, set it to an empty string (or [] for attachments) and still output the JSON. Never skip the output step.`

  try {
    const result = await client.run(prompt, {
      model: 'bu-max',
      maxCostUsd: 1.0,
      proxyCountryCode: 'us',
      timeout: 240000,
      profileId,
    })
    const output: string = (result.output || '').trim()

    // Grab the first JSON object in the output — models occasionally leak
    // extra prose even with "output only JSON" instructions.
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Agent did not return JSON', raw: output.slice(0, 500) }, { status: 500 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e: any) {
      return NextResponse.json({ error: `JSON parse failed: ${e.message}`, raw: output.slice(0, 500) }, { status: 500 })
    }

    // scontent.fbcdn.net URLs are public but signed and short-lived — fetch
    // them server-side now and return as base64 data URLs to match the
    // profilePic/banner shape the warmup flow already consumes.
    const fetchAsDataUrl = async (url: string | undefined | null): Promise<string | null> => {
      if (!url || typeof url !== 'string') return null
      if (!/^https?:\/\//i.test(url)) return null
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          },
        })
        if (!res.ok) return null
        const ct = res.headers.get('content-type') || 'image/jpeg'
        if (!ct.startsWith('image/')) return null
        const ab = await res.arrayBuffer()
        // Guard against insanely large payloads (>8MB) — FB covers in
        // particular can be huge; clients persist these to IDB.
        if (ab.byteLength > 8 * 1024 * 1024) return null
        const b64 = Buffer.from(ab).toString('base64')
        return `data:${ct};base64,${b64}`
      } catch {
        return null
      }
    }

    const [profilePicDataUrl, bannerDataUrl] = await Promise.all([
      fetchAsDataUrl(parsed.profilePicUrl),
      fetchAsDataUrl(parsed.coverUrl),
    ])

    const safeString = (v: any) => (typeof v === 'string' ? v : '')
    const safeList = (v: any): string[] =>
      Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()).slice(0, 10) : []

    return NextResponse.json({
      firstName: safeString(parsed.firstName).trim(),
      lastName: safeString(parsed.lastName).trim(),
      bio: safeString(parsed.bio).trim(),
      city: safeString(parsed.city).trim(),
      profilePicDataUrl,
      bannerDataUrl,
      attachments: safeList(parsed.attachments),
    })
  } catch (e: any) {
    // Same defensive error unpacking as fetch-profile-url — the SDK often
    // wraps a response body into an opaque Error whose .message is just
    // "[object Object]".
    const shape = {
      message: e?.message,
      name: e?.name,
      status: e?.status,
      responseBody: e?.responseBody,
      body: e?.body,
      stringified: (() => {
        try {
          return JSON.stringify(e, Object.getOwnPropertyNames(e || {}))
        } catch {
          return null
        }
      })(),
    }
    console.error('[sync-account-info] FULL ERROR SHAPE:', JSON.stringify(shape, null, 2))

    const candidates = [
      typeof e?.message === 'string' && e.message !== '[object Object]' ? e.message : null,
      typeof e?.response?.data?.error === 'string' ? e.response.data.error : null,
      shape.stringified && shape.stringified !== '{}' ? shape.stringified : null,
    ].filter(Boolean) as string[]

    return NextResponse.json(
      { error: candidates[0] || 'Sync failed (unknown SDK error)' },
      { status: 500 },
    )
  }
}
