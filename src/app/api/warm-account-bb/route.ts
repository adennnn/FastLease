/**
 * Browserbase A/B variant of warm-account — LOGIN ONLY.
 *
 * Two modes:
 *   • Agentic (creds provided): runs Stagehand's CUA agent with the FB signin
 *     prompt — fills email/password, handles 2FA via 2fa.live, waits through
 *     Browserbase's built-in captcha solver, and outputs LOGIN_OK/LOGIN_FAILED.
 *   • Manual (no creds): opens facebook.com/login and polls c_user cookie for
 *     up to 15 minutes while the user logs in via the live-view iframe.
 *
 * In both modes, once login is confirmed we close the session with
 * persist:true so Browserbase flushes the updated user-data-directory back
 * to the context, then save an account record pointing at the context ID.
 */

import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { createSSEStream } from '@/lib/browser-use/sse-stream'
import { createBrowserbaseClient, getBrowserbaseProjectId } from '@/lib/browserbase/client'
import { createStagehandSession } from '@/lib/browserbase/stagehand'
import { buildSigninPromptBB } from '@/lib/prompts/signin-bb'
import { startCaptchaWatcher, type CaptchaWatcherHandle } from '@/lib/captcha-solver'
import { db } from '@/lib/db'

export const maxDuration = 300

