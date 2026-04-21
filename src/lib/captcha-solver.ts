/**
 * Background CAPTCHA solver. Connects to a browser-use session via CDP,
 * screenshots the page, asks Claude vision to locate the puzzle's tile boxes
 * + Verify button, and clicks them with synthetic mouse events.
 *
 * Why screenshot-and-click instead of DOM detection: FB's reCAPTCHA lives in
 * deeply-nested cross-origin iframes that puppeteer can't reliably probe via
 * frame.evaluate(). But page.mouse.click(x, y) works at the OS-input level —
 * cross-origin iframe boundaries don't matter for synthetic mouse events.
 *
 * The BU agent is told to STOP and wait whenever it sees a CAPTCHA so we don't
 * race for the cursor.
 */
import puppeteer from 'puppeteer'
import type { Browser, Page } from 'puppeteer'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface CaptchaWatcherHandle {
  abort: () => void
  done: Promise<void>
}

interface VisionResult {
  visible: boolean
  prompt?: string
  tilesToClick?: { x: number; y: number }[]
  verifyButton?: { x: number; y: number }
  checkbox?: { x: number; y: number }
  reason?: string
}

export function startCaptchaWatcher(
  cdpHttpsUrl: string,
  anthropicKey: string,
  label: string,
): CaptchaWatcherHandle {
  const ctrl = new AbortController()
  const log = (msg: string) => console.log(`[Captcha ${label}] ${msg}`)

  const done = (async () => {
    let browser: Browser | null = null
    try {
      const versionRes = await fetch(`${cdpHttpsUrl.replace(/\/$/, '')}/json/version`)
      if (!versionRes.ok) throw new Error(`/json/version → ${versionRes.status}`)
      const version: any = await versionRes.json()
      const wsEndpoint = version.webSocketDebuggerUrl
      if (!wsEndpoint) throw new Error('no webSocketDebuggerUrl in /json/version response')
      log(`Resolved wsEndpoint=${wsEndpoint.slice(0, 90)}`)

      browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null })
      log('CDP connected')

      let lastSolveAt = 0
      let iter = 0
      while (!ctrl.signal.aborted) {
        iter++
        try {
          const pages = await browser.pages()
          const fbPage = pages.find(p => /facebook\.com/.test(p.url())) || pages[0]
          if (!fbPage) { if (iter % 4 === 0) log(`no FB page found`); await sleep(2500); continue }

          // Throttle so we don't re-solve while FB is animating the result of our click
          if (Date.now() - lastSolveAt < 4000) { await sleep(1000); continue }

          if (iter % 5 === 1) log(`[iter ${iter}] url=${fbPage.url().slice(0, 70)}`)

          const result = await analyzeAndSolve(fbPage, anthropicKey, log, iter)
          if (result === 'solved') {
            lastSolveAt = Date.now()
          }
        } catch (e: any) {
          log(`[iter ${iter}] fatal: ${e.message}`)
        }
        await sleep(2000)
      }
    } catch (e: any) {
      log(`fatal: ${e.message}`)
    } finally {
      if (browser) { try { await browser.disconnect() } catch {} }
      log('Stopped')
    }
  })()

  return { abort: () => ctrl.abort(), done }
}

/**
 * Screenshot the visible viewport, ask Claude vision if a captcha is visible,
 * and if so, click the tiles + Verify button.
 */
