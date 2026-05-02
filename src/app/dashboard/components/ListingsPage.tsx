'use client'

import { useState, useEffect, useRef } from 'react'
import { Listing, PropertyData } from '../types'
import { saveListings, getProfileUrls, saveProfileUrls, getProfilesCache, saveProfilesCache } from '../utils'

interface Profile { id: string; name: string }

interface ListingsPageProps {
  savedListings: Listing[]
  setSavedListings: (v: Listing[] | ((prev: Listing[]) => Listing[])) => void
  savedProperties: PropertyData[]
  activeListingView: Listing | null
  setActiveListingView: (v: Listing | null) => void
  editingListing: boolean
  setEditingListing: (v: boolean) => void
  selectedImage: number
  setSelectedImage: (v: number) => void
  setToast: (v: string) => void
  setErrorToast: (v: string) => void
  onRepost?: (listing: Listing) => void
}

export default function ListingsPage({
  savedListings, setSavedListings, savedProperties,
  activeListingView, setActiveListingView,
  editingListing, setEditingListing,
  selectedImage, setSelectedImage,
  setToast, setErrorToast, onRepost,
}: ListingsPageProps) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [taggingId, setTaggingId] = useState<string | null>(null)
  // Per-pill popover — shows "View profile" + URL editor for a specific account on a specific card.
  const [pillPopover, setPillPopover] = useState<{ listingId: string; profileId: string } | null>(null)
  const [profileUrls, setProfileUrls] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState<Listing | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const pillPopoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Instant render from cache; refresh in background (see utils.ts).
    // Only overwrite cache + state when the response actually carries
    // profiles — a 429/500 returning {error:...} would otherwise blow
    // the visible list to empty (see "all my accounts disappeared" bug).
    const cached = getProfilesCache()
    if (cached && cached.length > 0) setProfiles(cached)
    fetch('/api/profiles')
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (Array.isArray(d.profiles)) {
          setProfiles(d.profiles)
          saveProfilesCache(d.profiles)
        }
      })
      .catch(() => {})
    setProfileUrls(getProfileUrls())
  }, [])

  // Close popovers on outside click
  useEffect(() => {
    if (!taggingId && !pillPopover) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (taggingId && popoverRef.current && !popoverRef.current.contains(target)) {
        setTaggingId(null)
      }
      if (pillPopover && pillPopoverRef.current && !pillPopoverRef.current.contains(target)) {
        setPillPopover(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [taggingId, pillPopover])

  const toggleProfileOnListing = (listingId: string, profile: Profile) => {
    const updated = savedListings.map(l => {
      if (l.id !== listingId) return l
      const current = l.postedBy ?? []
      const exists = current.some(p => p.profileId === profile.id)
      const next = exists
        ? current.filter(p => p.profileId !== profile.id)
        : [...current, { profileId: profile.id, profileName: profile.name }]
      return { ...l, postedBy: next.length > 0 ? next : undefined }
    })
    setSavedListings(updated)
    saveListings(updated)
  }

  const setProfileUrl = (profileId: string, url: string) => {
    setProfileUrls(prev => {
      const next = { ...prev }
      if (url.trim()) next[profileId] = url.trim()
      else delete next[profileId]
      saveProfileUrls(next)
      return next
    })
  }

  if (activeListingView) {
    // Single listing detail
    const prop = savedProperties.find(p => p.id === activeListingView.propertyId)
    const listing = activeListingView.images.length === 0 && prop?.images?.length
      ? { ...activeListingView, images: prop.images }
      : activeListingView
    return (
      <div className="max-w-3xl mx-auto p-8">
        {listing.images.length > 0 && (
          <div className="relative w-full h-80 bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 overflow-hidden mb-6 group">
            <img src={listing.images[selectedImage] || listing.images[0]} alt={listing.title} className="w-full h-full object-cover" />
            {listing.images.length > 1 && (
              <>
                <button onClick={() => setSelectedImage(selectedImage === 0 ? listing.images.length - 1 : selectedImage - 1)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button onClick={() => setSelectedImage(selectedImage === listing.images.length - 1 ? 0 : selectedImage + 1)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/50 text-white text-xs font-medium rounded-full">{selectedImage + 1} / {listing.images.length}</div>
              </>
            )}
          </div>
        )}
        {editingListing ? (
          <>
            {/* Reorder images */}
            {listing.images.length > 0 && (
              <div className="mb-6">
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-2">Reorder Images — drag or use arrows</label>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {listing.images.map((img, i) => (
                    <div
                      key={`${img}-${i}`}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('text/plain', String(i))}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        const from = parseInt(e.dataTransfer.getData('text/plain'))
                        if (isNaN(from) || from === i) return
                        const imgs = [...listing.images]
                        const [moved] = imgs.splice(from, 1)
                        imgs.splice(i, 0, moved)
                        setActiveListingView({ ...listing, images: imgs })
                      }}
                      className={`relative flex-shrink-0 w-28 h-20 border-2 overflow-hidden group/img cursor-grab active:cursor-grabbing ${i === 0 ? 'border-black dark:border-zinc-300' : 'border-gray-200 dark:border-zinc-700'}`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover pointer-events-none" />
                      {i === 0 && <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-bold">Cover</div>}
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/30 transition flex items-center justify-center gap-1 opacity-0 group-hover/img:opacity-100">
                        {i > 0 && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              const imgs = [...listing.images];
                              [imgs[i - 1], imgs[i]] = [imgs[i], imgs[i - 1]]
                              setActiveListingView({ ...listing, images: imgs })
                            }}
                            className="w-7 h-7 flex items-center justify-center bg-white/90 dark:bg-zinc-800/90 text-gray-700 dark:text-zinc-200 rounded-full"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                          </button>
                        )}
                        {i < listing.images.length - 1 && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              const imgs = [...listing.images];
                              [imgs[i], imgs[i + 1]] = [imgs[i + 1], imgs[i]]
                              setActiveListingView({ ...listing, images: imgs })
                            }}
                            className="w-7 h-7 flex items-center justify-center bg-white/90 dark:bg-zinc-800/90 text-gray-700 dark:text-zinc-200 rounded-full"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        )}
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setActiveListingView({ ...listing, images: listing.images.filter((_, j) => j !== i) })
                          }}
                          className="w-7 h-7 flex items-center justify-center bg-red-500/90 text-white rounded-full"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-2 flex items-center gap-3">
              <input value={listing.price || ''} onChange={e => setActiveListingView({ ...listing, price: e.target.value })} placeholder="Price" className="text-sm font-bold dark:text-zinc-50 bg-transparent border-b border-gray-300 dark:border-zinc-600 outline-none py-1 w-32" />
              <input value={listing.category} onChange={e => setActiveListingView({ ...listing, category: e.target.value })} className="px-2 py-0.5 bg-gray-100 dark:bg-zinc-800 text-xs font-medium dark:text-zinc-300 border-b border-gray-300 dark:border-zinc-600 outline-none w-28" />
            </div>
            <input value={listing.title} onChange={e => setActiveListingView({ ...listing, title: e.target.value })} className="text-2xl font-extrabold mb-1 dark:text-zinc-50 bg-transparent border-b border-gray-300 dark:border-zinc-600 outline-none w-full py-1" />
            <input value={listing.location} onChange={e => setActiveListingView({ ...listing, location: e.target.value })} className="text-sm text-gray-500 dark:text-zinc-400 mb-6 bg-transparent border-b border-gray-300 dark:border-zinc-600 outline-none w-full py-1" />
            <textarea value={listing.description} onChange={e => setActiveListingView({ ...listing, description: e.target.value })} rows={10} className="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed w-full mb-6 bg-transparent border border-gray-300 dark:border-zinc-600 outline-none p-3 resize-y" />
            <input value={listing.calendarLink || ''} onChange={e => setActiveListingView({ ...listing, calendarLink: e.target.value })} placeholder="Tour/calendar link" className="text-sm dark:text-zinc-300 bg-transparent border-b border-gray-300 dark:border-zinc-600 outline-none w-full py-1 mb-6" />
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-3">
              <span className="text-sm font-bold dark:text-zinc-50">{listing.price || 'Price TBD'}</span>
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-zinc-800 text-xs font-medium dark:text-zinc-300">{listing.category}</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-extrabold dark:text-zinc-50">{listing.title}</h1>
              <button
                onClick={() => { navigator.clipboard.writeText(listing.title); setToast('Title copied!'); setTimeout(() => setToast(''), 2000) }}
                className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 dark:text-zinc-600 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                title="Copy title"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <div className="flex items-center gap-2 mb-6">
              <p className="text-sm text-gray-500 dark:text-zinc-400">{listing.location}</p>
              <button
                onClick={() => { navigator.clipboard.writeText(listing.location); setToast('Location copied!'); setTimeout(() => setToast(''), 2000) }}
                className="flex-shrink-0 p-1 rounded-lg text-gray-300 dark:text-zinc-600 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                title="Copy location"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <div className="relative mb-6">
              <div className="flex items-start gap-2">
                <div className="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line flex-1">{listing.description}</div>
                <button
                  onClick={() => { navigator.clipboard.writeText(listing.description); setToast('Description copied!'); setTimeout(() => setToast(''), 2000) }}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 dark:text-zinc-600 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                  title="Copy description"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
            </div>
            {/* Image thumbnails with download */}
            {listing.images.length > 0 && (
              <div className="mb-6">
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-2">Images</label>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {listing.images.map((img, i) => (
                    <div key={i} className="relative flex-shrink-0 w-28 h-20 border border-gray-200 dark:border-zinc-700 overflow-hidden group/img">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 flex items-center justify-center gap-1.5 opacity-0 group-hover/img:opacity-100 transition-all">
                        <button
                          onClick={() => {
                            const a = document.createElement('a')
                            a.href = img
                            a.download = `listing-image-${i + 1}.jpg`
                            a.target = '_blank'
                            a.click()
                          }}
                          className="w-7 h-7 flex items-center justify-center bg-white/90 dark:bg-zinc-800/90 text-gray-700 dark:text-zinc-200 rounded-full"
                          title="Download image"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                        <button
                          onClick={() => { navigator.clipboard.writeText(img); setToast(`Image ${i + 1} URL copied!`); setTimeout(() => setToast(''), 2000) }}
                          className="w-7 h-7 flex items-center justify-center bg-white/90 dark:bg-zinc-800/90 text-gray-700 dark:text-zinc-200 rounded-full"
                          title="Copy image URL"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {listing.calendarLink && (
              <div className="p-4 border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/50 mb-6 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1">Tour Link</p>
                  <a href={listing.calendarLink} target="_blank" rel="noopener noreferrer" className="text-sm underline dark:text-zinc-300">{listing.calendarLink}</a>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(listing.calendarLink || ''); setToast('Tour link copied!'); setTimeout(() => setToast(''), 2000) }}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 dark:text-zinc-600 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                  title="Copy tour link"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
            )}
          </>
        )}
        <div className="flex gap-3">
          <button onClick={() => { setActiveListingView(null); setSelectedImage(0); setEditingListing(false) }} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Back to Listings</button>
          {editingListing ? (
            <button
              onClick={() => {
                const updated = savedListings.map(l => l.id === listing.id ? listing : l)
                setSavedListings(updated)
                saveListings(updated)
                setEditingListing(false)
                setToast('Listing saved!'); setTimeout(() => setToast(''), 2000)
              }}
              className="px-4 py-2 rounded-lg text-sm accent-btn font-semibold"
            >Save Changes</button>
          ) : (
            <button onClick={() => setEditingListing(true)} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Edit Listing</button>
          )}
          <button
            onClick={() => setConfirmDelete(listing)}
            className="px-4 py-2 rounded-lg text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition"
          >Delete Listing</button>
          {onRepost && (
            <button
              onClick={() => {
                if (!listing.postedBy || listing.postedBy.length === 0) {
                  setErrorToast('Tag an account first to repost')
                  setTimeout(() => setErrorToast(''), 3000)
                  return
                }
                onRepost(listing)
              }}
              className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50 flex items-center gap-2"
              title={listing.postedBy && listing.postedBy.length > 0
                ? `Repost to ${listing.postedBy.map(p => p.profileName).join(', ')}`
                : 'Tag an account first'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Repost
            </button>
          )}
          {listing.facebookUrl ? (
            <a
              href={listing.facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50 flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View Facebook Listing
            </a>
          ) : (
            <span className="ml-auto px-4 py-2 text-sm text-gray-400 dark:text-zinc-500 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Not posted to Facebook
            </span>
          )}
        </div>

        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)}>
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-50 mb-2">Delete this listing?</h2>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-5">
                &quot;{confirmDelete.title}&quot; will be permanently removed from your listings. This can&apos;t be undone.
                {confirmDelete.facebookUrl && ' The Facebook post will not be deleted.'}
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50"
                >Cancel</button>
                <button
                  onClick={() => {
                    const updated = savedListings.filter(l => l.id !== confirmDelete.id)
                    setSavedListings(updated)
                    localStorage.setItem('leasely_listings', JSON.stringify(updated))
                    setConfirmDelete(null)
                    setActiveListingView(null)
                    setEditingListing(false)
                    setToast('Listing deleted'); setTimeout(() => setToast(''), 2000)
                  }}
                  className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white font-semibold transition"
                >Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Listings grid (FB Marketplace style)
  return (
    <div className="max-w-5xl mx-auto p-8">
      <h1 className="text-2xl font-extrabold mb-6 dark:text-zinc-50">Your Listings</h1>
      {savedListings.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-zinc-500">
          <p className="text-lg font-semibold mb-2">No listings yet</p>
          <p className="text-sm">Select a property and click &quot;Generate Listing&quot; to create one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {savedListings.map((listing) => {
            const imgs = listing.images.length > 0 ? listing.images : (savedProperties.find(p => p.id === listing.propertyId)?.images || [])
            return (
            <div key={listing.id} className="border border-gray-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900 hover:shadow-lg transition-shadow">
              <div className="aspect-square bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                {imgs[0] ? (
                  <img src={imgs[0]} alt={listing.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-zinc-500 text-sm">No image</div>
                )}
              </div>
              <div className="p-3">
                {/* Account pills — top of card. Click a pill to view/edit its profile link. */}
                <div className="relative mb-2">
                  <div className="flex flex-wrap gap-1 items-center">
                    {(listing.postedBy ?? []).map(p => {
                      const url = profileUrls[p.profileId] || ''
                      const isOpen = pillPopover?.listingId === listing.id && pillPopover?.profileId === p.profileId
                      return (
                        <button
                          key={p.profileId}
                          onClick={e => {
                            e.stopPropagation()
                            setPillPopover(isOpen ? null : { listingId: listing.id, profileId: p.profileId })
                            setTaggingId(null)
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300 max-w-[160px] hover:brightness-95 transition"
                          title={url ? `View ${p.profileName}'s profile` : `Set profile link for ${p.profileName}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                          <span className="truncate">{p.profileName}</span>
                        </button>
                      )
                    })}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setTaggingId(taggingId === listing.id ? null : listing.id)
                        setPillPopover(null)
                      }}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border border-dashed border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-700 dark:hover:text-zinc-200 transition"
                    >
                      {listing.postedBy && listing.postedBy.length > 0 ? 'Edit' : '+ Tag account'}
                    </button>
                  </div>

                  {/* Pill popover — View profile + edit URL for a specific account */}
                  {pillPopover?.listingId === listing.id && (() => {
                    const pid = pillPopover.profileId
                    const pb = (listing.postedBy ?? []).find(x => x.profileId === pid)
                    if (!pb) return null
                    const url = profileUrls[pid] || ''
                    return (
                      <div
                        ref={pillPopoverRef}
                        className="absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-3"
                        onClick={e => e.stopPropagation()}
                      >
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-2">{pb.profileName}</p>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] dark:bg-blue-500/15 dark:text-blue-300 text-xs font-semibold hover:brightness-95 transition mb-2"
                          >
                            View profile
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
                          </a>
                        ) : (
                          <p className="text-xs text-gray-400 dark:text-zinc-500 mb-2">No profile link set yet.</p>
                        )}
                        <label className="block text-[10px] font-medium text-gray-500 dark:text-zinc-400 mb-1">Facebook profile URL</label>
                        <input
                          type="url"
                          defaultValue={url}
                          onBlur={e => setProfileUrl(pid, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { setProfileUrl(pid, (e.target as HTMLInputElement).value); setPillPopover(null) } }}
                          placeholder="https://facebook.com/…"
                          className="w-full text-xs rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 dark:text-zinc-50 px-2 py-1.5 outline-none focus:border-[var(--accent-muted)]"
                        />
                        <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-1.5">Saved once per account and reused everywhere.</p>
                      </div>
                    )
                  })()}

                  {/* Tag-accounts popover — check/uncheck which accounts posted this listing */}
                  {taggingId === listing.id && (
                    <div
                      ref={popoverRef}
                      className="absolute left-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-1"
                      onClick={e => e.stopPropagation()}
                    >
                      {profiles.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">No profiles found</div>
                      ) : (
                        profiles.map(p => {
                          const checked = (listing.postedBy ?? []).some(pb => pb.profileId === p.id)
                          return (
                            <label
                              key={p.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProfileOnListing(listing.id, p)}
                                className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                              />
                              <span className="truncate dark:text-zinc-200">{p.name}</span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>

                <p className="font-bold text-sm dark:text-zinc-50">{listing.price || 'Price TBD'}</p>
                <p className="text-sm text-gray-700 dark:text-zinc-300 truncate">{listing.title}</p>
                <p className="text-xs text-gray-500 dark:text-zinc-500 truncate mt-0.5">{listing.location}</p>
                <button
                  onClick={() => { setActiveListingView({ ...listing, images: imgs.length > 0 && listing.images.length === 0 ? imgs : listing.images }); setSelectedImage(0) }}
                  className="w-full mt-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-600 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-300"
                >Manage Listing</button>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
