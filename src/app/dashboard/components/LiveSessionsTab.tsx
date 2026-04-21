'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface ActiveSession {
  id: string
  liveUrl: string | null
  status: string | null
  createdAt: string | null
  profileId: string | null
  profileName: string | null
}

export default function LiveSessionsTab() {
  const [items, setItems] = useState<ActiveSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState<Record<string, boolean>>({})
  const stoppedRef = useRef<Set<string>>(new Set())

  const fetchList = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const r = await fetch('/api/sessions/active', { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error || 'Failed to load sessions')
        return
      }
      const fresh: ActiveSession[] = data.items || []
      // Force = show whatever BU returns, no local suppression. Used by the
      // Refresh button so the user can always see ground truth.
      if (opts?.force) stoppedRef.current.clear()
      setItems(fresh.filter(s => !stoppedRef.current.has(s.id)))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Request failed')
    }
  }, [])

  const [refreshing, setRefreshing] = useState(false)
  const forceRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetch('/api/sessions/cleanup', { method: 'POST' }).catch(() => {})
      await fetchList({ force: true })
    } finally {
      setRefreshing(false)
    }
  }, [fetchList])

  useEffect(() => {
    fetchList()
    const id = setInterval(fetchList, 2000)
    return () => clearInterval(id)
  }, [fetchList])

  // When End-all-sessions fires, clear the grid instantly instead of waiting
  // for the next 5s poll — the BU stop requests are already in flight.
  useEffect(() => {
    const handler = () => {
      setItems(prev => {
        if (prev) for (const s of prev) stoppedRef.current.add(s.id)
        return []
      })
    }
    window.addEventListener('endAllSessions', handler)
    return () => window.removeEventListener('endAllSessions', handler)
  }, [])

  const stopOne = async (id: string) => {
    if (stopping[id]) return
    setStopping(prev => ({ ...prev, [id]: true }))
    // Remove the tile optimistically — it re-appears on the next poll if the
    // stop call fails, so the UI stays accurate either way.
    stoppedRef.current.add(id)
    const wasActive = items?.find(s => s.id === id)?.liveUrl
    setItems(prev => prev ? prev.filter(s => s.id !== id) : prev)
    if (wasActive) window.dispatchEvent(new CustomEvent('sessionEnded', { detail: { id, delta: 1 } }))
    try {
      await fetch('/api/sessions/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      })
    } catch {}
    setStopping(prev => ({ ...prev, [id]: false }))
  }

  if (items === null && !error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 dark:border-zinc-700 border-t-black dark:border-t-white animate-spin rounded-full" />
          <p className="text-xs text-gray-400 dark:text-zinc-500">Loading live sessions…</p>
        </div>
      </div>
    )
  }

  const list = items || []
  const active = list.filter(s => !!s.liveUrl).length
  const queued = list.length - active
  const cols = Math.min(Math.max(Math.ceil(Math.sqrt(Math.max(list.length, 1))), 1), 4)

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-bold dark:text-zinc-50 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"/>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"/>
            </span>
            Live Sessions
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            <span className="text-green-600 dark:text-green-400">{active} active</span>
            <span> · </span>
            <span>{queued} queued</span>
            <span> · </span>
            <span>{list.length} total</span>
          </p>
        </div>
        <button
          onClick={forceRefresh}
          disabled={refreshing}
          className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-zinc-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 transition font-medium disabled:opacity-60"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-4 py-2.5 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {list.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect x="3" y="4" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <p className="text-sm font-medium dark:text-zinc-200">No live sessions</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">Start a sign-in, warmup, or posting flow to see them here.</p>
          </div>
        ) : (
          <div
            className="grid gap-3 mx-auto"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: cols >= 3 ? '100%' : '1400px' }}
          >
            {list.map(s => (
              <LiveTile
                key={s.id}
                session={s}
                stopping={!!stopping[s.id]}
                onStop={() => stopOne(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LiveTile({ session, stopping, onStop }: { session: ActiveSession; stopping: boolean; onStop: () => void }) {
  const label = session.profileName || session.profileId || session.id.slice(0, 8)
  const subtitle = session.status || (session.liveUrl ? 'live' : 'starting…')
  return (
    <div className="border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-zinc-800 text-xs">
        <div className="flex-1 min-w-0">
          <div className="font-semibold dark:text-zinc-50 truncate">{label}</div>
          <div className="text-gray-400 dark:text-zinc-500 truncate">{subtitle}</div>
        </div>
        {session.liveUrl ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Live
          </span>
        ) : (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">Queued</span>
        )}
      </div>
      <div className="relative bg-gray-50 dark:bg-zinc-950" style={{ aspectRatio: '16/10' }}>
        {session.liveUrl ? (
          <iframe
            src={session.liveUrl}
            className="absolute inset-0 w-full h-full"
            style={{ border: 'none' }}
            allow="autoplay"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-gray-200 dark:border-zinc-700 border-t-black dark:border-t-white animate-spin rounded-full mb-2" />
            <p className="text-[11px] text-gray-400 dark:text-zinc-500">Waiting for live view…</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 dark:border-zinc-800">
        <span className="flex-1 text-[11px] text-gray-400 dark:text-zinc-500 truncate font-mono">{session.id.slice(0, 12)}</span>
        <button
          onClick={onStop}
          disabled={stopping}
          className="text-[11px] font-medium px-2 py-1 rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-60 transition"
        >
          {stopping ? 'Ending…' : 'End'}
        </button>
      </div>
    </div>
  )
}
