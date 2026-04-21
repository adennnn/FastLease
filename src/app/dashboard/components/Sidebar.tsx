'use client'

import { useState, useEffect } from 'react'
import { PropertyData, Listing } from '../types'
import { saveProperties } from '../utils'

interface SidebarProps {
  savedProperties: PropertyData[]
  setSavedProperties: (v: PropertyData[] | ((prev: PropertyData[]) => PropertyData[])) => void
  activeProperty: PropertyData | null
  setActiveProperty: (v: PropertyData | null) => void
  showSearchView: boolean
  setShowSearchView: (v: boolean) => void
  setSearchAddress: (v: string) => void
  setShowConfirm: (v: boolean) => void
  setPendingProperty: (v: PropertyData | null) => void
  setMapView: (v: { lat: number; lon: number; address: string } | null) => void
  mapView: { lat: number; lon: number; address: string } | null
  setShowSuggestions: (v: boolean) => void
  selectedImage: number
  setSelectedImage: (v: number) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  editMode: boolean
  setEditMode: (v: boolean) => void
  showDashboardTab: boolean
  setShowDashboardTab: (v: boolean) => void
  showListings: boolean
  setShowListings: (v: boolean) => void
  showWarmup: boolean
  setShowWarmup: (v: boolean) => void
  showSignIn: boolean
  setShowSignIn: (v: boolean) => void
  setActiveListingView: (v: Listing | null) => void
  savedListings: Listing[]
  pinnedIds: string[]
  togglePin: (id: string) => void
  setShowSettings: (v: boolean) => void
}

