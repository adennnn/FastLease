'use client'

/**
 * /browserbase — parallel dashboard mirror, every feature stubbed.
 *
 * Visual match to /dashboard so the user can navigate the same shell, but
 * every action is a no-op until the underlying API route gets a `-bb`
 * Browserbase variant migrated. As routes are migrated, swap each tab's
 * <StubTab /> for the real component (passing it the BB endpoint).
 *
 * Migration tracker (true = wired to Browserbase, false = stub):
 *   findProperty:     false
 *   dashboard:        false
 *   listings:         false
 *   warmAccounts:     true   (warm-account-bb route exists, not yet wired here)
 *   signIn:           false
 *   liveSessions:     false
 */

import { useState } from 'react'
import Link from 'next/link'

type TabKey = 'findProperty' | 'dashboard' | 'listings' | 'warmAccounts' | 'signIn' | 'liveSessions' | 'settings'

interface NavItem {
  key: TabKey
  label: string
  migrated: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'findProperty', label: 'Find Property', migrated: false },
  { key: 'dashboard', label: 'Dashboard', migrated: false },
  { key: 'listings', label: 'Listings', migrated: false },
  { key: 'warmAccounts', label: 'Warm Accounts', migrated: false },
  { key: 'signIn', label: 'Sign In Accounts', migrated: false },
  { key: 'liveSessions', label: 'Live Sessions', migrated: false },
]

export default function BrowserbaseDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950">
      {/* Sidebar */}
      <aside
        className="flex flex-col bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 transition-all duration-300 ease-in-out overflow-hidden"
        style={{ width: sidebarOpen ? '18rem' : '0', minWidth: sidebarOpen ? '18rem' : '0', opacity: sidebarOpen ? 1 : 0 }}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-2xl font-extrabold tracking-tight dark:text-zinc-50">FastLease</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-blue-500 dark:text-blue-400 mt-0.5">Browserbase</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-md text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
            title="Collapse sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 space-y-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition flex items-center justify-between gap-2 ${
                activeTab === item.key
                  ? 'bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300'
                  : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <span>{item.label}</span>
              {!item.migrated && (
                <span className="text-[9px] font-mono uppercase tracking-wider text-gray-400 dark:text-zinc-500">stub</span>
              )}
            </button>
          ))}
        </div>

        {/* Properties placeholder */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-muted)' }}>Properties</span>
          </div>
          <div className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500 text-sm">
            No properties yet.<br />
            Property listing pending migration.
          </div>
        </div>

        {/* Bottom buttons */}
        <div className="border-t border-gray-100 dark:border-zinc-800 p-4 space-y-2">
          <button
            disabled
            title="Stub — Browserbase session control not wired"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 dark:text-zinc-600 border border-gray-200 dark:border-zinc-800 cursor-not-allowed opacity-60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
            </svg>
            End all sessions (stub)
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto">
        {/* Top banner */}
        <div className="border-b border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 bg-blue-500 text-white rounded">Browserbase</span>
            <span className="text-sm text-blue-900 dark:text-blue-200">
              Stub dashboard. Features get wired up as routes are migrated from browser-use to Browserbase.
            </span>
          </div>
          <Link
            href="/dashboard"
            className="text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline"
          >
            Back to /dashboard →
          </Link>
        </div>

        {/* Tab content */}
        <div className="p-8">
          <StubTabContent tab={activeTab} />
        </div>
      </main>

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4 dark:text-zinc-50">Settings</h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">Settings panel pending migration to Browserbase.</p>
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-sm font-medium rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StubTabContent({ tab }: { tab: TabKey }) {
  const tabMeta: Record<TabKey, { title: string; description: string; routes: string[]; status: 'stub' | 'migrated' }> = {
    findProperty: {
      title: 'Find Property',
      description: 'Search for a commercial property by address. Pulls from Mapbox + LoopNet scrape.',
      routes: ['/api/scrape', '/api/gdrive', '/api/generate-face'],
      status: 'stub',
    },
    dashboard: {
      title: 'Dashboard',
      description: 'Overview of saved properties, listings, account status, and active sessions.',
      routes: ['/api/sessions/active', '/api/sessions/count'],
      status: 'stub',
    },
    listings: {
      title: 'Listings',
      description: 'View, edit, and manage all generated FB Marketplace listings.',
      routes: ['/api/post-listing'],
      status: 'stub',
    },
    warmAccounts: {
      title: 'Warm Accounts',
      description: 'Warm up Facebook accounts (profile pic, cover, bio, city, browse activity) before posting.',
      routes: ['/api/warm-account'],
      status: 'stub',
    },
    signIn: {
      title: 'Sign In Accounts',
      description: 'Sign into Facebook accounts via agentic or manual flow. Persists session state to a Browserbase context.',
      routes: ['/api/account-signin', '/api/sync-account-info', '/api/fetch-profile-url'],
      status: 'stub',
    },
    liveSessions: {
      title: 'Live Sessions',
      description: 'Monitor and control active Browserbase sessions in real time.',
      routes: ['/api/sessions/active', '/api/sessions/stop', '/api/sessions/end-all', '/api/sessions/cleanup'],
      status: 'stub',
    },
    settings: {
      title: 'Settings',
      description: 'App-wide configuration.',
      routes: [],
      status: 'stub',
    },
  }

  const meta = tabMeta[tab]
  const bbRoute = (r: string) => r + '-bb'

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-3xl font-bold dark:text-zinc-50">{meta.title}</h1>
        <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded ${
          meta.status === 'migrated'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
            : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
        }`}>
          {meta.status}
        </span>
      </div>
      <p className="text-sm text-gray-500 dark:text-zinc-400 mb-8">{meta.description}</p>

      <div className="border border-dashed border-gray-300 dark:border-zinc-700 rounded-lg p-8 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4 text-gray-300 dark:text-zinc-600">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <p className="text-sm text-gray-400 dark:text-zinc-500 mb-4">
          Functionality not yet migrated to Browserbase.
        </p>
        {meta.routes.length > 0 && (
          <div className="text-xs text-gray-400 dark:text-zinc-500 space-y-1">
            <div className="font-bold uppercase tracking-wider mb-2">Pending routes</div>
            {meta.routes.map(r => (
              <div key={r} className="font-mono">
                <span className="text-gray-300 dark:text-zinc-600">{r}</span>
                <span className="mx-2 text-gray-300 dark:text-zinc-600">→</span>
                <span>{bbRoute(r)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
