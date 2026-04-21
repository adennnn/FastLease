import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'BROWSER_USE_API_KEY not set' }, { status: 500 })

  const { sessionId } = await req.json().catch(() => ({ sessionId: null }))
  if (!sessionId || typeof sessionId !== 'string') {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const runtimeRequire = eval('require') as NodeRequire
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  const client = new BrowserUse({ apiKey })

  try {
    await client.sessions.stop(sessionId)
    return NextResponse.json({ stopped: sessionId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'stop failed', sessionId }, { status: 500 })
  }
}
