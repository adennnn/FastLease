'use client'

import { useEffect, useRef } from 'react'

/**
 * Shared reconnect poller for browser-use sessions.
 *
 * After a page reload, any session still marked "running" with a persisted
 * browser-use sessionId needs polling to refresh liveUrl and detect terminal
 * state. Both WarmAccountsTab and SignInAccountsTab had identical copies of
 * this logic — now they share this hook.
 */

export interface PollerSession {
  /** Unique key for this session (account ID or session row ID). */
  id: string
  /** Current state — only 'running' / 'pending' sessions get polled. */
  state: string
  /** The browser-use session ID to poll. */
  browserSessionId?: string
}

export interface PollerCallbacks {
  /** Called when a liveUrl is discovered or updated. */
  onLiveUrl: (id: string, liveUrl: string) => void
  /** Called when the session reaches a terminal state. */
  onTerminal: (id: string, status: string) => void
}

const TERMINAL_STATUSES = ['stopped', 'error', 'completed', 'timed_out']
const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 360

export function useSessionPoller(
  sessions: PollerSession[],
  callbacks: PollerCallbacks,
) {
  const pollersRef = useRef<Map<string, { cancelled: boolean }>>(new Map())
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    for (const session of sessions) {
      if (session.state !== 'running' && session.state !== 'pending') continue
      const sid = session.browserSessionId
      if (!sid) continue
      if (pollersRef.current.has(sid)) continue

      const token = { cancelled: false }
      pollersRef.current.set(sid, token)
      const sessionId = session.id

      ;(async () => {
        for (let i = 0; i < MAX_POLLS; i++) {
          if (token.cancelled) return

          try {
            const res = await fetch(`/api/warmup-session?sid=${encodeURIComponent(sid)}`)
            if (res.ok) {
              const { status, liveUrl } = await res.json()

              if (liveUrl) {
                callbacksRef.current.onLiveUrl(sessionId, liveUrl)
              }

              if (TERMINAL_STATUSES.includes(status)) {
                callbacksRef.current.onTerminal(sessionId, status)
                return
              }
            }
          } catch {
            // Network blip — retry next iteration
          }

          if (token.cancelled) return
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
        }
      })().finally(() => {
        pollersRef.current.delete(sid)
      })
    }
  }, [sessions])

  // Cleanup on unmount
  useEffect(() => {
    const pollers = pollersRef.current
    return () => {
      pollers.forEach(t => { t.cancelled = true })
      pollers.clear()
    }
  }, [])
}
