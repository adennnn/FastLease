'use client'

import { useState, useEffect, useRef } from 'react'
import { PropertyData, Unit, Listing } from './types'
import { MAPBOX_TOKEN, getGreeting, getCityState, compressImage, saveProperties, saveListings, getListingSessions, saveListingSessions } from './utils'
import Sidebar from './components/Sidebar'
import FindProperty, { MapboxPropertyView } from './components/FindProperty'
import PropertyDetail from './components/PropertyDetail'
import DashboardTab from './components/DashboardTab'
import ListingsPage from './components/ListingsPage'
import GenerateListingFlow, { UnitDraft, PostSession } from './components/GenerateListingFlow'
import MultiSessionView from './components/MultiSessionView'
import WarmAccountsTab from './components/WarmAccountsTab'
import SignInAccountsTab from './components/SignInAccountsTab'
import LiveSessionsTab from './components/LiveSessionsTab'
import SettingsPage from './components/SettingsPage'
import { readSSEStream } from '@/hooks/useSSEStream'

// ─── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [savedProperties, setSavedProperties] = useState<PropertyData[]>([])
  const [activeProperty, setActiveProperty] = useState<PropertyData | null>(null)
  const [searchAddress, setSearchAddress] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSearchView, setShowSearchView] = useState(false)
  const [selectedImage, setSelectedImage] = useState(0)
  const [lightbox, setLightbox] = useState<{ images: string[], index: number } | null>(null)
  const [expandedMap, setExpandedMap] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [greeting, setGreeting] = useState('Good evening')
  const debounceRef = useRef<NodeJS.Timeout>()
  const [mapView, setMapView] = useState<{ lat: number; lon: number; address: string } | null>(null)
  const [pendingProperty, setPendingProperty] = useState<PropertyData | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loadingStep, setLoadingStep] = useState(0)
  const [browserLiveUrl, setBrowserLiveUrl] = useState<string | null>(null)
  const [listingFlow, setListingFlow] = useState<'units' | 'details' | 'kanban' | null>(null)
  const [listingUnits, setListingUnits] = useState<string[]>([])
  const [unitDrafts, setUnitDrafts] = useState<Record<string, UnitDraft>>({})
  const [gdriveTargetUnitId, setGdriveTargetUnitId] = useState<string | null>(null)
  const [multiPostingSessions, setMultiPostingSessions] = useState<PostSession[] | null>(null)
  const [savedListings, setSavedListings] = useState<Listing[]>([])
  const [activeListingView, setActiveListingView] = useState<Listing | null>(null)
  const [editingListing, setEditingListing] = useState(false)
  const [showListings, setShowListings] = useState(false)
  const [showDashboardTab, setShowDashboardTab] = useState(false)
  const [showWarmup, setShowWarmup] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [showLiveSessions, setShowLiveSessions] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const [errorToast, setErrorToast] = useState('')
  const [gdriveInput, setGdriveInput] = useState('')
  const [gdriveLoading, setGdriveLoading] = useState(false)
  const [showGdriveInput, setShowGdriveInput] = useState<'property' | 'listing' | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const [postingSuccess, setPostingSuccess] = useState<Listing | null>(null)

  useEffect(() => { setGreeting(getGreeting()) }, [])
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('leasely_listings')
    if (saved) setSavedListings(JSON.parse(saved))
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('leasely_pinned')
    if (saved) setPinnedIds(JSON.parse(saved))
  }, [])

  // Hydration guard. Needs to be STATE (not ref): the save effect fires in
  // the same commit cycle as the mount effect with the pre-setState default
  // `null`, so flipping a ref to true synchronously still lets the save run
  // with stale state and wipe the persisted key. As a state var, flipping
  // true schedules a re-render where both `listingsHydrated === true` AND
  // `multiPostingSessions` carries the restored value.
  const [listingsHydrated, setListingsHydrated] = useState(false)

  // Rehydrate in-progress listing-post sessions so a page reload doesn't lose
  // the live-view grid. Images from `listing` aren't persisted (too heavy) so
  // retry is disabled for rehydrated rows — user can re-post from Listings.
  useEffect(() => {
    const persisted = getListingSessions()
    if (persisted && persisted.length > 0) {
      const anyActive = persisted.some(s => s.state === 'running' || s.state === 'pending')
      if (!anyActive && persisted.every(s => s.state === 'success')) {
        saveListingSessions(null)
      } else {
        setMultiPostingSessions(persisted.map(p => ({
          id: p.id, unitId: p.unitId, unitName: p.unitName,
          profileId: p.profileId, profileName: p.profileName,
          liveUrl: p.liveUrl, status: p.status, state: p.state, error: p.error,
          facebookUrl: p.facebookUrl, browserSessionId: p.browserSessionId,
        })))
      }
    }
    setListingsHydrated(true)
  }, [])

  // Persist multiPostingSessions on change (strip `listing` — too heavy).
  useEffect(() => {
    if (!listingsHydrated) return
    if (!multiPostingSessions) { saveListingSessions(null); return }
    saveListingSessions(multiPostingSessions.map(s => ({
      id: s.id, unitId: s.unitId, unitName: s.unitName,
      profileId: s.profileId, profileName: s.profileName,
      liveUrl: s.liveUrl, status: s.status, state: s.state, error: s.error,
      facebookUrl: s.facebookUrl, browserSessionId: s.browserSessionId,
    })))
  }, [multiPostingSessions, listingsHydrated])

  // Reconnect-poll for rehydrated running sessions (SSE stream is dead after reload).
  const listingPollersRef = useRef<Map<string, { cancelled: boolean }>>(new Map())
  useEffect(() => {
    if (!multiPostingSessions) return
    for (const s of multiPostingSessions) {
      if (s.state !== 'running' && s.state !== 'pending') continue
      const sid = s.browserSessionId
      if (!sid) continue
      if (listingPollersRef.current.has(sid)) continue

      const token = { cancelled: false }
      listingPollersRef.current.set(sid, token)

      ;(async () => {
        // First fetch runs at the top of the iteration so the iframe reconnects
        // immediately on mount — no 5s blank gap after reload.
        for (let i = 0; i < 720; i++) { // 60min cap — postings are long-running
          if (token.cancelled) return
          try {
            const res = await fetch(`/api/warmup-session?sid=${encodeURIComponent(sid)}`)
            if (res.ok) {
              const { status, liveUrl } = await res.json()
              setMultiPostingSessions(prev => {
                if (!prev) return prev
                return prev.map(x => {
                  if (x.id !== s.id) return x
                  const terminal = ['stopped', 'error', 'completed', 'timed_out'].includes(status)
                  if (terminal) {
                    if (status === 'completed') return { ...x, state: 'success', liveUrl: null, status: 'Posted (reconnected)' }
                    return { ...x, state: 'failed', liveUrl: null, error: status === 'timed_out' ? 'Session timed out' : `Session ${status}` }
                  }
                  if (liveUrl && liveUrl !== x.liveUrl) return { ...x, liveUrl }
                  return x
                })
              })
            }
          } catch {}
          if (token.cancelled) return
          await new Promise(r => setTimeout(r, 5000))
        }
      })().finally(() => { listingPollersRef.current.delete(sid) })
    }
  }, [multiPostingSessions])

  useEffect(() => {
    const pollers = listingPollersRef.current
    return () => { pollers.forEach(t => { t.cancelled = true }); pollers.clear() }
  }, [])

  // Hydration guard for the active-tab persist effect below. Without it the
  // persist effect would fire on first render with all show-flags still false
  // and overwrite the saved tab key before the restore logic had a chance to
  // hydrate from it. See the equivalent pattern on `listingsHydrated` above.
  const [tabHydrated, setTabHydrated] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('leasely_properties')
    const props: PropertyData[] = saved ? JSON.parse(saved) : []
    if (props.length > 0) setSavedProperties(props)

    // Restore the last-viewed tab. Previously this effect always defaulted to
    // setActiveProperty(props[0]), which meant a reload from any other tab
    // (Warm Accounts, Listings, etc.) silently kicked the user back to the
    // first saved property's detail view. Persist-and-restore the high-level
    // tab so reloads land exactly where you left off.
    const savedTab = localStorage.getItem('leasely_active_tab')
    const savedPropertyId = localStorage.getItem('leasely_active_property_id')

    if (savedTab === 'dashboard') setShowDashboardTab(true)
    else if (savedTab === 'listings') setShowListings(true)
    else if (savedTab === 'warmup') setShowWarmup(true)
    else if (savedTab === 'signin') setShowSignIn(true)
    else if (savedTab === 'liveSessions') setShowLiveSessions(true)
    else if (savedTab === 'settings') setShowSettings(true)
    else if (savedTab === 'findProperty') setShowSearchView(true)
    else if (savedTab === 'property' && savedPropertyId) {
      const match = props.find(p => p.id === savedPropertyId)
      if (match) setActiveProperty(match)
      else if (props.length > 0) setActiveProperty(props[0])
    } else {
      // No saved tab yet (first visit) — legacy behavior: if we have saved
      // properties, open the first one so the dashboard doesn't feel empty.
      if (props.length > 0) setActiveProperty(props[0])
    }

    setTabHydrated(true)

    const addr = localStorage.getItem('leasely_address')
    if (addr) {
      localStorage.removeItem('leasely_address')
      setSearchAddress(addr)
      setShowSearchView(true)
      handleSearch(addr)
    }
  }, [])

  // Persist which top-level tab is currently showing so the mount effect
  // above can restore it. Gated on `tabHydrated` so the initial-render firing
  // (when all show-flags are still their defaults) doesn't clobber the saved
  // value before the restore logic has read it.
  useEffect(() => {
    if (!tabHydrated) return
    let tab = ''
    if (showDashboardTab) tab = 'dashboard'
    else if (showListings) tab = 'listings'
    else if (showWarmup) tab = 'warmup'
    else if (showSignIn) tab = 'signin'
    else if (showLiveSessions) tab = 'liveSessions'
    else if (showSettings) tab = 'settings'
    else if (showSearchView) tab = 'findProperty'
    else if (activeProperty) tab = 'property'

    if (tab) localStorage.setItem('leasely_active_tab', tab)
    else localStorage.removeItem('leasely_active_tab')

    if (tab === 'property' && activeProperty?.id) {
      localStorage.setItem('leasely_active_property_id', activeProperty.id)
    } else if (tab !== 'property') {
      // Don't leave a stale property id lying around when we're not on one —
      // otherwise switching between property detail views could misrestore.
      localStorage.removeItem('leasely_active_property_id')
    }
  }, [
    tabHydrated,
    showDashboardTab, showListings, showWarmup, showSignIn, showLiveSessions,
    showSettings, showSearchView, activeProperty,
  ])

  // Autocomplete with Mapbox
  useEffect(() => {
    if (searchAddress.length < 3 || !MAPBOX_TOKEN) { setSuggestions([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchAddress)}.json?access_token=${MAPBOX_TOKEN}&types=address,place,poi&limit=5&country=us`
        )
        const data = await res.json()
        setSuggestions(data.features || [])
        setShowSuggestions(true)
      } catch { setSuggestions([]) }
    }, 300)
  }, [searchAddress])

  const handleGdriveImport = async (target: 'property' | 'listing') => {
    const url = gdriveInput.trim()
    if (!url) return
    setGdriveLoading(true)
    try {
      const res = await fetch('/api/gdrive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to import')
      const images: string[] = data.images || []
      if (images.length === 0) throw new Error('No images found')
      if (target === 'listing') {
        if (gdriveTargetUnitId) {
          setUnitDrafts(prev => {
            const draft = prev[gdriveTargetUnitId!]
            if (!draft) return prev
            return { ...prev, [gdriveTargetUnitId!]: { ...draft, images: [...draft.images, ...images] } }
          })
        }
        if (activeProperty) {
          const newImages = [...(activeProperty.images || []), ...images]
          setActiveProperty({ ...activeProperty, images: newImages })
        }
      } else if (activeProperty) {
        const newImages = [...(activeProperty.images || []), ...images]
        const updated = { ...activeProperty, images: newImages }
        setActiveProperty(updated)
        setSavedProperties(prev => {
          const next = prev.map(p => p.id === updated.id ? updated : p)
          saveProperties(next)
          return next
        })
      }
      setToast(`Imported ${images.length} image${images.length !== 1 ? 's' : ''} from Google Drive`); setTimeout(() => setToast(''), 3000)
      setGdriveInput('')
      setShowGdriveInput(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Import failed'
      setErrorToast(msg); setTimeout(() => setErrorToast(''), 4000)
    } finally {
      setGdriveLoading(false)
    }
  }

  const runSinglePost = async (sessionId: string, listing: Listing, profileId: string) => {
    const updateSession = (patch: Partial<PostSession>) => {
      setMultiPostingSessions(prev => prev ? prev.map(s => s.id === sessionId ? { ...s, ...patch } : s) : prev)
    }
    updateSession({ state: 'running', status: 'Starting browser...', error: undefined, liveUrl: null })

    try {
      const res = await fetch('/api/post-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: listing.title,
          description: listing.description,
          price: listing.price,
          category: listing.category,
          condition: listing.condition,
          location: getCityState(listing.location),
          images: listing.images.filter(img => !img.startsWith('data:') && !img.startsWith('blob:')),
          calendarLink: listing.calendarLink || '',
          profileId,
        }),
      })

      await readSSEStream(res, ({ event, data }) => {
        if (event === 'liveUrl' && data.liveUrl) updateSession({ liveUrl: data.liveUrl, status: 'Connecting browser...', browserSessionId: data.sessionId || undefined })
        else if (event === 'session' && data.sessionId) updateSession({ browserSessionId: data.sessionId })
        else if (event === 'status' && data.message) updateSession({ status: data.message })
        else if (event === 'result') {
          if (data.listingUrl) {
            setSavedListings(prev => {
              const next = prev.map(l => l.id === listing.id ? { ...l, facebookUrl: data.listingUrl } : l)
              saveListings(next)
              return next
            })
          }
          updateSession({ state: 'success', facebookUrl: data.listingUrl, status: 'Posted', liveUrl: null })
        } else if (event === 'error') {
          throw new Error(data.error)
        }
      })
    } catch (e: any) {
      updateSession({ state: 'failed', error: e.message || 'Failed to post to Facebook', liveUrl: null })
    }
  }

  const handleMultiPost = (specs: Array<{ unitId: string; unitName: string; profileId: string; profileName: string; listing: Listing }>) => {
    const initial: PostSession[] = specs.map((s, i) => ({
      id: `${Date.now()}-${i}-${s.unitId}-${s.profileId}`,
      unitId: s.unitId,
      unitName: s.unitName,
      profileId: s.profileId,
      profileName: s.profileName,
      listing: s.listing,
      liveUrl: null,
      status: 'Queued',
      state: 'pending',
    }))
    setMultiPostingSessions(initial)
    setListingFlow(null)
    setShowSearchView(false)
    setActiveProperty(null)
    initial.forEach(session => { runSinglePost(session.id, session.listing!, session.profileId) })
  }

  const retrySession = (sessionId: string) => {
    const session = multiPostingSessions?.find(s => s.id === sessionId)
    if (!session) return
    // Rehydrated sessions don't carry the listing (too heavy to persist) — show
    // a toast so the user knows to re-post from the Listings page instead.
    if (!session.listing) {
      setErrorToast('Retry unavailable for reloaded sessions — go to Listings and post again')
      setTimeout(() => setErrorToast(''), 5000)
      return
    }
    runSinglePost(sessionId, session.listing, session.profileId)
  }

  const handleSearch = async (input: string) => {
    setShowSearchView(true)
    setShowConfirm(false)
    setPendingProperty(null)
    setShowSuggestions(false)
    setSuggestions([])
    setLoading(true)
    setLoadingStep(1)
    setBrowserLiveUrl(null)

    const isLoopnetUrl = input.includes('loopnet.com')
    const body = isLoopnetUrl
      ? { loopnetUrl: input.trim(), address: '' }
      : { address: input.trim() }

    try {
      setLoadingStep(2)
      const res = await fetch('/api/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      // Read SSE stream for live_url and final result
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let property: any = null

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events from buffer
          const events = buffer.split('\n\n')
          buffer = events.pop() || '' // keep incomplete event in buffer
          for (const evt of events) {
            const eventMatch = evt.match(/^event:(\w+)\ndata:([\s\S]+)$/)
            if (!eventMatch) continue
            const [, eventType, dataStr] = eventMatch
            try {
              const data = JSON.parse(dataStr)
              if (eventType === 'liveUrl' && data.liveUrl) {
                setBrowserLiveUrl(data.liveUrl)
              } else if (eventType === 'result') {
                property = data
              } else if (eventType === 'error') {
                console.error('Scrape error:', data.error)
              }
            } catch {}
          }
        }
      }

      setBrowserLiveUrl(null)
      setLoadingStep(3)

      if (!property) throw new Error('No result')

      // Geocode the address for map background
      if (MAPBOX_TOKEN && property.address) {
        try {
          const geoRes = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(property.address)}.json?access_token=${MAPBOX_TOKEN}&types=address,place,poi&limit=1&country=us`
          )
          const geoData = await geoRes.json()
          if (geoData.features?.[0]) {
            const [lon, lat] = geoData.features[0].center
            property.lat = lat
            property.lon = lon
          }
        } catch {}
      }

      setPendingProperty(property)
      setShowConfirm(true)
    } catch {
      setErrorToast('Scrape failed — could not load this listing. Try again or use a different URL.')
      setTimeout(() => setErrorToast(''), 5000)
    }
    setLoading(false)
    setLoadingStep(0)
    setBrowserLiveUrl(null)
    setShowSearchView(false)
  }

  const handleMapContinue = async () => {
    if (!mapView) return
    const { lat, lon, address: addr } = mapView
    setMapView(null)
    // Start scraping in background, show confirm immediately with manual fallback
    setPendingProperty({
      id: Date.now().toString(), address: addr, name: addr.split(',')[0] || addr,
      type: 'Commercial', totalSqft: '', yearBuilt: '', images: [], units: [],
      source: 'manual', lat, lon,
    })
    setShowConfirm(true)
    // Try scraping in background
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      })
      const property = await res.json()
      const hasData = (property.images?.length > 0) || (property.units?.length > 0) || (property.name && property.name !== addr.split(',')[0]?.trim())
      if (hasData) {
        setPendingProperty({ ...property, lat, lon })
      }
    } catch {}
  }

  const confirmProperty = () => {
    if (!pendingProperty) return
    const updated = [pendingProperty, ...savedProperties]
    setSavedProperties(updated)
    setActiveProperty(pendingProperty)
    saveProperties(updated)
    setShowConfirm(false); setPendingProperty(null); setShowSearchView(false); setSearchAddress(''); setMapView(null)
  }

  const addUnit = () => {
    if (!activeProperty) return
    const newUnit: Unit = { id: Date.now().toString(), name: `Suite ${(activeProperty.units?.length || 0) + 1}`, sqft: '', price: '', type: 'Office', status: 'Available' }
    const updated = { ...activeProperty, units: [...(activeProperty.units || []), newUnit] }
    setActiveProperty(updated); updateSavedProperty(updated)
  }

  const updateUnit = (unitId: string, field: keyof Unit, value: string) => {
    if (!activeProperty) return
    const units = activeProperty.units.map(u => u.id === unitId ? { ...u, [field]: value } : u)
    const updated = { ...activeProperty, units }
    setActiveProperty(updated); updateSavedProperty(updated)
  }

  const removeUnit = (unitId: string) => {
    if (!activeProperty) return
    const units = activeProperty.units.filter(u => u.id !== unitId)
    const updated = { ...activeProperty, units }
    setActiveProperty(updated); updateSavedProperty(updated)
  }

  const updateSavedProperty = (prop: PropertyData) => {
    const updated = savedProperties.map(p => p.id === prop.id ? prop : p)
    setSavedProperties(updated)
    saveProperties(updated)
  }

  const togglePin = (id: string) => {
    const next = pinnedIds.includes(id) ? pinnedIds.filter(p => p !== id) : [...pinnedIds, id]
    setPinnedIds(next)
    try { localStorage.setItem('leasely_pinned', JSON.stringify(next)) } catch {}
  }

  const renderMainContent = () => {
    // Multi-session posting grid
    if (multiPostingSessions && multiPostingSessions.length > 0) {
      return (
        <MultiSessionView
          sessions={multiPostingSessions}
          onRetry={retrySession}
          onDismissAll={() => { setMultiPostingSessions(null) }}
          onOpenListings={() => { setMultiPostingSessions(null); setShowListings(true); setShowSearchView(false) }}
          onConnected={(sessionId) => {
            setMultiPostingSessions(prev => prev ? prev.map(s =>
              s.id === sessionId && s.state === 'running' ? { ...s, status: 'Connected' } : s
            ) : prev)
          }}
        />
      )
    }

    // Map view, confirm property, loading, default greeting
    if (mapView && !showConfirm || showConfirm && pendingProperty || loading) {
      return (
        <FindProperty
          greeting={greeting}
          searchAddress={searchAddress}
          setSearchAddress={setSearchAddress}
          suggestions={suggestions}
          showSuggestions={showSuggestions}
          setShowSuggestions={setShowSuggestions}
          loading={loading}
          showSearchView={showSearchView}
          showConfirm={showConfirm}
          pendingProperty={pendingProperty}
          selectedImage={selectedImage}
          setSelectedImage={setSelectedImage}
          isDark={isDark}
          mapView={mapView}
          browserLiveUrl={browserLiveUrl}
          postingToFb={false}
          postingLiveUrl={null}
          postingStatus={''}
          handleSearch={handleSearch}
          handleMapContinue={handleMapContinue}
          confirmProperty={confirmProperty}
          setShowConfirm={setShowConfirm}
          setPendingProperty={setPendingProperty}
          setMapView={setMapView}
          setSuggestions={setSuggestions}
        />
      )
    }

    // Property detail
    if (activeProperty && !showSearchView) {
      return (
        <PropertyDetail
          activeProperty={activeProperty}
          setActiveProperty={setActiveProperty}
          savedProperties={savedProperties}
          setSavedProperties={setSavedProperties}
          selectedImage={selectedImage}
          setSelectedImage={setSelectedImage}
          isDark={isDark}
          setLightbox={setLightbox}
          setExpandedMap={setExpandedMap}
          expandedMap={expandedMap}
          setShowGallery={setShowGallery}
          showGallery={showGallery}
          setShowGdriveInput={setShowGdriveInput}
          setGdriveInput={setGdriveInput}
          setListingFlow={setListingFlow}
          setListingUnits={setListingUnits}
          setUnitDrafts={setUnitDrafts}
          addUnit={addUnit}
          updateUnit={updateUnit}
          removeUnit={removeUnit}
        />
      )
    }

    // Dashboard tab
    if (showDashboardTab) {
      return <DashboardTab />
    }

    // Warm Accounts tab
    if (showWarmup) {
      return <WarmAccountsTab />
    }

    // Sign In Accounts tab
    if (showSignIn) {
      return <SignInAccountsTab />
    }

    // Live Sessions tab
    if (showLiveSessions) {
      return <LiveSessionsTab />
    }

    // Listings view
    if (showListings) {
      return (
        <ListingsPage
          savedListings={savedListings}
          setSavedListings={setSavedListings}
          savedProperties={savedProperties}
          activeListingView={activeListingView}
          setActiveListingView={setActiveListingView}
          editingListing={editingListing}
          setEditingListing={setEditingListing}
          selectedImage={selectedImage}
          setSelectedImage={setSelectedImage}
          setToast={setToast}
          setErrorToast={setErrorToast}
          onRepost={(listing) => {
            const profiles = listing.postedBy ?? []
            if (profiles.length === 0) return
            const specs = profiles.map(p => ({
              unitId: listing.id,
              unitName: listing.title,
              profileId: p.profileId,
              profileName: p.profileName,
              listing,
            }))
            handleMultiPost(specs)
          }}
        />
      )
    }

    // Default: Greeting + LoopNet link input
    return (
      <FindProperty
        greeting={greeting}
        searchAddress={searchAddress}
        setSearchAddress={setSearchAddress}
        suggestions={suggestions}
        showSuggestions={showSuggestions}
        setShowSuggestions={setShowSuggestions}
        loading={loading}
        showSearchView={showSearchView}
        showConfirm={showConfirm}
        pendingProperty={pendingProperty}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
        isDark={isDark}
        mapView={mapView}
        browserLiveUrl={browserLiveUrl}
        postingToFb={false}
        postingLiveUrl={null}
        postingStatus={''}
        handleSearch={handleSearch}
        handleMapContinue={handleMapContinue}
        confirmProperty={confirmProperty}
        setShowConfirm={setShowConfirm}
        setPendingProperty={setPendingProperty}
        setMapView={setMapView}
        setSuggestions={setSuggestions}
      />
    )
  }

  return (
    <div className="h-screen flex bg-white dark:bg-zinc-950">
      {/* Sidebar */}
      <Sidebar
        savedProperties={savedProperties}
        setSavedProperties={setSavedProperties}
        activeProperty={activeProperty}
        setActiveProperty={setActiveProperty}
        showSearchView={showSearchView}
        setShowSearchView={setShowSearchView}
        setSearchAddress={setSearchAddress}
        setShowConfirm={setShowConfirm}
        setPendingProperty={setPendingProperty}
        setMapView={setMapView}
        mapView={mapView}
        setShowSuggestions={setShowSuggestions}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        editMode={editMode}
        setEditMode={setEditMode}
        showDashboardTab={showDashboardTab}
        setShowDashboardTab={setShowDashboardTab}
        showListings={showListings}
        setShowListings={setShowListings}
        showWarmup={showWarmup}
        setShowWarmup={setShowWarmup}
        showSignIn={showSignIn}
        setShowSignIn={setShowSignIn}
        showLiveSessions={showLiveSessions}
        setShowLiveSessions={setShowLiveSessions}
        setActiveListingView={setActiveListingView}
        savedListings={savedListings}
        pinnedIds={pinnedIds}
        togglePin={togglePin}
        setShowSettings={setShowSettings}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 z-20 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-sm text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
            title="Expand sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        )}
        {renderMainContent()}
      </main>

      {/* Settings Popup */}
      <SettingsPage open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Posting success popup */}
      {postingSuccess && (
        <div className="fixed inset-0 bg-black/30 z-[55] flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) { setPostingSuccess(null); setShowListings(true); setShowSearchView(false) } }}>
          <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 w-full max-w-sm mx-4 shadow-lg overflow-hidden">
            <div className="p-6 flex flex-col items-center">
              <div className="w-12 h-12 flex items-center justify-center mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h2 className="text-lg font-semibold dark:text-zinc-50">Listed on Facebook</h2>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1 text-center">{postingSuccess.title}</p>
            </div>
            {postingSuccess.images.length > 0 && (
              <div className="px-5">
                <div className="w-full h-36 bg-gray-50 dark:bg-zinc-800 overflow-hidden">
                  <img src={postingSuccess.images[0]} alt="" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
            <div className="p-5 space-y-2">
              {postingSuccess.facebookUrl ? (
                <a
                  href={postingSuccess.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 accent-btn font-medium text-sm flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Open Listing
                </a>
              ) : (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-1">Link unavailable — check your Facebook Marketplace listings</p>
              )}
              <button
                onClick={() => {
                  setPostingSuccess(null)
                  setActiveListingView(postingSuccess)
                  setSelectedImage(0)
                  setActiveProperty(null)
                  setShowListings(true)
                  setShowSearchView(false)
                }}
                className="w-full py-2.5 border border-gray-200 dark:border-zinc-700 font-medium text-sm hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition text-gray-600 dark:text-zinc-300"
              >Manage Listing</button>
              <button
                onClick={() => {
                  setPostingSuccess(null)
                  setActiveProperty(null)
                  setShowListings(true)
                  setShowSearchView(false)
                }}
                className="w-full py-2.5 text-sm text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition font-medium"
              >Go to Listings</button>
            </div>
          </div>
        </div>
      )}

      {/* Gallery view modal */}
      {showGallery && activeProperty && activeProperty.images.length > 0 && (
        <div className="fixed inset-0 bg-black/90 z-[55] flex flex-col" onClick={() => setShowGallery(false)}>
          <div className="flex items-center justify-between p-4">
            <h2 className="text-white font-bold text-lg">{activeProperty.name} — {activeProperty.images.length} photos</h2>
            <button onClick={() => setShowGallery(false)} className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white text-3xl">&times;</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4" onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-6xl mx-auto">
              {activeProperty.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => { setShowGallery(false); setLightbox({ images: activeProperty.images, index: i }) }}
                  className="aspect-square bg-zinc-800 overflow-hidden border-2 border-transparent hover:border-white/50 transition group/gal relative"
                >
                  <img src={img} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 text-white text-xs font-medium rounded-full opacity-0 group-hover/gal:opacity-100 transition-opacity">{i + 1}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Google Drive import modal */}
      {showGdriveInput && (
        <div className="fixed inset-0 bg-black/50 z-[55] flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setShowGdriveInput(null) }}>
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-lg mx-4 shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <svg width="24" height="24" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00AC47"/>
                <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 10.4z" fill="#EA4335"/>
                <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2z" fill="#00832D"/>
                <path d="m59.8 53h-32.3L13.75 76.8c1.35.8 2.9 1.2 4.55 1.2h36.7c1.65 0 3.2-.45 4.55-1.2z" fill="#2684FC"/>
                <path d="M73.4 26.5 60.65 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.2 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
              </svg>
              <h3 className="text-lg font-bold dark:text-zinc-50">Import from Google Drive</h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">Paste a Google Drive file or folder link. The file/folder must be publicly shared.</p>
            <input
              type="text"
              value={gdriveInput}
              onChange={(e) => setGdriveInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && gdriveInput.trim()) handleGdriveImport(showGdriveInput) }}
              placeholder="https://drive.google.com/drive/folders/... or /file/d/..."
              className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-50 outline-none text-sm focus:border-black dark:focus:border-zinc-400 mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setShowGdriveInput(null)} className="flex-1 py-2.5 border border-gray-300 dark:border-zinc-600 font-bold text-sm hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Cancel</button>
              <button
                onClick={() => handleGdriveImport(showGdriveInput)}
                disabled={!gdriveInput.trim() || gdriveLoading}
                className={`flex-1 py-2.5 font-bold text-sm transition ${gdriveInput.trim() && !gdriveLoading ? 'accent-btn' : 'bg-gray-200 dark:bg-zinc-700 text-gray-400 dark:text-zinc-500 cursor-not-allowed'}`}
              >
                {gdriveLoading ? 'Importing...' : 'Import Images'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 bg-black dark:bg-zinc-800 text-white text-sm font-medium shadow-lg border border-gray-700 dark:border-zinc-600" style={{ animation: 'slideInRight 0.3s ease-out' }}>
          {toast}
        </div>
      )}
      {/* Error toast */}
      {errorToast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 bg-red-600 text-white text-sm font-medium shadow-lg border border-red-500" style={{ animation: 'slideInRight 0.3s ease-out' }}>
          {errorToast}
        </div>
      )}

      {/* Image Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/70 hover:text-white text-3xl z-10">&times;</button>
          <div className="relative w-full h-full flex items-center justify-center p-8" onClick={e => e.stopPropagation()}>
            <img src={lightbox.images[lightbox.index]} alt="" className="max-w-full max-h-full object-contain" />
            {lightbox.images.length > 1 && (
              <>
                <button
                  onClick={() => setLightbox({ ...lightbox, index: lightbox.index === 0 ? lightbox.images.length - 1 : lightbox.index - 1 })}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button
                  onClick={() => setLightbox({ ...lightbox, index: lightbox.index === lightbox.images.length - 1 ? 0 : lightbox.index + 1 })}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/60 text-white text-sm font-medium rounded-full">
                  {lightbox.index + 1} / {lightbox.images.length}
                </div>
              </>
            )}
          </div>
          {/* Thumbnail strip */}
          {lightbox.images.length > 1 && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-2 max-w-[80vw] overflow-x-auto pb-2">
              {lightbox.images.map((img, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: i }) }}
                  className={`flex-shrink-0 w-16 h-12 border-2 overflow-hidden transition ${lightbox.index === i ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80'}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded Interactive Map */}
      {expandedMap && activeProperty?.lat && activeProperty?.lon && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col" onClick={() => setExpandedMap(false)}>
          <div className="flex items-center justify-between p-4">
            <h2 className="text-white font-bold">{activeProperty.name || activeProperty.address}</h2>
            <button onClick={() => setExpandedMap(false)} className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white text-3xl">&times;</button>
          </div>
          <div className="flex-1 mx-4 mb-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <MapboxPropertyView lat={activeProperty.lat} lon={activeProperty.lon} address={activeProperty.address} onContinue={() => setExpandedMap(false)} />
          </div>
        </div>
      )}

      {/* Generate Listing Flow */}
      {listingFlow && activeProperty && (
        <GenerateListingFlow
          activeProperty={activeProperty}
          setActiveProperty={setActiveProperty}
          savedProperties={savedProperties}
          setSavedProperties={setSavedProperties}
          listingFlow={listingFlow}
          setListingFlow={setListingFlow}
          listingUnits={listingUnits}
          setListingUnits={setListingUnits}
          unitDrafts={unitDrafts}
          setUnitDrafts={setUnitDrafts}
          savedListings={savedListings}
          setSavedListings={setSavedListings}
          setActiveListingView={setActiveListingView}
          handleMultiPost={handleMultiPost}
          setShowGdriveInput={setShowGdriveInput}
          setGdriveInput={setGdriveInput}
          setGdriveTargetUnitId={setGdriveTargetUnitId}
        />
      )}
    </div>
  )
}
