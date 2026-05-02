/**
 * Background CAPTCHA solver. Connects to a BU or Browserbase session via CDP,
 * finds the puzzle grid with one Claude vision call, and classifies the tiles
 * with CapSolver's ReCaptchaV2Classification task (99%+ accuracy, trained CNN
 * specifically for image-grid captchas). Clicks the matching tiles + Verify
 * via synthetic mouse events over CDP.
 *
 * Why the hybrid (Claude + CapSolver): Claude is good at layout detection
 * (bounding boxes, button locations) but unreliable on tile classification.
 * CapSolver is the opposite — purpose-built for tile classification, but it
 * needs a tight crop of just the grid. So: Claude finds the grid, CapSolver
 * reads it, puppeteer clicks it.
 *
 * Why screenshot-and-click instead of DOM detection: FB's reCAPTCHA lives in
 * deeply-nested cross-origin iframes that puppeteer can't reliably probe via
 * frame.evaluate(). But page.mouse.click(x, y) works at the OS-input level —
 * cross-origin iframe boundaries don't matter for synthetic mouse events.
 *
 * The BU/BB agent is told to STOP and wait whenever it sees a CAPTCHA so we
 * don't race for the cursor.
 */
import puppeteer from 'puppeteer'
import type { Browser, Page } from 'puppeteer'
import sharp from 'sharp'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const CAPSOLVER_URL = 'https://api.capsolver.com'

export interface CaptchaWatcherHandle {
  abort: () => void
  done: Promise<void>
}

interface LayoutResult {
  visible: boolean
  prompt?: string
  /** Pixel bbox of the grid area only (no header, no footer/buttons). */
  grid?: { x: number; y: number; w: number; h: number }
  /** Grid dimensions (3 = 3x3, 4 = 4x4). */
  gridSize?: 3 | 4
  /** Verify / Next button center pixel coords. */
  verifyButton?: { x: number; y: number }
  /** "I'm not a robot" checkbox, seen before the puzzle appears. */
  checkbox?: { x: number; y: number }
  reason?: string
}

/**
 * Start a captcha watcher from either:
 *  - a BU-style HTTPS CDP URL (`cdpHttpsUrl`) — we fetch /json/version to
 *    resolve the ws endpoint, or
 *  - a direct WSS endpoint (`wsEndpoint`) — used by Browserbase, which exposes
 *    the puppeteer-compatible URL directly via sessions.connectUrl.
 */
