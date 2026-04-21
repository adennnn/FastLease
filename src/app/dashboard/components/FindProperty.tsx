'use client'

import { useState, useEffect, useRef } from 'react'
import { PropertyData } from '../types'
import { MAPBOX_TOKEN, mapboxStaticUrl } from '../utils'
import 'mapbox-gl/dist/mapbox-gl.css'

// ─── Loading Messages ────────────────────────────────────────────────────────
const LOADING_MESSAGES = [
  'Finding your property...',
  'Scanning LoopNet listings...',
  'Analyzing unit info...',
  'Pulling property details...',
  'Mapping the floor plan...',
  'Crunching the numbers...',
  'Almost there...',
]

function LoadingText() {
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % LOADING_MESSAGES.length)
        setFade(true)
      }, 200)
    }, 1800)
    return () => clearInterval(interval)
  }, [])

  return (
    <p
      className="text-sm text-gray-500 dark:text-zinc-400 font-medium transition-opacity duration-300"
      style={{ opacity: fade ? 1 : 0 }}
    >
      {LOADING_MESSAGES[index]}
    </p>
  )
}

// ─── Browser Use Live View with Progress Bar ─────────────────────────────────
function BrowserLiveView({ url, messages, estimate }: { url: string; messages?: string[]; estimate?: number }) {
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [msgIndex, setMsgIndex] = useState(0)
  const [msgFade, setMsgFade] = useState(true)
  const estimatedTotal = estimate || 120
  const statusMessages = messages || ['Scanning listing...']

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000)
      setElapsed(secs)
      const base = Math.min((secs / estimatedTotal) * 85, 85)
      const jitter = Math.random() * 5
      setProgress(Math.min(base + jitter, 95))
    }, 1500)
    return () => clearInterval(interval)
  }, [estimatedTotal])

  useEffect(() => {
    if (statusMessages.length <= 1) return
    const interval = setInterval(() => {
      setMsgFade(false)
      setTimeout(() => {
        setMsgIndex(i => (i + 1) % statusMessages.length)
        setMsgFade(true)
      }, 200)
    }, 3000)
    return () => clearInterval(interval)
  }, [statusMessages.length])

  const remaining = Math.max(estimatedTotal - elapsed, 5)

  return (
    <div className="w-full max-w-3xl flex flex-col items-center py-6">
      <div className="w-[95%] overflow-hidden border border-gray-200 dark:border-zinc-700" style={{ aspectRatio: '16/10' }}>
        <iframe
          src={url}
          className="w-full h-full"
          style={{ border: 'none' }}
          allow="autoplay"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
      {/* Progress bar */}
      <div className="w-[95%] bg-gray-300 dark:bg-zinc-700 h-1.5 overflow-hidden mt-10">
        <div
          className="h-full bg-black dark:bg-white transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="w-[95%] flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-black dark:bg-white animate-pulse" style={{ borderRadius: '50%' }} />
          <p className="text-sm text-gray-500 dark:text-zinc-400 font-medium transition-opacity duration-300" style={{ opacity: msgFade ? 1 : 0 }}>
            {statusMessages[msgIndex]}
          </p>
        </div>
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          ~{remaining}s remaining
        </p>
      </div>
    </div>
  )
}