const LOGIN_POLL_INTERVAL_MS = 4000
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const AGENT_MAX_STEPS = 120

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const label: string | undefined = body?.label
  const email: string | undefined = body?.email
  const fbPass: string | undefined = body?.fbPass
  const emailPass: string | undefined = body?.emailPass
  const dob: string | undefined = body?.dob
  const backupCode: string | undefined = body?.backupCode
  const agentic = !!(email && fbPass)

  return createSSEStream(async (sse) => {
    let contextId: string | null = null
    let sessionCloser: (() => Promise<void>) | null = null
    let captchaWatcher: CaptchaWatcherHandle | null = null
    let bbSessionId: string | null = null
    let cancelled = false

    // Client cancellation: when the user clicks Cancel in the UI, the fetch's
    // AbortController fires req.signal → we tear down the captcha watcher,
    // disconnect Stagehand, and ask Browserbase to release the cloud session
    // so we're not paying for it until timeout.
    const onAbort = () => {
      if (cancelled) return
      cancelled = true
      console.log(`[WarmBB] client cancelled — tearing down session ${bbSessionId || '(no session yet)'}`)
      ;(async () => {
        if (captchaWatcher) {
          try { captchaWatcher.abort(); await captchaWatcher.done } catch {}
        }
        if (sessionCloser) {
          try { await sessionCloser() } catch {}
        }
        if (bbSessionId) {
          try {
            const bb = createBrowserbaseClient()
            await bb.sessions.update(bbSessionId, {
              projectId: getBrowserbaseProjectId(),
              status: 'REQUEST_RELEASE',
            })
            console.log(`[WarmBB] released BB session ${bbSessionId}`)
          } catch (err: any) {
            console.log(`[WarmBB] sessions.update(REQUEST_RELEASE) failed: ${err?.message}`)
          }
        }
      })().catch(() => {})
    }
    req.signal.addEventListener('abort', onAbort)

    try {
      sse.send('status', { message: 'Creating fresh Browserbase context…' })
      const bb = createBrowserbaseClient()
      const context = await bb.contexts.create({ projectId: getBrowserbaseProjectId() })
      contextId = context.id
      console.log(`[WarmBB] Created context ${contextId} (agentic=${agentic})`)

      sse.send('status', { message: 'Starting browser session…' })
      const session = await createStagehandSession({
        contextId,
        persistContext: true,
        timeoutSec: 20 * 60,
      })
      sessionCloser = session.close
      bbSessionId = session.sessionId

      sse.send('session', { sessionId: session.sessionId, contextId })

      // Prefer the signed debugger URL (embeddable anywhere) over the
      // browserbase.com session-viewer, which sits behind BB's auth wall.
      let embedUrl: string | null = session.liveUrl
      try {
        const debug = await bb.sessions.debug(session.sessionId)
        if ((debug as any)?.debuggerFullscreenUrl) {
          embedUrl = (debug as any).debuggerFullscreenUrl as string
        }
      } catch (err: any) {
        console.log(`[WarmBB] sessions.debug() failed: ${err?.message}`)
      }
      if (embedUrl) {
        sse.send('liveUrl', { liveUrl: embedUrl, sessionId: session.sessionId })
      }

      const page = session.page as any
      const browserCtx = session.context as any

      let loggedIn = false

      if (agentic) {
        // Stagehand's init lands on about:blank → auto-navigates to google.com.
        // If we hand the agent the prompt from there, it types the FB URL into
        // Google's search box instead of the address bar, wasting 20+ steps.
        // Pre-navigate so the agent starts on the login form.
        sse.send('status', { message: 'Navigating to facebook.com/login…' })
        try {
          await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } catch (err: any) {
          console.log(`[WarmBB] pre-nav to FB login failed (${err?.message}) — agent will handle navigation`)
        }

        // Start the vision-based CAPTCHA watcher *before* the agent runs, so
        // it's already connected when FB throws up a puzzle. Uses Browserbase's
        // connectUrl (puppeteer-compatible WSS) — same pattern as BU, different
        // URL shape.
        const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
        if (anthropicKey) {
          try {
            const info: any = await bb.sessions.retrieve(session.sessionId)
            const wsEndpoint = info?.connectUrl
            if (wsEndpoint) {
              captchaWatcher = startCaptchaWatcher({ wsEndpoint }, anthropicKey, email!)
              console.log(`[WarmBB] Captcha watcher started for ${email}`)
            } else {
              console.log('[WarmBB] No connectUrl on session — captcha watcher disabled')
            }
          } catch (err: any) {
            console.log(`[WarmBB] Failed to start captcha watcher: ${err?.message}`)
          }
        } else {
          console.log('[WarmBB] ANTHROPIC_API_KEY missing — captcha watcher disabled')
        }

        // Run the signin prompt through Stagehand's CUA agent. The agent fills
        // the form + handles 2FA via 2fa.live; the external watcher above
        // handles any image-grid CAPTCHA over CDP.
        sse.send('status', { message: 'Running sign-in agent…' })
        const prompt = buildSigninPromptBB({ email: email!, fbPass: fbPass!, emailPass, dob, backupCode })

        // Stagehand's default model isn't wired for CUA — it requires a
        // CUA-capable model id. Claude Sonnet 4.6 is the closest analogue to
        // the Sonnet 4.5 we use elsewhere and supports computer-use.
        const agent = session.stagehand.agent({
          mode: 'cua',
          model: 'anthropic/claude-sonnet-4-6',
        })
        try {
          const result = await agent.execute({
            instruction: prompt,
            maxSteps: AGENT_MAX_STEPS,
          })
          const output = (result?.message || '').trim()
          console.log(`[WarmBB] agent done: success=${result?.success} output=${output.slice(0, 300)}`)

          if (/\bLOGIN_OK\b/.test(output)) {
            loggedIn = true
          } else {
            const failMatch = output.match(/LOGIN_FAILED:?\s*(.+)/i)
            const reason = failMatch
              ? failMatch[1].trim().slice(0, 200)
              : (output.slice(0, 200) || 'Login did not complete')
            sse.send('error', { error: `Sign-in failed: ${reason}` })
            return
          }
        } catch (err: any) {
          console.error(`[WarmBB] agent threw: ${err?.message}`)
          sse.send('error', { error: `Sign-in agent failed: ${err?.message || 'unknown'}` })
          return
        }

        // Verify cookies actually landed — the agent occasionally claims
        // LOGIN_OK on a transient "Save your login info?" page before FB has
        // written the session cookies. A quick poll catches that case.
        sse.send('status', { message: 'Verifying session cookies…' })
        const start = Date.now()
        while (Date.now() - start < 60_000) {
          try {
            const cookies = await browserCtx.cookies('https://www.facebook.com')
            const cUser = cookies.find((c: any) => c.name === 'c_user' && c.value)
            if (cUser) {
              console.log(`[WarmBB] c_user=${cUser.value} confirmed on context ${contextId}`)
              break
            }
          } catch (err: any) {
            console.log(`[WarmBB] cookie verify err: ${err?.message}`)
          }
          await new Promise(r => setTimeout(r, 2000))
        }
      } else {
        // Manual flow — user drives the login in the live view.
        sse.send('status', { message: 'Opening facebook.com/login — log in manually in the live view' })
        await page.goto('https://www.facebook.com/login')

        const start = Date.now()
        let lastReport = 0
        while (Date.now() - start < LOGIN_TIMEOUT_MS) {
          await new Promise(r => setTimeout(r, LOGIN_POLL_INTERVAL_MS))
          try {
            const cookies = await browserCtx.cookies('https://www.facebook.com')
            const cUser = cookies.find((c: any) => c.name === 'c_user' && c.value)
            if (cUser) {
              loggedIn = true
              console.log(`[WarmBB] Detected c_user=${cUser.value} on context ${contextId}`)
              break
            }
          } catch (err: any) {
            console.log(`[WarmBB] cookie poll err: ${err?.message}`)
          }
          const elapsedSec = Math.floor((Date.now() - start) / 1000)
          if (elapsedSec - lastReport >= 30) {
            sse.send('status', { message: `Waiting for login… (${elapsedSec}s elapsed)` })
            lastReport = elapsedSec
          }
        }

        if (!loggedIn) {
          sse.send('error', { error: 'Login not detected within 15 minutes — session closed without saving' })
          return
        }
      }

      // Closing the session with persist:true on the browserSettings.context
      // flushes the updated user-data-directory back to the Browserbase context.
      sse.send('status', { message: 'Login detected — persisting cookies to context…' })
      await session.close()
      sessionCloser = null

      const account = db.browserbaseAccounts.create({
        id: randomUUID(),
        browserbaseContextId: contextId,
        label: label || email || `FB account (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
        createdAt: new Date().toISOString(),
      })

      console.log(`[WarmBB] Saved account ${account.id} → context ${contextId}`)
      sse.send('result', {
        success: true,
        accountId: account.id,
        browserbaseContextId: contextId,
        label: account.label,
      })
    } catch (err: any) {
      if (cancelled) {
        console.log('[WarmBB] handler errored after cancel — swallowing')
      } else {
        console.error('[WarmBB] Error:', err?.message)
        sse.send('error', { error: err?.message || 'Failed to warm account' })
      }
    } finally {
      req.signal.removeEventListener('abort', onAbort)
      // If we already ran the abort path, its teardown owns the cleanup —
      // otherwise do a normal teardown here.
      if (!cancelled) {
        if (captchaWatcher) {
          try { captchaWatcher.abort(); await captchaWatcher.done } catch {}
        }
        if (sessionCloser) {
          try { await sessionCloser() } catch {}
        }
      }
    }
  })
}