async function analyzeAndSolve(
  page: Page,
  anthropicKey: string,
  log: (m: string) => void,
  iter: number,
): Promise<'solved' | 'no-captcha' | 'error'> {
  let screenshot: string
  let viewportWidth = 0
  let viewportHeight = 0
  try {
    const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    viewportWidth = dims.w
    viewportHeight = dims.h
    screenshot = await page.screenshot({ encoding: 'base64', fullPage: false }) as string
  } catch (e: any) {
    if (iter % 5 === 1) log(`  screenshot err: ${e.message?.slice(0, 80)}`)
    return 'error'
  }

  const t0 = Date.now()
  const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 600,
      system: 'You analyze reCAPTCHA screenshots. You may briefly reason about what you see, but your response MUST end with exactly one JSON object on its own (the caller extracts the last balanced {...} block). No markdown code fences. Be deliberate and accurate — a wrong tile costs the user a re-attempt.',
      messages: [
        {
          role: 'user',
          content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } },
          {
            type: 'text',
            text: `You are looking at a screenshot of a Facebook page (viewport ${viewportWidth}×${viewportHeight}px). Determine if a reCAPTCHA image-grid puzzle is currently visible on the page.

A reCAPTCHA puzzle has:
- A blue header bar at the top with text like "Select all images with [TARGET]" or "Select all squares with [TARGET]" (e.g., "motorcycles", "buses", "fire hydrants", "crosswalks", "bicycles", "traffic lights")
- A 3×3 grid of 9 image tiles OR a 4×4 grid of 16 image tiles below it
- A bottom bar with a blue button labeled VERIFY (3×3 mode) or NEXT (4×4 multi-round mode), plus small refresh/audio/info icons on the bottom-left

CRITICAL TILE-IDENTIFICATION RULES:
- The puzzle is ONE photograph divided into a grid of EQUAL-SIZED rectangular tile cells (each tile is a discrete box with visible white/grey gridlines between them).
- The target object's pixels often span multiple adjacent tile cells. You must identify which TILE BOXES contain ANY visible pixels of the target object — not pixel locations of the object itself.
- Be moderately strict: a tile is a match if it contains a clear, recognizable portion of the target (wheel, body, mirror, etc.). A tile with only road/sky/sidewalk/shadow next to the object is NOT a match.
- Under-select rather than over-select. A missed tile is recoverable on the next round; a wrong tile in 4×4 NEXT mode triggers an extra round, and in 3×3 VERIFY mode it fails the whole puzzle.

If a puzzle IS visible, respond with ONLY this JSON (no other text, no markdown fences):
{
  "visible": true,
  "prompt": "<the target word, lowercase, e.g. 'motorcycles'>",
  "tilesToClick": [{"x": <pixel x of TILE CENTER>, "y": <pixel y of TILE CENTER>}, ...],
  "verifyButton": {"x": <pixel x of CENTER of VERIFY/NEXT button>, "y": <pixel y of CENTER of VERIFY/NEXT button>}
}

For each tile in tilesToClick, give the pixel coordinate at the CENTER of that tile box (not the center of the object inside it). If the puzzle has 9 tiles in a 3×3 grid and tile (row 0, col 1) and (row 2, col 2) match, return their two center pixels.

SPECIAL CASE — "I'm not a robot" CHECKBOX (no image grid yet):
If you see a small reCAPTCHA widget with an unchecked "I'm not a robot" checkbox (a square next to the text "I'm not a robot", with the reCAPTCHA logo on the right) but NO image-grid puzzle has appeared yet, return:
{"visible": true, "checkbox": {"x": <pixel x of CENTER of the checkbox square>, "y": <pixel y of CENTER of the checkbox square>}}
Do NOT include tilesToClick or verifyButton in this case.

If NO puzzle and NO checkbox is visible (the page shows a feed, login form, 2FA prompt, "Save your login info?" page, blank page, anything else), respond with ONLY:
{"visible": false, "reason": "<one short phrase, e.g. 'login form', 'feed visible', '2FA prompt', 'blank page'>"}

You may briefly reason before answering. Your response MUST end with the JSON object — the caller extracts the LAST balanced {...} block.`,
          },
        ],
      },
      ],
    }),
  }).then(r => r.json()).catch((e: any) => ({ error: { message: e.message } })) as any

  const elapsed = Date.now() - t0
  if (visionRes.error) {
    if (iter % 5 === 1) log(`  vision err (${elapsed}ms): ${visionRes.error?.message?.slice(0, 120)}`)
    return 'error'
  }

  const replyText: string = visionRes.content?.[0]?.text?.trim() || ''
  let parsed: VisionResult
  try {
    parsed = JSON.parse(extractJson(replyText))
  } catch {
    log(`  vision returned non-JSON (${elapsed}ms): ${replyText.slice(0, 120)}`)
    return 'error'
  }

  if (!parsed.visible) {
    if (iter % 5 === 1) log(`  no captcha (${elapsed}ms): ${parsed.reason || ''}`)
    return 'no-captcha'
  }

  if (parsed.checkbox && typeof parsed.checkbox.x === 'number' && typeof parsed.checkbox.y === 'number') {
    log(`✓ "I'm not a robot" checkbox — clicking (${parsed.checkbox.x}, ${parsed.checkbox.y}) (vision ${elapsed}ms)`)
    try {
      await page.mouse.click(parsed.checkbox.x, parsed.checkbox.y, { delay: 50 })
    } catch (e: any) {
      log(`  checkbox click err: ${e.message?.slice(0, 80)}`)
      return 'error'
    }
    return 'solved'
  }

  let tiles = parsed.tilesToClick || []
  let verify = parsed.verifyButton
  log(`✓ Captcha "${parsed.prompt}" — ${tiles.length} tiles to click (vision ${elapsed}ms)`)

  if (!verify || typeof verify.x !== 'number' || typeof verify.y !== 'number') {
    log(`  ✗ no verify button coords, skipping`)
    return 'error'
  }

  // Click the initial set of tiles. After clicking, some 3×3 "Verify" puzzles silently
  // refill the selected tiles with new images that may also match the prompt. Wait, then
  // re-screenshot to catch any refilled tiles before pressing Verify.
  await clickTiles(page, tiles, viewportWidth, viewportHeight, log)

  // Re-evaluation rounds: up to 3 extra refill rounds (Verify-mode can chain a few times)
  for (let round = 0; round < 3; round++) {
    await sleep(6000) // let refilled images load
    const recheck = await visionScreenshot(page, anthropicKey, log)
    if (!recheck) break
    if (!recheck.visible) {
      log(`  refill round ${round + 1}: captcha gone, skipping verify`)
      return 'solved'
    }
    const more = recheck.tilesToClick || []
    if (more.length === 0) {
      log(`  refill round ${round + 1}: 0 new matches → clicking verify`)
      verify = recheck.verifyButton || verify
      break
    }
    log(`  refill round ${round + 1}: ${more.length} more tiles to click`)
    await clickTiles(page, more, viewportWidth, viewportHeight, log)
    verify = recheck.verifyButton || verify
  }

  await sleep(800)
  try {
    await page.mouse.click(verify.x, verify.y, { delay: 50 })
    log(`  → clicked verify (${verify.x}, ${verify.y})`)
  } catch (e: any) {
    log(`  verify click err: ${e.message?.slice(0, 80)}`)
    return 'error'
  }

  return 'solved'
}