export default function Sidebar({
  savedProperties, setSavedProperties, activeProperty, setActiveProperty,
  showSearchView, setShowSearchView, setSearchAddress,
  setShowConfirm, setPendingProperty, setMapView, mapView, setShowSuggestions,
  selectedImage, setSelectedImage,
  sidebarOpen, setSidebarOpen,
  editMode, setEditMode,
  showDashboardTab, setShowDashboardTab,
  showListings, setShowListings,
  showWarmup, setShowWarmup,
  showSignIn, setShowSignIn,
  setActiveListingView,
  savedListings, pinnedIds, togglePin, setShowSettings,
}: SidebarProps) {

  const pinnedProperties = savedProperties.filter(p => pinnedIds.includes(p.id))
  const unpinnedProperties = savedProperties.filter(p => !pinnedIds.includes(p.id))

  return (
    <>
      {/* Main sidebar */}
      <aside
        className="flex flex-col bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 transition-all duration-300 ease-in-out overflow-hidden"
        style={{ width: sidebarOpen ? '18rem' : '0', minWidth: sidebarOpen ? '18rem' : '0', opacity: sidebarOpen ? 1 : 0 }}
      >
        <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <button
            onClick={() => { setActiveProperty(null); setShowSearchView(true); setSearchAddress(''); setShowConfirm(false); setPendingProperty(null); setMapView(null); setShowSuggestions(false) }}
            className="text-2xl font-extrabold tracking-tight dark:text-zinc-50 hover:opacity-70 transition"
          >
            FastLease
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-md text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
            title="Collapse sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        </div>
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 space-y-1">
          <button
            onClick={() => { setActiveProperty(null); setShowSearchView(true); setSearchAddress(''); setShowConfirm(false); setPendingProperty(null); setMapView(null); setShowListings(false); setActiveListingView(null); setShowDashboardTab(false); setShowWarmup(false); setShowSignIn(false) }}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition ${!showDashboardTab && !showListings && !showWarmup && !showSignIn && !activeProperty ? 'bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}>
            Find Property
          </button>
          <button
            onClick={() => { setShowDashboardTab(true); setShowSearchView(false); setActiveProperty(null); setMapView(null); setShowConfirm(false); setShowListings(false); setActiveListingView(null); setShowWarmup(false); setShowSignIn(false) }}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition ${showDashboardTab ? 'bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}>
            Dashboard
          </button>
          <button
            onClick={() => { setShowListings(true); setActiveListingView(null); setShowSearchView(false); setActiveProperty(null); setMapView(null); setShowConfirm(false); setShowDashboardTab(false); setShowWarmup(false); setShowSignIn(false) }}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition ${showListings ? 'bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}>
            Listings {savedListings.length > 0 ? `(${savedListings.length})` : ''}
          </button>
          <button
            onClick={() => { setShowWarmup(true); setShowSearchView(false); setActiveProperty(null); setMapView(null); setShowConfirm(false); setShowListings(false); setActiveListingView(null); setShowDashboardTab(false); setShowSignIn(false) }}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition ${showWarmup ? 'bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}>
            Warm Accounts
          </button>
          <button
            onClick={() => { setShowSignIn(true); setShowWarmup(false); setShowSearchView(false); setActiveProperty(null); setMapView(null); setShowConfirm(false); setShowListings(false); setActiveListingView(null); setShowDashboardTab(false) }}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition ${showSignIn ? 'bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}>
            Sign In Accounts
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Pinned section */}
          {pinnedProperties.length > 0 && (
            <>
              <div className="px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-muted)' }}>Pinned</span>
              </div>
              <div className="px-2 space-y-1 mb-2">
                {pinnedProperties.map((prop) => {
                  const isActive = activeProperty?.id === prop.id && !showSearchView && !mapView
                  return (
                    <div key={prop.id} className="relative group/item">
                      <button
                        onClick={() => { if (!editMode) { setActiveProperty(prop); setShowSearchView(false); setSelectedImage(0); setMapView(null); setShowConfirm(false) } }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition text-sm ${
                          isActive
                            ? 'bg-black/5 dark:bg-white/5 text-black dark:text-zinc-100 font-semibold'
                            : 'hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300'
                        }`}
                      >
                        <div className="font-medium truncate flex items-center gap-1.5">
                          <span className="flex-shrink-0 text-sm">📌</span>
                          <span className="truncate">{prop.name}</span>
                        </div>
                        <div className={`text-xs truncate ml-[18px] ${isActive ? 'text-black/60 dark:text-zinc-300' : 'text-gray-500 dark:text-zinc-500'}`}>{prop.address}</div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(prop.id) }}
                        className="absolute top-1/2 -translate-y-1/2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full opacity-0 group-hover/item:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-zinc-700"
                        title="Unpin"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-zinc-500"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Properties section */}
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-muted)' }}>Properties</span>
            {savedProperties.length > 0 && (
              <button
                onClick={() => setEditMode(!editMode)}
                className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition"
              >
                {editMode ? 'Done' : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                  </svg>
                )}
              </button>
            )}
          </div>
          <div className="px-2 space-y-1">
            {unpinnedProperties.map((prop) => {
              const isActive = activeProperty?.id === prop.id && !showSearchView && !mapView
              return (
                <div key={prop.id} className="relative group/item">
                  {editMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const updated = savedProperties.filter(p => p.id !== prop.id)
                        setSavedProperties(updated)
                        saveProperties(updated)
                        if (activeProperty?.id === prop.id) setActiveProperty(updated[0] || null)
                        if (updated.length === 0) setEditMode(false)
                      }}
                      className="absolute top-1/2 -translate-y-1/2 right-2 z-10 w-5 h-5 bg-red-500 text-white text-xs font-bold flex items-center justify-center hover:bg-red-600 transition"
                      style={{ borderRadius: '9999px', lineHeight: 1 }}
                    >
                      &times;
                    </button>
                  )}
                  {!editMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(prop.id) }}
                      className="absolute top-1/2 -translate-y-1/2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full opacity-0 group-hover/item:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-zinc-700"
                      title="Pin property"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-zinc-500"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    </button>
                  )}
                  <button
                    onClick={() => { if (!editMode) { setActiveProperty(prop); setShowSearchView(false); setSelectedImage(0); setMapView(null); setShowConfirm(false) } }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition text-sm ${
                      isActive
                        ? 'bg-black/5 dark:bg-white/5 text-black dark:text-zinc-100 font-semibold'
                        : 'hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300'
                    } ${editMode ? 'wobble' : ''}`}
                  >
                    <div className="font-medium truncate">{prop.name}</div>
                    <div className={`text-xs truncate ${isActive ? 'text-black/60 dark:text-zinc-300' : 'text-gray-500 dark:text-zinc-500'}`}>{prop.address}</div>
                  </button>
                </div>
              )
            })}
          </div>
          {savedProperties.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500 text-sm">
              No properties yet.<br />Click &quot;Find Property&quot; to start.
            </div>
          )}
        </div>

        {/* Settings button at bottom */}
        <div className="border-t border-gray-100 dark:border-zinc-800 p-4 space-y-2">
          <EndAllSessionsButton />
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Settings
          </button>
        </div>
      </aside>
    </>
  )
}

function EndAllSessionsButton() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ active: number; queued: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch('/api/sessions/count', { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled) setCounts({ active: data.active ?? 0, queued: data.queued ?? 0 })
      } catch {}
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const handleClick = async () => {
    if (busy) return
    // Fire the UI broadcast IMMEDIATELY — every running tile in every tab flips
    // to "Stopped" the moment the user clicks, instead of waiting for the BU
    // round-trip (which has to list every active session, then issue stops in
    // parallel — that's 1-5 seconds of "Ending sessions..." otherwise).
    window.dispatchEvent(new CustomEvent('endAllSessions'))
    setBusy(true)
    setResult('Stopping...')
    try {
      const r = await fetch('/api/sessions/end-all', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) {
        setResult(`Error: ${data.error || 'failed'}`)
      } else {
        const stopped = data.stopped ?? 0
        const failed = (data.failed || []).length
        setResult(failed > 0 ? `Stopped ${stopped}, ${failed} failed` : `Stopped ${stopped}`)
      }
    } catch (e: any) {
      setResult(`Error: ${e.message || 'request failed'}`)
    } finally {
      setBusy(false)
      setTimeout(() => setResult(null), 4000)
    }
  }

  return (
    <div className="w-full flex flex-col gap-1">
      {counts && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {counts.active} active
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-zinc-500" />
            {counts.queued} queued
          </span>
        </div>
      )}
      <button
        onClick={handleClick}
        disabled={busy}
        title="Force-stop every active browser-use session on your account"
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
        </svg>
        {busy ? 'Ending sessions...' : result || 'End all sessions'}
      </button>
    </div>
  )
}