// ─── Mapbox 3D Map Component ────────────────────────────────────────────────
const MAP_STYLES = [
  { id: 'standard', label: 'Default', style: 'mapbox://styles/mapbox/standard' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
]

export function MapboxPropertyView({
  lat, lon, address, onContinue,
}: {
  lat: number; lon: number; address: string; onContinue: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const mapboxRef = useRef<any>(null)
  const orbitRef = useRef<number | null>(null)
  const [cardVisible, setCardVisible] = useState(false)
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const defaultStyle = isDark ? 'standard' : 'light'
  const [mapStyle, setMapStyle] = useState(defaultStyle)
  const [showStylePicker, setShowStylePicker] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return
    let mapInstance: any = null

    import('mapbox-gl').then((mapboxgl) => {
      if (!containerRef.current) return
      mapboxgl.default.accessToken = MAPBOX_TOKEN
      mapboxRef.current = mapboxgl

      const styleObj = MAP_STYLES.find(s => s.id === mapStyle) || MAP_STYLES[0]
      mapInstance = new mapboxgl.default.Map({
        container: containerRef.current,
        style: styleObj.style,
        center: [lon, lat],
        zoom: 17.5,
        pitch: 60,
        bearing: 0,
        interactive: true,
        dragPan: true,
        dragRotate: true,
        scrollZoom: true,
        touchZoomRotate: true,
      })
      mapInstance.addControl(new mapboxgl.default.NavigationControl(), 'top-right')
      mapRef.current = mapInstance

      mapInstance.on('load', () => {
        mapInstance.resize()
        if (styleObj.id === 'standard') {
          try { mapInstance.setConfigProperty('basemap', 'lightPreset', isDark ? 'dusk' : 'day') } catch {}
        }

        const marker = new mapboxgl.default.Marker({ color: '#000000' })
          .setLngLat([lon, lat])
          .addTo(mapInstance)
        const mel = marker.getElement()
        mel.innerHTML = '<svg width="30" height="50" viewBox="0 0 30 50" style="transform:translateY(-30px)"><polygon points="15,50 0,25 10,25 10,0 20,0 20,25 30,25" fill="#000000"/></svg>'

        setCardVisible(true)
      })
    })

    return () => {
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [lat, lon, mapStyle])

  const staticImg = mapboxStaticUrl(lat, lon, 160, 128)

  return (
    <div className="relative w-full h-full" style={{ minHeight: '100%' }}>
      <div ref={containerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      {/* Map Style Toggle */}
      <div className="absolute top-3 left-3 z-20">
        <button
          onClick={() => setShowStylePicker(!showStylePicker)}
          className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-lg text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          {MAP_STYLES.find(s => s.id === mapStyle)?.label || 'Map'}
        </button>
        {showStylePicker && (
          <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl overflow-hidden min-w-[120px]">
            {MAP_STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => { setMapStyle(s.id); setShowStylePicker(false); setCardVisible(false) }}
                className={`w-full px-3 py-2 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-zinc-800 transition ${mapStyle === s.id ? 'bg-gray-100 dark:bg-zinc-800 text-black dark:text-white' : 'text-gray-600 dark:text-zinc-400'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {cardVisible && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="pointer-events-auto absolute bottom-6 left-4 w-64 overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg" style={{ animation: 'slideInLeft 0.4s ease-out both' }}>
            {staticImg && (
              <div className="w-full h-32 bg-gray-200 dark:bg-zinc-800">
                <img src={staticImg} alt={address} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-zinc-50">{address}</p>
            </div>
          </div>
          <div className="pointer-events-auto absolute bottom-8 right-4" style={{ animation: 'slideInRight 0.4s ease-out both' }}>
            <button type="button" onClick={onContinue} className="px-5 py-2.5 rounded-lg accent-btn font-bold text-sm">
              Continue
            </button>
          </div>
        </div>
      )}
      <style jsx>{`
        @keyframes slideInLeft {
          from { transform: translateX(-120%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Find Property Props ─────────────────────────────────────────────────────
interface FindPropertyProps {
  // State
  greeting: string
  searchAddress: string
  setSearchAddress: (v: string) => void
  suggestions: any[]
  showSuggestions: boolean
  setShowSuggestions: (v: boolean) => void
  loading: boolean
  showSearchView: boolean
  showConfirm: boolean
  pendingProperty: PropertyData | null
  selectedImage: number
  setSelectedImage: (v: number) => void
  isDark: boolean
  mapView: { lat: number; lon: number; address: string } | null
  browserLiveUrl: string | null
  postingToFb: boolean
  postingLiveUrl: string | null
  postingStatus: string
  // Handlers
  handleSearch: (input: string) => void
  handleMapContinue: () => void
  confirmProperty: () => void
  setShowConfirm: (v: boolean) => void
  setPendingProperty: (v: PropertyData | null) => void
  setMapView: (v: { lat: number; lon: number; address: string } | null) => void
  setSuggestions: (v: any[]) => void
}

export default function FindProperty({
  greeting, searchAddress, setSearchAddress, suggestions, showSuggestions, setShowSuggestions,
  loading, showSearchView, showConfirm, pendingProperty, selectedImage, setSelectedImage,
  isDark, mapView, browserLiveUrl, postingToFb, postingLiveUrl, postingStatus,
  handleSearch, handleMapContinue, confirmProperty,
  setShowConfirm, setPendingProperty, setMapView, setSuggestions,
}: FindPropertyProps) {

  // Mapbox 3D orbit
  if (mapView && !showConfirm) {
    return (
      <div className="h-full w-full relative">
        <MapboxPropertyView lat={mapView.lat} lon={mapView.lon} address={mapView.address} onContinue={handleMapContinue} />
      </div>
    )
  }

  // Confirm property — full-screen with images on top, map behind
  if (showConfirm && pendingProperty) {
    const hasImages = pendingProperty.images && pendingProperty.images.length > 0
    const hasMap = pendingProperty.lat && pendingProperty.lon
    return (
      <div className="relative h-full w-full overflow-y-auto">
        {/* Background: map or gradient */}
        {hasMap ? (
          <div className="absolute inset-0 z-0">
            <img src={mapboxStaticUrl(pendingProperty.lat!, pendingProperty.lon!, 1400, 900, isDark) || ''} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/60 dark:bg-black/70" />
          </div>
        ) : (
          <div className="absolute inset-0 z-0 bg-gray-100 dark:bg-zinc-950" />
        )}

        {/* Content overlay */}
        <div className="relative z-10 flex flex-col items-center justify-center min-h-full px-8 py-12">
          {/* Image gallery on top */}
          {hasImages && (
            <div className="w-full max-w-3xl mb-6">
              <div className="relative w-full h-72 rounded-xl overflow-hidden border border-white/20 shadow-2xl group">
                <img src={pendingProperty.images[selectedImage]} alt={pendingProperty.name} className="w-full h-full object-cover" />
                {pendingProperty.images.length > 1 && (
                  <>
                    <button
                      onClick={() => setSelectedImage(selectedImage === 0 ? pendingProperty.images.length - 1 : selectedImage - 1)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <button
                      onClick={() => setSelectedImage(selectedImage === pendingProperty.images.length - 1 ? 0 : selectedImage + 1)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                    <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/50 text-white text-xs font-medium rounded-full">
                      {selectedImage + 1} / {pendingProperty.images.length}
                    </div>
                  </>
                )}
              </div>
              {pendingProperty.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto mt-3 pb-1">
                  {pendingProperty.images.slice(0, 8).map((img, i) => (
                    <button key={i} onClick={() => setSelectedImage(i)}
                      className={`flex-shrink-0 w-20 h-14 rounded-lg border-2 overflow-hidden ${selectedImage === i ? 'border-white' : 'border-white/20'}`}>
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Info card */}
          <div className={`w-full max-w-3xl rounded-xl border p-6 shadow-2xl ${hasMap ? 'bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-white/20' : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700'}`}>
            <h2 className="text-2xl font-extrabold mb-1 dark:text-zinc-50">{pendingProperty.name}</h2>
            <p className="text-gray-600 dark:text-zinc-400 mb-4">{pendingProperty.address}</p>

            {(pendingProperty.type || pendingProperty.totalSqft || pendingProperty.yearBuilt) && (
              <div className="flex flex-wrap gap-3 mb-4">
                {pendingProperty.type && <span className="px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 dark:text-zinc-200 text-sm font-medium">{pendingProperty.type}</span>}
                {pendingProperty.totalSqft && <span className="px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 dark:text-zinc-200 text-sm">{pendingProperty.totalSqft} SF</span>}
                {pendingProperty.yearBuilt && <span className="px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 dark:text-zinc-200 text-sm">Built {pendingProperty.yearBuilt}</span>}
              </div>
            )}

            {pendingProperty.units && pendingProperty.units.length > 0 && (
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">{pendingProperty.units.length} space(s) found</p>
            )}

            {pendingProperty.message && (
              <div className={`p-3 mb-4 text-sm ${pendingProperty.source === 'loopnet' ? 'border border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'border border-yellow-500 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'}`}>
                {pendingProperty.message}
              </div>
            )}

            <div className="flex gap-4">
              <button onClick={() => { setShowConfirm(false); setPendingProperty(null); setMapView(null); setSelectedImage(0) }}
                className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-zinc-600 font-bold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Cancel</button>
              <button onClick={confirmProperty}
                className="flex-1 py-3 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white font-bold transition">Yes, Add Property</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Posting to Facebook
  if (postingToFb) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8">
        {postingLiveUrl ? (
          <BrowserLiveView url={postingLiveUrl} messages={[
            'Posting to Facebook Marketplace...',
            'Filling in listing details...',
            'Uploading photos...',
            'Setting price and location...',
            'Almost done...',
            'Publishing your listing...',
          ]} estimate={180} />
        ) : (
          <>
            <div className="mb-6 relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-gray-200 dark:border-zinc-700" />
              <div className="absolute inset-0 rounded-full border-4 border-t-[#1877F2] animate-spin" />
              <svg width="32" height="32" viewBox="0 0 24 24" fill="#1877F2" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </div>
            <p className="text-lg font-bold dark:text-zinc-50 mb-2">Posting to Facebook Marketplace</p>
            <p className="text-sm text-gray-500 dark:text-zinc-400">{postingStatus || 'Starting browser...'}</p>
          </>
        )}
      </div>
    )
  }

  // Loading — live browser view or building construction animation
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8">
        {browserLiveUrl ? (
          <BrowserLiveView url={browserLiveUrl} />
        ) : (
          <>
            <svg width="160" height="160" viewBox="0 0 160 160" className="mb-6">
              {/* Ground */}
              <rect x="20" y="140" width="120" height="4" rx="2" className="fill-gray-300 dark:fill-zinc-600" />

              {/* Building blocks stacking up */}
              <rect x="45" y="120" width="70" height="20" className="fill-gray-400 dark:fill-zinc-500" style={{ animation: 'blockDrop 2.4s ease-out infinite', animationDelay: '0s' }} />
              <rect x="45" y="100" width="70" height="20" className="fill-gray-500 dark:fill-zinc-400" style={{ animation: 'blockDrop 2.4s ease-out infinite', animationDelay: '0.3s' }} />
              <rect x="45" y="80" width="70" height="20" className="fill-gray-400 dark:fill-zinc-500" style={{ animation: 'blockDrop 2.4s ease-out infinite', animationDelay: '0.6s' }} />
              <rect x="45" y="60" width="70" height="20" className="fill-gray-500 dark:fill-zinc-400" style={{ animation: 'blockDrop 2.4s ease-out infinite', animationDelay: '0.9s' }} />
              <rect x="45" y="40" width="70" height="20" className="fill-gray-400 dark:fill-zinc-500" style={{ animation: 'blockDrop 2.4s ease-out infinite', animationDelay: '1.2s' }} />

              {/* Windows on each floor */}
              {[120, 100, 80, 60, 40].map((y, i) => (
                <g key={i} style={{ animation: 'blockDrop 2.4s ease-out infinite', animationDelay: `${i * 0.3}s` }}>
                  <rect x="52" y={y + 5} width="8" height="10" className="fill-gray-200 dark:fill-zinc-700" />
                  <rect x="66" y={y + 5} width="8" height="10" className="fill-gray-200 dark:fill-zinc-700" />
                  <rect x="80" y={y + 5} width="8" height="10" className="fill-gray-200 dark:fill-zinc-700" />
                  <rect x="94" y={y + 5} width="8" height="10" className="fill-gray-200 dark:fill-zinc-700" />
                </g>
              ))}

              {/* Crane arm */}
              <g style={{ animation: 'craneSwing 2.4s ease-in-out infinite' }}>
                {/* Vertical mast */}
                <rect x="118" y="10" width="4" height="130" className="fill-gray-600 dark:fill-zinc-400" />
                {/* Horizontal boom */}
                <rect x="40" y="10" width="82" height="4" className="fill-gray-600 dark:fill-zinc-400" />
                {/* Cable */}
                <line x1="60" y1="14" x2="60" y2="30" className="stroke-gray-500 dark:stroke-zinc-500" strokeWidth="1.5" strokeDasharray="3,2" />
                {/* Hook */}
                <path d="M56,30 L64,30 L62,36 Q60,40 58,36 Z" className="fill-gray-600 dark:fill-zinc-400" />
                {/* Block being carried */}
                <rect x="50" y="36" width="20" height="10" className="fill-gray-500 dark:fill-zinc-400" style={{ animation: 'blockPulse 1.2s ease-in-out infinite' }} />
              </g>

              {/* Counter weight */}
              <rect x="122" y="6" width="12" height="8" className="fill-gray-600 dark:fill-zinc-400" />
            </svg>
            <LoadingText />
            <style jsx>{`
              @keyframes blockDrop {
                0% { opacity: 0; transform: translateY(-20px); }
                15% { opacity: 1; transform: translateY(0); }
                85% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-20px); }
              }
              @keyframes craneSwing {
                0%, 100% { transform: rotate(0deg); transform-origin: 120px 140px; }
                50% { transform: rotate(-3deg); transform-origin: 120px 140px; }
              }
              @keyframes blockPulse {
                0%, 100% { opacity: 0.6; }
                50% { opacity: 1; }
              }
            `}</style>
          </>
        )}
      </div>
    )
  }

  // Default: Greeting + LoopNet link input
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <h1 className="text-4xl font-bold tracking-tight mb-3 dark:text-zinc-50">{greeting}, Aden</h1>
      <p className="text-gray-400 dark:text-zinc-500 mb-12 text-sm">Paste a LoopNet link to get started.</p>
      <div className="w-full max-w-xl relative">
        <input
          type="text"
          value={searchAddress}
          onChange={(e) => setSearchAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && searchAddress.trim()) handleSearch(searchAddress) }}
          placeholder="https://www.loopnet.com/Listing/..."
          className="w-full border border-gray-200 dark:border-zinc-700 rounded-xl px-5 py-3.5 text-base outline-none bg-white dark:bg-zinc-900 dark:text-zinc-50 placeholder-gray-300 dark:placeholder-zinc-600 transition"
          style={{ borderColor: undefined }}
          onFocus={e => e.target.style.borderColor = 'var(--accent-muted)'}
          onBlur={e => e.target.style.borderColor = ''}
          autoFocus
        />
        <button onClick={() => searchAddress.trim() && handleSearch(searchAddress)}
          className="w-full mt-3 py-3.5 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] text-white font-semibold text-sm transition">
          Import from LoopNet
        </button>
      </div>
    </div>
  )
}
