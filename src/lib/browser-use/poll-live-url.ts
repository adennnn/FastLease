/**
 * Poll a browser-use run promise for its session ID and live URL.
 *
 * Each route handler needs to emit (sessionId, liveUrl) to the SSE stream
 * as soon as they're available. This helper encapsulates the retry loop.
 */

import type { BrowserUseClient } from './client'
import type { SSESender } from './sse-stream'

interface PollOptions {
  client: BrowserUseClient
  runPromise: any
  sse: SSESender
  /** SSE event payload extras (e.g. step key/label for warmup). */
  sessionMeta?: Record<string, any>
  /** Max poll attempts (default 30, ~60s at 2s intervals). */
  maxAttempts?: number
  /** Callback with sessionId once known — lets callers track it. */
  onSessionId?: (sid: string) => void
}

/**
 * Fires and forgets. Polls the runPromise for its sessionId, then
 * polls the session for liveUrl. Emits SSE events as they arrive.
 *
 * For v3 SDK (warm-account, post-listing): sessionId lives on `runPromise.sessionId`.
 * For root SDK (account-signin): sessionId comes from `runPromise.taskId` → task.sessionId.
 */
export function pollLiveUrl(opts: PollOptions): void {
  const {
    client,
    runPromise,
    sse,
    sessionMeta = {},
    maxAttempts = 30,
    onSessionId,
  } = opts

  const poll = async () => {
    let emittedSid = false
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000))

      // v3 SDK exposes sessionId directly; root SDK exposes taskId.
      let sid: string | null =
        (runPromise as any).sessionId ?? null

      if (!sid && (runPromise as any).taskId) {
        try {
          const task = await client.tasks.get((runPromise as any).taskId)
          sid = (task as any)?.sessionId ?? null
        } catch {}
      }

      if (!sid) continue
      onSessionId?.(sid)

      if (!emittedSid) {
        sse.send('session', { sessionId: sid, ...sessionMeta })
        emittedSid = true
      }

      try {
        const session: any = await client.sessions.get(sid)
        if (session?.liveUrl) {
          sse.send('liveUrl', { liveUrl: session.liveUrl, sessionId: sid })
          return
        }
      } catch {}
    }
  }

  poll().catch(() => {})
}

/**
 * Extended poller for account-signin: also extracts the CDP URL from
 * the liveUrl and invokes a callback so the captcha watcher can start.
 */
export function pollLiveUrlWithCDP(
  opts: PollOptions & {
    onCDPUrl?: (cdpHttps: string) => void
    logPrefix?: string
  },
): void {
  const {
    client,
    runPromise,
    sse,
    sessionMeta = {},
    maxAttempts = 90,
    onSessionId,
    onCDPUrl,
    logPrefix = '[Signin]',
  } = opts

  const poll = async () => {
    let emittedSid = false
    let cdpEmitted = false
    let sid: string | null = null

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000))

      const tid = (runPromise as any).taskId as string | null
      if (!tid) continue

      try {
        if (!sid) {
          const task: any = await client.tasks.get(tid)
          if (task?.sessionId) sid = task.sessionId
        }
        if (!sid) continue
        onSessionId?.(sid)

        const session: any = await client.sessions
          .get(sid)
          .catch((e: any) => {
            if (i === 0) console.log(`${logPrefix} sessions.get err: ${e?.message}`)
            return null
          })

        const liveUrl: string | undefined = session?.liveUrl

        // Extract CDP URL from the liveUrl query param
        if (liveUrl && !cdpEmitted && onCDPUrl) {
          const wssMatch = liveUrl.match(/[?&]wss=([^&]+)/)
          if (wssMatch) {
            const cdpHttps = decodeURIComponent(wssMatch[1])
            onCDPUrl(cdpHttps)
            cdpEmitted = true
            console.log(`${logPrefix} CDP URL extracted: ${cdpHttps.slice(0, 80)}`)
          }
        }

        if (liveUrl && !emittedSid) {
          console.log(`${logPrefix} live URL: ${liveUrl} (session: ${sid})`)
          sse.send('session', { sessionId: sid, ...sessionMeta })
          sse.send('liveUrl', { liveUrl, sessionId: sid })
          emittedSid = true
        }

        const watcherReady = !onCDPUrl || cdpEmitted
        if (emittedSid && watcherReady) return
      } catch {}
    }
  }

  poll().catch(() => {})
}