export function startCaptchaWatcher(
  target: string | { wsEndpoint: string },
  anthropicKey: string,
  label: string,
): CaptchaWatcherHandle {
  const ctrl = new AbortController()
  const log = (msg: string) => console.log(`[Captcha ${label}] ${msg}`)

  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY
  if (!twoCaptchaKey) {
    log('TWOCAPTCHA_API_KEY missing — captcha solver cannot classify tiles and will fail')
  }

  const done = (async () => {
    let browser: Browser | null = null
    try {
      let wsEndpoint: string
      if (typeof target === 'string') {
        const versionRes = await fetch(`${target.replace(/\/$/, '')}/json/version`)
        if (!versionRes.ok) throw new Error(`/json/version → ${versionRes.status}`)
        const version: any = await versionRes.json()
        wsEndpoint = version.webSocketDebuggerUrl
        if (!wsEndpoint) throw new Error('no webSocketDebuggerUrl in /json/version response')
      } else {
        wsEndpoint = target.wsEndpoint
      }
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

          if (Date.now() - lastSolveAt < 2000) { await sleep(500); continue }

          if (iter % 5 === 1) log(`[iter ${iter}] url=${fbPage.url().slice(0, 70)}`)

          const result = await analyzeAndSolve(fbPage, anthropicKey, twoCaptchaKey, log, iter)
          if (result === 'solved') {
            lastSolveAt = Date.now()
          }
        } catch (e: any) {
          log(`[iter ${iter}] fatal: ${e.message}`)
        }
        await sleep(1000)
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

async function screenshotPage(page: Page, log: (m: string) => void): Promise<{ png: Buffer; w: number; h: number } | null> {
  try {
    const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    const b64 = await page.screenshot({ encoding: 'base64', fullPage: false }) as string
    return { png: Buffer.from(b64, 'base64'), w: dims.w, h: dims.h }
  } catch (e: any) {
    log(`  screenshot err: ${e.message?.slice(0, 80)}`)
    return null
  }
}

/**
 * Detect whether a captcha is visible and where. One Claude vision call; we
 * only ask for layout (bbox, target word, verify button) — NOT tile
 * classification. CapSolver does the tile work.
 */
async function detectLayout(
  screenshotPng: Buffer,
  viewportW: number,
  viewportH: number,
  anthropicKey: string,
  log: (m: string) => void,
): Promise<LayoutResult | null> {
  const b64 = screenshotPng.toString('base64')
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: 'You analyze reCAPTCHA screenshots and return layout metadata. Be precise with pixel coordinates. Respond with ONE JSON object, no markdown fences. The caller extracts the LAST balanced {...} block.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: `Screenshot of a Facebook page (viewport ${viewportW}×${viewportH}px). Is a reCAPTCHA-style image-grid puzzle visible? A puzzle has:
- Blue header bar with "Select all images with X" or "Select all squares with X"
- A 3×3 (9 tiles) or 4×4 (16 tiles) grid of equal-sized image tiles
- Bottom bar with a blue VERIFY or NEXT button, plus small refresh/audio/info icons

If a puzzle IS visible, return ONLY this JSON:
{
  "visible": true,
  "prompt": "<target word lowercase, e.g. 'bus', 'bicycle', 'motorcycle', 'traffic light', 'crosswalk', 'fire hydrant'>",
  "grid": {"x": <left pixel>, "y": <top pixel>, "w": <width>, "h": <height>},
  "gridSize": <3 or 4>,
  "verifyButton": {"x": <center x>, "y": <center y>}
}

CRITICAL for grid bbox: the "grid" field is the bounding box of the TILE AREA ONLY — do NOT include the blue header or the bottom button bar. It should hug the outer edges of the 3×3 or 4×4 tile cells. Be pixel-accurate.

SPECIAL CASE — "I'm not a robot" CHECKBOX (widget visible, no puzzle yet):
{"visible": true, "checkbox": {"x": <center x>, "y": <center y>}}

If nothing captcha-like is visible (feed, login form, 2FA prompt, etc.):
{"visible": false, "reason": "<short phrase>"}

Respond with ONLY the JSON.` },
        ],
      }],
    }),
  }).then(r => r.json()).catch((e: any) => ({ error: { message: e.message } })) as any

  const elapsed = Date.now() - t0
  if (res.error) {
    log(`  layout vision err (${elapsed}ms): ${res.error?.message?.slice(0, 120)}`)
    return null
  }
  const reply: string = res.content?.[0]?.text?.trim() || ''
  try {
    const parsed = JSON.parse(extractJson(reply)) as LayoutResult
    if (parsed.visible && parsed.grid) {
      log(`  layout (${elapsed}ms): "${parsed.prompt}" ${parsed.gridSize}×${parsed.gridSize} grid at (${parsed.grid.x},${parsed.grid.y}) ${parsed.grid.w}×${parsed.grid.h}`)
    }
    return parsed
  } catch {
    log(`  layout non-JSON (${elapsed}ms): ${reply.slice(0, 100)}`)
    return null
  }
}

/**
 * CapSolver's ReCaptchaV2Classification only accepts Google Knowledge Graph
 * MIDs (e.g. "/m/015qff" for traffic lights) — plain strings like "traffic
 * light" get rejected with `ml.service: not support question`. This map
 * covers every class Meta/reCAPTCHA has been observed to use. Keys are
 * lowercased banner text; include both singular and plural forms since Meta
 * writes plurals ("Select all squares with buses") while reCAPTCHA often
 * uses singular.
 */
const TARGET_TO_MID: Record<string, string> = {
  bus: '/m/01bjv',
  buses: '/m/01bjv',
  'school bus': '/m/02yvhj',
  'school buses': '/m/02yvhj',
  bicycle: '/m/0199g',
  bicycles: '/m/0199g',
  motorcycle: '/m/04_sv',
  motorcycles: '/m/04_sv',
  car: '/m/0k4j',
  cars: '/m/0k4j',
  taxi: '/m/0pg52',
  taxis: '/m/0pg52',
  boat: '/m/019jd',
  boats: '/m/019jd',
  tractor: '/m/013xlm',
  tractors: '/m/013xlm',
  'fire hydrant': '/m/01pns0',
  'fire hydrants': '/m/01pns0',
  'traffic light': '/m/015qff',
  'traffic lights': '/m/015qff',
  crosswalk: '/m/014xcs',
  crosswalks: '/m/014xcs',
  bridge: '/m/015kr',
  bridges: '/m/015kr',
  chimney: '/m/01jk_4',
  chimneys: '/m/01jk_4',
  stair: '/m/01lynh',
  stairs: '/m/01lynh',
  'palm tree': '/m/0cdl1',
  'palm trees': '/m/0cdl1',
  mountain: '/m/09d_r',
  mountains: '/m/09d_r',
  hill: '/m/09d_r',
  hills: '/m/09d_r',
  'mountains or hills': '/m/09d_r',
  'parking meter': '/m/015qbp',
  'parking meters': '/m/015qbp',
}

function targetToMid(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/^(a |an |the )/, '')
  if (TARGET_TO_MID[cleaned]) return TARGET_TO_MID[cleaned]
  // Try naive de-pluralization as a last resort.
  let singular = cleaned
  if (cleaned.endsWith('ies')) singular = cleaned.slice(0, -3) + 'y'
  else if (cleaned.endsWith('es') && !cleaned.endsWith('ses')) singular = cleaned.slice(0, -2)
  else if (cleaned.endsWith('s') && !cleaned.endsWith('ss')) singular = cleaned.slice(0, -1)
  return TARGET_TO_MID[singular] || null
}

/**
 * Classify tiles with 2Captcha human workers. Every ML classifier (CapSolver,
 * Claude, Gemini, GPT-4V) has failed on Meta's captcha because Meta overlays
 * adversarial noise specifically tuned to break trained classifiers. Humans
 * are unaffected — they see through the grain instantly.
 *
 * Flow:
 *   1. POST the cropped grid PNG + target text to 2captcha.com/in.php.
 *   2. Poll res.php every 3s until status === 1 (typical solve: 10–25s).
 *   3. Parse "click:X/Y/Z" (1-indexed tiles) into a boolean[] of length n².
 *
 * Cost: ~$0.001 per grid. Balance check: GET /res.php?action=getbalance.
 */
async function classifyWith2Captcha(
  gridPng: Buffer,
  target: string,
  gridSize: number,
  apiKey: string,
  log: (m: string) => void,
): Promise<boolean[] | null> {
  const n = gridSize * gridSize
  const t0 = Date.now()
  const instruction = `Click on all squares that contain a ${target.replace(/^(a |an |the )/i, '').replace(/s$/, '')}. If none, submit without clicking.`

  try {
    // Submit.
    const form = new URLSearchParams({
      key: apiKey,
      method: 'base64',
      body: gridPng.toString('base64'),
      recaptcha: '1',
      recaptcharows: String(gridSize),
      recaptchacols: String(gridSize),
      textinstructions: instruction,
      json: '1',
    })
    const submitRes = await fetch('https://2captcha.com/in.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const submitJson: any = await submitRes.json()
    if (submitJson.status !== 1) {
      log(`  2captcha submit FAILED: status=${submitJson.status} error=${submitJson.request} (${Date.now() - t0}ms)`)
      return null
    }
    const taskId = submitJson.request
    log(`  2captcha submitted OK taskId=${taskId} target="${target}" grid=${gridSize}×${gridSize}`)

    // Poll.
    for (let i = 0; i < 40; i++) {
      await sleep(3000)
      const pollRes = await fetch(
        `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`,
      )
      const pollJson: any = await pollRes.json()
      if (pollJson.status === 1) {
        // Answer format: "click:3/5/8" (1-indexed). Sometimes just "click:" if
        // worker decided nothing matches.
        const answer: string = pollJson.request || ''
        const nums = (answer.match(/\d+/g) || []).map(Number)
        const tiles = new Array(n).fill(false) as boolean[]
        for (const num of nums) {
          const zeroIdx = num - 1
          if (zeroIdx >= 0 && zeroIdx < n) tiles[zeroIdx] = true
        }
        log(`  2captcha SOLVED (${Date.now() - t0}ms, poll ${i + 1}): answer="${answer}" → tiles=[${tiles.map((b, i) => b ? i : '·').join(',')}]`)
        return tiles
      }
      // status === 0 with request="CAPCHA_NOT_READY" means still working; any
      // other status=0 value is a hard error.
      if (pollJson.request && pollJson.request !== 'CAPCHA_NOT_READY') {
        log(`  2captcha poll ERROR (${Date.now() - t0}ms): ${pollJson.request}`)
        return null
      }
      if (i === 2 || i === 5 || i === 10 || i === 20) {
        log(`  2captcha still solving… ${(Date.now() - t0) / 1000}s elapsed`)
      }
    }
    log(`  2captcha TIMEOUT after 120s — abandoning task ${taskId}`)
    return null
  } catch (e: any) {
    log(`  2captcha fetch err (${Date.now() - t0}ms): ${e.message?.slice(0, 100)}`)
    return null
  }
}

/**
 * Classify tiles with Claude vision. Meta overlays grain/noise on its CAPTCHA
 * tiles that breaks CapSolver's trained CNN — CapSolver returns [] on images
 * that clearly contain buses/crosswalks/etc. Claude Opus sees through the
 * obfuscation and handles "Select all squares with" puzzles correctly.
 *
 * NOTE: unused — Claude vision also fails on Meta's adversarial noise. Kept
 * as a fallback / reference; classifyWith2Captcha is the active path.
 */
async function classifyWithClaude(
  gridPng: Buffer,
  target: string,
  gridSize: number,
  anthropicKey: string,
  log: (m: string) => void,
): Promise<boolean[] | null> {
  const b64 = gridPng.toString('base64')
  const t0 = Date.now()
  const n = gridSize * gridSize
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 300,
        system: 'You classify reCAPTCHA/Meta image grids. Be aggressive: if ANY recognizable part of the target object is in a tile (corner, edge, partial view), include it. Respond with ONE JSON object, no prose.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
            { type: 'text', text: `This is a cropped ${gridSize}×${gridSize} CAPTCHA grid (${n} tiles). Tiles are indexed 0..${n - 1} in reading order (top-left=0, increases left-to-right then top-to-bottom).

The target is: "${target}"

Note: Meta puzzles overlay grain/noise on tiles to defeat automated solvers. Look PAST the noise — the underlying image is still clearly recognizable to a human.

CRITICAL — IGNORE ALREADY-SELECTED TILES. Selected tiles have a distinct BLUE border/overlay, often with a white checkmark. Those are already done. Do NOT include them in your output even if they still contain the target — clicking a selected tile DE-SELECTS it, which breaks the solve.

Include a tile index ONLY if:
  1. The tile contains a visible portion of "${target}" (even a small corner), AND
  2. The tile is NOT already selected (no blue border, no checkmark overlay).

Exclude tiles that show unrelated objects (trees, sky, road, signs without ${target}).

Return ONLY:
{"tiles": [<indices of UN-SELECTED tiles containing ${target}>]}

Examples:
- If tiles 0, 3, 6 contain buses and none are selected yet: {"tiles":[0,3,6]}
- If tiles 0, 3, 6 contain buses but 0 and 3 already have blue overlay: {"tiles":[6]}
- If all ${target} tiles are already selected: {"tiles":[]}
- If no tile contains the target: {"tiles":[]}` },
          ],
        }],
      }),
    }).then(r => r.json()).catch((e: any) => ({ error: { message: e.message } })) as any

    const elapsed = Date.now() - t0
    if (res.error) {
      log(`  classify err (${elapsed}ms): ${res.error?.message?.slice(0, 120)}`)
      return null
    }
    const reply: string = res.content?.[0]?.text?.trim() || ''
    const parsed = JSON.parse(extractJson(reply)) as { tiles: number[] }
    const tiles = new Array(n).fill(false) as boolean[]
    for (const idx of parsed.tiles || []) {
      if (Number.isInteger(idx) && idx >= 0 && idx < n) tiles[idx] = true
    }
    log(`  classify (${elapsed}ms): [${tiles.map((b, i) => b ? i : '·').join(',')}]`)
    return tiles
  } catch (e: any) {
    log(`  classify fetch err: ${e.message?.slice(0, 100)}`)
    return null
  }
}

/**
 * Classify which tiles in a cropped grid image contain the target object.
 * Returns a boolean array of length gridSize² (true = click that tile).
 * NOTE: unused — CapSolver fails on Meta's noise-overlay tiles. Kept for
 * reference; classifyWithClaude is the active path.
 */
async function classifyWithCapSolver(
  gridPng: Buffer,
  target: string,
  capsolverKey: string,
  log: (m: string) => void,
): Promise<boolean[] | null> {
  const mid = targetToMid(target)
  if (!mid) {
    log(`  capsolver: no MID mapping for "${target}" — skipping`)
    return null
  }
  const t0 = Date.now()
  try {
    const createRes = await fetch(`${CAPSOLVER_URL}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: capsolverKey,
        task: {
          type: 'ReCaptchaV2Classification',
          image: gridPng.toString('base64'),
          question: mid,
        },
      }),
    })
    const created = await createRes.json()
    if (created.errorId !== 0) {
      log(`  capsolver createTask err: ${created.errorDescription}`)
      return null
    }
    // ReCaptchaV2Classification is synchronous — solution comes back in the
    // createTask response. Polling afterwards returns "task data has expired"
    // because the task was already consumed.
    if (created.status === 'ready' && created.solution) {
      const tiles: boolean[] = created.solution.objects || []
      log(`  capsolver sync (${Date.now() - t0}ms): [${tiles.map((b, i) => b ? i : '·').join(',')}]`)
      return tiles
    }
    const taskId = created.taskId

    for (let i = 0; i < 30; i++) {
      await sleep(1500)
      const pollRes = await fetch(`${CAPSOLVER_URL}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: capsolverKey, taskId }),
      })
      const polled = await pollRes.json()
      if (polled.status === 'ready') {
        const tiles: boolean[] = polled.solution?.objects || []
        log(`  capsolver (${Date.now() - t0}ms): [${tiles.map((b, i) => b ? i : '·').join(',')}]`)
        return tiles
      }
      if (polled.errorId && polled.errorId !== 0) {
        log(`  capsolver task err: ${polled.errorDescription}`)
        return null
      }
    }
    log(`  capsolver timeout after 45s`)
    return null
  } catch (e: any) {
    log(`  capsolver fetch err: ${e.message?.slice(0, 100)}`)
    return null
  }
}

/**
 * Compute pixel-center coords for tile indices given the grid bbox.
 * Index 0 = top-left, increases left-to-right then top-to-bottom.
 */
function tileCenterPixels(
  grid: { x: number; y: number; w: number; h: number },
  gridSize: number,
  tileIndices: number[],
): { x: number; y: number }[] {
  const cellW = grid.w / gridSize
  const cellH = grid.h / gridSize
  return tileIndices.map(idx => {
    const row = Math.floor(idx / gridSize)
    const col = idx % gridSize
    return {
      x: Math.round(grid.x + col * cellW + cellW / 2),
      y: Math.round(grid.y + row * cellH + cellH / 2),
    }
  })
}

async function cropGrid(
  screenshotPng: Buffer,
  grid: { x: number; y: number; w: number; h: number },
): Promise<Buffer | null> {
  try {
    return await sharp(screenshotPng)
      .extract({
        left: Math.max(0, Math.round(grid.x)),
        top: Math.max(0, Math.round(grid.y)),
        width: Math.round(grid.w),
        height: Math.round(grid.h),
      })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

/**
 * One full solve attempt: detect layout (Claude) → classify tiles (CapSolver)
 * → click matching tiles → refill rounds → click Verify.
 */
async function analyzeAndSolve(
  page: Page,
  anthropicKey: string,
  twoCaptchaKey: string | undefined,
  log: (m: string) => void,
  iter: number,
): Promise<'solved' | 'no-captcha' | 'error'> {
  const shot = await screenshotPage(page, log)
  if (!shot) return 'error'

  const layout = await detectLayout(shot.png, shot.w, shot.h, anthropicKey, log)
  if (!layout) return 'error'
  if (!layout.visible) {
    if (iter % 5 === 1) log(`  no captcha: ${layout.reason || ''}`)
    return 'no-captcha'
  }

  // Checkbox case — just click and let the grid appear on the next iter.
  if (layout.checkbox && typeof layout.checkbox.x === 'number') {
    log(`✓ checkbox — clicking (${layout.checkbox.x}, ${layout.checkbox.y})`)
    try {
      await page.mouse.click(layout.checkbox.x, layout.checkbox.y, { delay: 50 })
      return 'solved'
    } catch (e: any) {
      log(`  checkbox click err: ${e.message?.slice(0, 80)}`)
      return 'error'
    }
  }

  if (!layout.grid || !layout.gridSize || !layout.verifyButton || !layout.prompt) {
    log(`  layout missing fields — skipping`)
    return 'error'
  }
  if (!twoCaptchaKey) {
    log(`  no TWOCAPTCHA_API_KEY — cannot classify tiles`)
    return 'error'
  }

  // Classify initial grid state with 2Captcha human workers. ML solvers
  // (CapSolver, Claude, Gemini, GPT-4V) all fail on Meta's noise overlay.
  const firstCrop = await cropGrid(shot.png, layout.grid)
  if (!firstCrop) { log(`  crop failed`); return 'error' }
  const firstClassify = await classifyWith2Captcha(firstCrop, layout.prompt, layout.gridSize, twoCaptchaKey, log)
  if (!firstClassify) return 'error'
  const firstIndices = firstClassify.flatMap((b, i) => (b ? [i] : []))
  log(`✓ Captcha "${layout.prompt}" — ${firstIndices.length} initial tiles`)

  await clickTiles(page, tileCenterPixels(layout.grid, layout.gridSize, firstIndices), shot.w, shot.h, firstIndices, log)

  // Refill rounds — 3×3 VERIFY mode replaces clicked tiles with fresh images
  // that may also match; 4×4 NEXT mode stays static. Either way, re-classify.
  let verify = layout.verifyButton
  for (let round = 0; round < 3; round++) {
    await sleep(2000) // let refilled images load
    const reshot = await screenshotPage(page, log)
    if (!reshot) break

    const reLayout = await detectLayout(reshot.png, reshot.w, reshot.h, anthropicKey, log)
    if (!reLayout) break
    if (!reLayout.visible) {
      log(`  round ${round + 1}: captcha gone`)
      return 'solved'
    }
    if (!reLayout.grid || !reLayout.gridSize || !reLayout.verifyButton) break
    verify = reLayout.verifyButton

    const reCrop = await cropGrid(reshot.png, reLayout.grid)
    if (!reCrop) break
    const reClassify = await classifyWith2Captcha(reCrop, reLayout.prompt || layout.prompt, reLayout.gridSize, twoCaptchaKey, log)
    if (!reClassify) break
    const moreIndices = reClassify.flatMap((b, i) => (b ? [i] : []))

    if (moreIndices.length === 0) {
      // Confirmation pass — CapSolver can flag 0 if refilled images haven't
      // finished loading. Wait and re-classify; only commit to Verify if the
      // second pass also says zero.
      log(`  round ${round + 1}: 0 matches — confirming after fade-in`)
      await sleep(2000)
      const confShot = await screenshotPage(page, log)
      if (!confShot) break
      const confLayout = await detectLayout(confShot.png, confShot.w, confShot.h, anthropicKey, log)
      if (!confLayout || !confLayout.visible) { log(`  confirmation: gone`); return 'solved' }
      if (!confLayout.grid || !confLayout.gridSize || !confLayout.verifyButton) break
      verify = confLayout.verifyButton
      const confCrop = await cropGrid(confShot.png, confLayout.grid)
      if (!confCrop) break
      const confClassify = await classifyWith2Captcha(confCrop, confLayout.prompt || layout.prompt, confLayout.gridSize, twoCaptchaKey, log)
      if (!confClassify) break
      const lateIndices = confClassify.flatMap((b, i) => (b ? [i] : []))
      if (lateIndices.length > 0) {
        log(`  confirmation: ${lateIndices.length} late tiles — clicking`)
        await clickTiles(page, tileCenterPixels(confLayout.grid, confLayout.gridSize, lateIndices), confShot.w, confShot.h, lateIndices, log)
        continue
      }
      break
    }

    log(`  round ${round + 1}: ${moreIndices.length} more tiles`)
    await clickTiles(page, tileCenterPixels(reLayout.grid, reLayout.gridSize, moreIndices), reshot.w, reshot.h, moreIndices, log)
  }

  await sleep(1500)
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
  indices: number[],
  log: (m: string) => void,
): Promise<void> {
  if (tiles.length === 0) return
  // One-time context dump so we can eyeball whether clicks are targeting the
  // right page and whether the viewport Claude saw matches the one puppeteer
  // is clicking into.
  try {
    const url = page.url()
    const live = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }))
    log(`  clickCtx: url=${url.slice(0, 80)} shotVP=${vw}×${vh} liveVP=${live.w}×${live.h} dpr=${live.dpr}`)
  } catch (e: any) {
    log(`  clickCtx err: ${e.message?.slice(0, 80)}`)
  }

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const idx = indices[i]
    if (typeof tile.x !== 'number' || typeof tile.y !== 'number') continue
    if (tile.x < 0 || tile.y < 0 || tile.x > vw || tile.y > vh) {
      log(`  ✗ tile[${idx}] (${tile.x}, ${tile.y}) out of viewport, skipping`)
      continue
    }
    try {
      // Human-like: move first (so any hover state registers), pause, press,
      // brief hold, release. Meta's captcha rejects the burst-click pattern
      // that puppeteer's default .click() produces.
      await page.mouse.move(tile.x, tile.y, { steps: 4 })
      await sleep(40)
      await page.mouse.down({ button: 'left' })
      await sleep(60)
      await page.mouse.up({ button: 'left' })
      log(`  ✓ tile[${idx}] clicked at (${tile.x}, ${tile.y})`)
      await sleep(200)
    } catch (e: any) {
      log(`  ✗ tile[${idx}] (${tile.x}, ${tile.y}) err: ${e.message?.slice(0, 80)}`)
    }
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