async function clickTiles(
  page: Page,
  tiles: { x: number; y: number }[],
  vw: number,
  vh: number,
  log: (m: string) => void,
): Promise<void> {
  for (const tile of tiles) {
    if (typeof tile.x !== 'number' || typeof tile.y !== 'number') continue
    if (tile.x < 0 || tile.y < 0 || tile.x > vw || tile.y > vh) {
      log(`  ✗ tile (${tile.x}, ${tile.y}) out of viewport, skipping`)
      continue
    }
    try {
      await page.mouse.click(tile.x, tile.y, { delay: 50 })
      await sleep(300)
    } catch (e: any) {
      log(`  tile click (${tile.x}, ${tile.y}) err: ${e.message?.slice(0, 80)}`)
    }
  }
}

/** Take a fresh screenshot and parse vision response. Returns null on error. */
async function visionScreenshot(
  page: Page,
  anthropicKey: string,
  log: (m: string) => void,
): Promise<VisionResult | null> {
  let screenshot: string
  let viewportWidth = 0
  let viewportHeight = 0
  try {
    const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    viewportWidth = dims.w
    viewportHeight = dims.h
    screenshot = await page.screenshot({ encoding: 'base64', fullPage: false }) as string
  } catch (e: any) {
    log(`  recheck screenshot err: ${e.message?.slice(0, 80)}`)
    return null
  }

  const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 600,
      system: 'You analyze reCAPTCHA screenshots. You may briefly reason about what you see, but your response MUST end with exactly one JSON object on its own (the caller extracts the last balanced {...} block). No markdown code fences. Be deliberate and accurate — a wrong tile costs the user a re-attempt.',
      messages: [
        {
          role: 'user',
          content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } },
          {
            type: 'text',
            text: `Screenshot of a Facebook page (viewport ${viewportWidth}×${viewportHeight}px). This is a RE-CHECK after we already clicked some tiles in a reCAPTCHA puzzle.

DEFAULT: tilesToClick = []. ONLY add a tile if you are CERTAIN it (a) is still un-selected and (b) clearly contains the target object. When in doubt, leave it out — the next round/Verify will catch it. A wrong extra click costs the user the whole puzzle.

Selected tiles ALWAYS have a visible indicator: a blue checkmark in a corner, a darker blue overlay over the tile, OR a thick blue border. NEVER return a tile that has any of these — clicking it again deselects it and breaks the solve.

Mode notes:
- 4×4 NEXT mode (button says "NEXT" or "SKIP"): previously-clicked tiles are REPLACED with brand-new images. Only return a replacement tile if it OBVIOUSLY contains the target. A faint hint or a sliver of road/sky is NOT enough.
- 3×3 VERIFY mode (button says "VERIFY"): previously-clicked tiles stay highlighted with the indicator and are NOT replaced. tilesToClick should almost always be []. Only add a tile if a previously-missed un-selected tile clearly shows the target.

You may briefly think out loud first. Your response MUST end with one JSON object on its own line. The caller extracts the LAST balanced {...} block.

If a puzzle is visible:
{"visible": true, "prompt": "<target word lowercase>", "tilesToClick": [{"x": <pixel>, "y": <pixel>}, ...], "verifyButton": {"x": <pixel>, "y": <pixel>}}

If NO puzzle visible:
{"visible": false, "reason": "<short phrase>"}`,
          },
        ],
      },
      ],
    }),
  }).then(r => r.json()).catch(() => null) as any

  if (!visionRes || visionRes.error) {
    log(`  recheck vision err: ${visionRes?.error?.message?.slice(0, 100) || 'no response'}`)
    return null
  }

  const replyText: string = visionRes.content?.[0]?.text?.trim() || ''
  try {
    return JSON.parse(extractJson(replyText))
  } catch {
    log(`  recheck non-JSON: ${replyText.slice(0, 100)}`)
    return null
  }
}

/**
 * Extract the LAST balanced {...} JSON object from a string. Vision may emit
 * reasoning prose (which can contain stray { chars) before the final JSON, so
 * we scan from the end: find the last `}` and walk backward matching braces.
 */
function extractJson(s: string): string {
  const fenced = s.replace(/```(?:json)?\s*|\s*```/g, '')
  const end = fenced.lastIndexOf('}')
  if (end < 0) return fenced
  let depth = 0
  let inStr = false
  for (let i = end; i >= 0; i--) {
    const ch = fenced[i]
    if (inStr) {
      if (ch === '"' && fenced[i - 1] !== '\\') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '}') depth++
    else if (ch === '{') { depth--; if (depth === 0) return fenced.slice(i, end + 1) }
  }
  return fenced.slice(0, end + 1)
}
