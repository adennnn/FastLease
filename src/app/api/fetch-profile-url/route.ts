import { NextRequest, NextResponse } from 'next/server'

/**
 * Cheap one-shot browser-use task: navigate to facebook.com/me, wait for the
 * redirect, and return whatever the final URL is (profile.php?id=N or /username).
 * Uses bu-mini — takes ~15s and costs pennies.
 */
export async function POST(req: NextRequest) {
  const { profileId } = await req.json()
  if (!profileId) return NextResponse.json({ error: 'No profileId' }, { status: 400 })

  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk/v3')
  const client = new BrowserUse({ apiKey })

  const prompt = `Short task. Already logged into Facebook — do NOT log in, do NOT post, do NOT click anything extra.

1. Navigate to https://www.facebook.com/me
2. Wait 3 seconds for the redirect to finish. The URL in the address bar will become one of:
   - https://www.facebook.com/profile.php?id=NNNNNNNNNNNN
   - https://www.facebook.com/some.username
3. Read the exact URL from the address bar.

FINAL OUTPUT: output the exact URL on a single line with no other text, no quotes, no punctuation.
Example of a valid output: https://www.facebook.com/profile.php?id=100012345678901`

  try {
    // v3 SDK only accepts 'bu-mini' | 'bu-max'. Earlier attempts used
    // 'claude-sonnet-4-6' with an `as any` cast — the API returned 422 every
    // time ("BrowserUseError: [object Object]"). bu-max is the strongest valid
    // v3 model; use it so this one-shot task never silently fails.
    const result = await client.run(prompt, {
      model: 'bu-max',
      maxCostUsd: 1.00,
      proxyCountryCode: 'us',
      timeout: 180000,
      profileId,
    })

    const output: string = (result.output || '').trim()
    const match = output.match(/https?:\/\/[^\s"'<>]+facebook\.com[^\s"'<>]*/i)
    const profileUrl = match ? match[0] : ''
    if (!profileUrl) {
      return NextResponse.json({ error: 'Could not detect URL from agent output', raw: output }, { status: 500 })
    }
    return NextResponse.json({ profileUrl })
  } catch (e: any) {
    // Dump EVERYTHING we can extract from the error — SDK frequently wraps a response
    // body into an opaque Error whose .message is just "[object Object]".
    const shape = {
      message: e?.message,
      name: e?.name,
      code: e?.code,
      status: e?.status,
      statusCode: e?.statusCode,
      response: e?.response,
      responseBody: e?.responseBody,
      body: e?.body,
      error: e?.error,
      cause: e?.cause,
      keys: e ? Object.keys(e) : [],
      ownProps: e ? Object.getOwnPropertyNames(e) : [],
      stringified: (() => { try { return JSON.stringify(e, Object.getOwnPropertyNames(e || {})) } catch { return null } })(),
      typeofErr: typeof e,
      toStringResult: (() => { try { return String(e) } catch { return null } })(),
    }
    console.error('[fetch-profile-url] FULL ERROR SHAPE:', JSON.stringify(shape, null, 2))

    // Best-effort human message.
    const candidates = [
      typeof e?.message === 'string' && e.message !== '[object Object]' ? e.message : null,
      typeof e?.response?.data?.error === 'string' ? e.response.data.error : null,
      typeof e?.response?.data?.message === 'string' ? e.response.data.message : null,
      e?.response?.data ? JSON.stringify(e.response.data) : null,
      e?.body ? JSON.stringify(e.body) : null,
      shape.stringified && shape.stringified !== '{}' ? shape.stringified : null,
    ].filter(Boolean) as string[]

    const asString = candidates[0] || 'Fetch failed (unknown SDK error)'
    return NextResponse.json({ error: asString, debug: shape }, { status: 500 })
  }
}
