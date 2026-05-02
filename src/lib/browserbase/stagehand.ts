/**
 * Creates a Stagehand session attached to a Browserbase cloud session.
 *
 * Wraps the boilerplate of constructing Stagehand with the right env vars,
 * model config, residential proxies, and persistent context. Also surfaces
 * the Browserbase session's live URL + debug URL so callers can stream them
 * back to the UI over SSE (the BU equivalent is pollLiveUrl).
 *
 * The caller is responsible for calling close() when done — otherwise the
 * Browserbase session keeps running until the project's defaultTimeout.
 */

import { Stagehand } from '@browserbasehq/stagehand'
import { getBrowserbaseProjectId } from './client'

export interface StagehandSessionOptions {
  /**
   * Existing Browserbase context ID to persist cookies/localStorage into.
   * When omitted, Stagehand creates an ephemeral session (no persistence).
   * For FB posting, pass the context ID that was warmed via warm-account-bb.
   */
  contextId?: string
  /**
   * If true, persist changes back to the context (cookies set during the
   * session are saved). Defaults to true — we want the logged-in cookies to
   * survive across posting runs.
   */
  persistContext?: boolean
  /**
   * Session timeout in seconds. Browserbase default is usually 10–30 min;
   * posting flows can take 5–15 min, so we bump this to 30 min by default.
   */
  timeoutSec?: number
  /**
   * When true, keep the session alive after disconnection (so the live-view
   * iframe doesn't die the moment our route finishes). Not available on all
   * plans — if it errors we fall back to keepAlive off.
   */
  keepAlive?: boolean
  /** Override the LLM model. Defaults to Anthropic Claude Sonnet. */
  modelName?: string
}

export interface StagehandSession {
  stagehand: Stagehand
  /** Top-level Page created during init — call goto/evaluate/url on this. */
  page: any
  /** V3Context — has pages(), cookies(), newPage(). */
  context: any
  sessionId: string
  /** Browserbase live-view URL (embeddable iframe). */
  liveUrl: string | null
  /** Browserbase CDP/devtools debug URL. */
  debugUrl: string | null
  /** Tears down the Stagehand + Browserbase session. */
  close: () => Promise<void>
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5'

/**
 * Shell env sometimes has an empty `ANTHROPIC_API_KEY` exported (e.g. when
 * Claude Code CLI is installed system-wide). Shell vars beat `.env.local`
 * in Next.js, so the empty string wins and Stagehand silently fails.
 * Read `.env.local` directly as a fallback when the env var is blank.
 */
function resolveAnthropicKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY
  if (fromEnv) return fromEnv
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path')
    const envPath = path.join(process.cwd(), '.env.local')
    const content = fs.readFileSync(envPath, 'utf8')
    const match = content.split(/\r?\n/).find(l => l.startsWith('ANTHROPIC_API_KEY='))
    if (!match) return undefined
    return match.slice('ANTHROPIC_API_KEY='.length).trim() || undefined
  } catch {
    return undefined
  }
}

export async function createStagehandSession(
  opts: StagehandSessionOptions = {},
): Promise<StagehandSession> {
  const anthropicKey = resolveAnthropicKey()
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY not set — Stagehand needs an LLM')
  }
  // Make the key visible to Stagehand's auto-loader in case our shell had
  // an empty export shadowing the .env.local value.
  process.env.ANTHROPIC_API_KEY = anthropicKey

  const projectId = getBrowserbaseProjectId()
  const persist = opts.persistContext ?? true
  const timeoutSec = opts.timeoutSec ?? 30 * 60

  // Proxies disabled — requires a paid Browserbase plan. FB may flag logins
  // from datacenter IPs faster, so flip BROWSERBASE_PROXIES=1 once upgraded.
  const proxiesEnabled = process.env.BROWSERBASE_PROXIES === '1'
  if (proxiesEnabled) {
    console.warn(
      '[Stagehand] Residential proxies enabled (US). Proxy bandwidth is billed separately by Browserbase.',
    )
  }

  const browserbaseSessionCreateParams: any = {
    projectId,
    ...(proxiesEnabled ? { proxies: true } : {}),
    region: 'us-east-1' as const,
    keepAlive: opts.keepAlive ?? false,
    timeout: timeoutSec,
    browserSettings: {
      // solveCaptchas: false — Browserbase's built-in solver doesn't work on
      // Meta's image grids (its CNN is trained on clean reCAPTCHA tiles, same
      // failure mode as CapSolver). Worse, when it tries and gives up, it
      // races our 2Captcha+puppeteer flow: BB fires click-Verify/refresh at
      // unpredictable times, wiping out the tiles we just selected and
      // rotating the puzzle. Disable it so the external captcha-solver.ts
      // owns the whole flow.
      solveCaptchas: false,
      blockAds: true,
      ...(opts.contextId
        ? { context: { id: opts.contextId, persist } }
        : {}),
    },
  }

  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId,
    model: opts.modelName ?? DEFAULT_MODEL,
    browserbaseSessionCreateParams,
    verbose: 1,
    disablePino: true,
  } as any)

  try {
    await stagehand.init()
  } catch (err: any) {
    // keepAlive isn't available on every plan — retry once without it.
    if (opts.keepAlive && /keepAlive|keep[- ]alive|plan/i.test(err?.message || '')) {
      console.warn('[Stagehand] keepAlive rejected; retrying without it')
      return createStagehandSession({ ...opts, keepAlive: false })
    }
    throw err
  }

  const sessionId = (stagehand as any).browserbaseSessionID as string
  const liveUrl = ((stagehand as any).browserbaseSessionURL as string | undefined) ?? null
  const debugUrl = ((stagehand as any).browserbaseDebugURL as string | undefined) ?? null

  const ctx = (stagehand as any).context
  // Stagehand v3 creates a top-level page during init but doesn't expose it
  // directly — grab the first one from context.pages(), or open a fresh page
  // if the session started with no tab.
  let page = ctx?.pages?.()[0]
  if (!page && typeof ctx?.newPage === 'function') {
    page = await ctx.newPage('about:blank')
  }

  return {
    stagehand,
    page,
    context: ctx,
    sessionId,
    liveUrl,
    debugUrl,
    close: async () => {
      try {
        await stagehand.close()
      } catch (err: any) {
        console.log(`[Stagehand] close() threw: ${err?.message}`)
      }
    },
  }
}
