import { NextRequest, NextResponse } from 'next/server'

/**
 * Status poll for a browser-use session. The warmup SSE stream emits the
 * sessionId to the client as soon as it knows it; the client persists it to
 * localStorage. On page reload, the client calls this endpoint every few
 * seconds with that id to resurrect the live view (liveUrl) and know when
 * the step has finished.
 *
 * Response shape:
 *   { status: 'running' | 'idle' | 'stopped' | 'error' | 'completed' | 'timed_out',
 *     liveUrl?: string, output?: string }
 *
 * Anything terminal (stopped / error / completed / timed_out) tells the client
 * to clear the running badge.
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get('sid')
  if (!sid) {
    return NextResponse.json({ error: 'Missing sid query param' }, { status: 400 })
  }

  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })
  }

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk/v3')
  const client = new BrowserUse({ apiKey })

  try {
    const session: any = await client.sessions.get(sid)
    return NextResponse.json({
      status: session?.status || 'unknown',
      liveUrl: session?.liveUrl || null,
      output: typeof session?.output === 'string' ? session.output : null,
    })
  } catch (e: any) {
    // Unknown sid / already cleaned up → treat as stopped so the client can clear state.
    const msg = typeof e?.message === 'string' ? e.message : JSON.stringify(e || {})
    return NextResponse.json({ status: 'stopped', error: msg.slice(0, 200) }, { status: 200 })
  }
}

/** POST to stop a running session (user-initiated abort). */
export async function POST(req: NextRequest) {
  const { sid } = await req.json().catch(() => ({}))
  if (!sid) return NextResponse.json({ error: 'Missing sid' }, { status: 400 })

  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk/v3')
  const client = new BrowserUse({ apiKey })

  try {
    await client.sessions.stop(sid)
    return NextResponse.json({ stopped: true })
  } catch (e: any) {
    return NextResponse.json({ error: typeof e?.message === 'string' ? e.message : 'Stop failed' }, { status: 500 })
  }
}
