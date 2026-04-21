'use client'

import { useEffect, useRef, useState } from 'react'
import type { PostSession } from './GenerateListingFlow'

interface Props {
  sessions: PostSession[]
  onRetry: (sessionId: string) => void
  onDismissAll: () => void
  onOpenListings?: () => void
  onConnected?: (sessionId: string) => void
  headerTitle?: string
  successLabel?: string
  successLinkLabel?: string
}

export default function MultiSessionView({ sessions, onRetry, onDismissAll, onOpenListings, onConnected, headerTitle, successLabel, successLinkLabel }: Props) {
  const cols = Math.min(Math.max(Math.ceil(Math.sqrt(sessions.length)), 1), 4)
  const running = sessions.filter(s => s.state === 'running' || s.state === 'pending').length
  const done = sessions.filter(s => s.state === 'success').length
  const failed = sessions.filter(s => s.state === 'failed').length
  const allDone = running === 0
  const title = headerTitle ?? `Posting ${sessions.length} listing${sessions.length !== 1 ? 's' : ''} to Facebook`

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-bold dark:text-zinc-50">{title}</h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            {running > 0 && <span>{running} running · </span>}
            {done > 0 && <span className="text-green-600 dark:text-green-400">{done} done · </span>}
            {failed > 0 && <span className="text-red-500">{failed} failed · </span>}
            <span>{sessions.length} total</span>
          </p>
        </div>
        <div className="flex gap-2">
          {allDone && onOpenListings && (
            <button onClick={onOpenListings} className="px-5 py-2 rounded-lg text-sm accent-btn font-medium">Go to Listings</button>
          )}
          <button onClick={onDismissAll} className="px-5 py-2 rounded-lg text-sm border border-gray-200 dark:border-zinc-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 transition font-medium">
            {allDone ? 'Close' : 'Dismiss'}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div
          className="grid gap-3 mx-auto"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: cols >= 3 ? '100%' : '1400px' }}
        >
          {sessions.map(session => (
            <SessionTile
              key={session.id}
              session={session}
              onRetry={() => onRetry(session.id)}
              onConnected={onConnected ? () => onConnected(session.id) : undefined}
              successLabel={successLabel}
              successLinkLabel={successLinkLabel}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SessionTile({ session, onRetry, onConnected, successLabel, successLinkLabel }: { session: PostSession; onRetry: () => void; onConnected?: () => void; successLabel?: string; successLinkLabel?: string }) {
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState(false)
  const endedRef = useRef(false)
  const stopAttemptedRef = useRef(false)

  const stopBU = async (sessionId: string) => {
    if (stopAttemptedRef.current) return
    stopAttemptedRef.current = true
    try {
      await fetch('/api/sessions/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    } catch {}
  }

  // If End was clicked before the BU session id arrived, stop it as soon as we know it.
  useEffect(() => {
    if (endedRef.current && session.browserSessionId && !stopAttemptedRef.current) {
      stopBU(session.browserSessionId)
    }
  }, [session.browserSessionId])

  const borderClass =
    ended ? 'border-red-500/50'
    : session.state === 'success' ? 'border-green-500/50'
    : session.state === 'failed' ? 'border-red-500/50'
    : 'border-gray-200 dark:border-zinc-700'

  const isTerminal = session.state === 'success' || session.state === 'failed' || ended
  const canEnd = !isTerminal

  const handleEnd = async () => {
    if (ending || ended) return
    setEnding(true)
    if (session.browserSessionId) {
      await stopBU(session.browserSessionId)
    }
    endedRef.current = true
    setEnded(true)
    setEnding(false)
  }

  const handleRetry = () => {
    endedRef.current = false
    stopAttemptedRef.current = false
    setEnded(false)
    setEnding(false)
    onRetry()
  }

  return (
    <div className={`border ${borderClass} rounded-lg overflow-hidden bg-white dark:bg-zinc-900 flex flex-col`}>
      {/* Tile header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-zinc-800 text-xs">
        <div className="flex-1 min-w-0">
          <div className="font-semibold dark:text-zinc-50 truncate">{session.unitName}</div>
          <div className="text-gray-400 dark:text-zinc-500 truncate">{session.profileName}</div>
        </div>
        <StatusBadge state={session.state} />
      </div>

      {/* Body */}
      <div className="relative bg-gray-50 dark:bg-zinc-950" style={{ aspectRatio: '16/10' }}>
        {ended && session.state !== 'success' && session.state !== 'failed' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgb(239 68 68)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            </div>
            <p className="text-xs font-medium text-red-500">Stopped</p>
          </div>
        ) : session.state === 'success' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgb(34 197 94)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <p className="text-xs font-medium text-green-600 dark:text-green-400">{successLabel || 'Posted successfully'}</p>
            {session.facebookUrl && (
              <a href={session.facebookUrl} target="_blank" rel="noopener noreferrer" className="mt-2 text-[11px] text-blue-500 hover:underline">{successLinkLabel || 'Open listing'} ↗</a>
            )}
          </div>
        ) : session.state === 'failed' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgb(239 68 68)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </div>
            <p className="text-xs font-medium text-red-500 mb-1">Failed</p>
            {session.error && <p className="text-[11px] text-gray-500 dark:text-zinc-400 max-h-16 overflow-y-auto px-2">{session.error}</p>}
          </div>
        ) : session.liveUrl ? (
          <iframe
            src={session.liveUrl}
            className="absolute inset-0 w-full h-full"
            style={{ border: 'none' }}
            allow="autoplay"
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => onConnected?.()}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-gray-200 dark:border-zinc-700 border-t-black dark:border-t-white animate-spin rounded-full mb-2" />
            <p className="text-[11px] text-gray-400 dark:text-zinc-500">{session.status || 'Starting...'}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      {session.state === 'failed' || (ended && session.state !== 'success') ? (
        <button
          onClick={handleRetry}
          className="w-full py-2 text-xs font-medium border-t border-gray-100 dark:border-zinc-800 text-black dark:text-zinc-50 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
        >
          Retry
        </button>
      ) : canEnd ? (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 dark:border-zinc-800">
          <span className="flex-1 text-[11px] text-gray-500 dark:text-zinc-400 truncate">
            {ending ? 'Ending…' : (session.status || '')}
          </span>
          <button
            onClick={handleEnd}
            disabled={ending}
            title="End this session"
            className="text-[11px] font-medium px-2 py-1 rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-60 transition"
          >
            End
          </button>
        </div>
      ) : session.state === 'running' && session.status ? (
        <div className="px-3 py-1.5 text-[11px] text-gray-500 dark:text-zinc-400 border-t border-gray-100 dark:border-zinc-800 truncate">
          {session.status}
        </div>
      ) : null}
    </div>
  )
}

function StatusBadge({ state }: { state: PostSession['state'] }) {
  if (state === 'success') {
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400">Done</span>
  }
  if (state === 'failed') {
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-500">Failed</span>
  }
  if (state === 'running') {
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
      Running
    </span>
  }
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">Waiting</span>
}
