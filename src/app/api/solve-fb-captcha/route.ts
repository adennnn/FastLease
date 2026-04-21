import { NextRequest, NextResponse } from 'next/server'

/**
 * CapSolver proxy for FB image-grid CAPTCHAs.
 * Body: { imageBase64, question } — image of the puzzle grid + the target word ("bicycle", "motorcycle", "bus", ...)
 * Returns: { tiles: boolean[] } — for a 3x3 grid, 9 booleans top-left to bottom-right; true = click that tile.
 */
const CAPSOLVER = 'https://api.capsolver.com'

export async function POST(req: NextRequest) {
  const apiKey = process.env.CAPSOLVER_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'CAPSOLVER_API_KEY not set' }, { status: 500 })

  const { imageBase64, question } = await req.json()
  if (!imageBase64 || !question) {
    return NextResponse.json({ error: 'Missing imageBase64 or question' }, { status: 400 })
  }

  const cleanImage = String(imageBase64).replace(/^data:image\/\w+;base64,/, '')

  try {
    const createRes = await fetch(`${CAPSOLVER}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          // Works for FB grids — same 3x3/4x4 image classification format as reCAPTCHA v2.
          type: 'ReCaptchaV2Classification',
          image: cleanImage,
          question,
        },
      }),
    })
    const createData = await createRes.json()
    if (createData.errorId !== 0) {
      return NextResponse.json({ error: createData.errorDescription || 'CapSolver createTask failed' }, { status: 502 })
    }

    const taskId = createData.taskId

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const pollRes = await fetch(`${CAPSOLVER}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      })
      const pollData = await pollRes.json()
      if (pollData.status === 'ready') {
        const tiles: boolean[] = pollData.solution?.objects || []
        console.log(`[CapSolver] Solved "${question}" → ${tiles.map((b, i) => b ? i : null).filter(x => x !== null).join(',')}`)
        return NextResponse.json({ tiles })
      }
      if (pollData.errorId && pollData.errorId !== 0) {
        return NextResponse.json({ error: pollData.errorDescription || 'CapSolver task failed' }, { status: 502 })
      }
    }
    return NextResponse.json({ error: 'CapSolver timeout' }, { status: 504 })
  } catch (e: any) {
    console.error('[CapSolver] Error:', e.message)
    return NextResponse.json({ error: e.message || 'CapSolver request failed' }, { status: 500 })
  }
}
