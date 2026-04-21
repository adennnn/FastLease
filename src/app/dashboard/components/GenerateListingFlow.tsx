'use client'

import { useState, useEffect } from 'react'
import { PropertyData, Listing } from '../types'
import { getCityState, compressImage, saveListings, getProfilesCache, saveProfilesCache } from '../utils'

function calcMonthlyPrice(priceStr: string, sqftStr: string): string {
  if (!priceStr || !sqftStr) return ''
  const sqft = parseFloat(sqftStr.replace(/[^0-9.]/g, ''))
  if (!sqft || sqft <= 0) return ''
  const moMatch = priceStr.match(/\$?([\d,.]+)\s*(?:USD\s*)?\/\s*SF\s*\/\s*mo/i)
  if (moMatch) {
    const perSfMo = parseFloat(moMatch[1].replace(/,/g, ''))
    if (perSfMo > 0) return `$${Math.round(perSfMo * sqft).toLocaleString()}/mo`
  }
  const yrMatch = priceStr.match(/\$?([\d,.]+)\s*(?:USD\s*)?\/\s*SF\s*\/\s*yr/i)
  if (yrMatch) {
    const perSfYr = parseFloat(yrMatch[1].replace(/,/g, ''))
    if (perSfYr > 0) return `$${Math.round((perSfYr * sqft) / 12).toLocaleString()}/mo`
  }
  return priceStr
}

export interface UnitDraft {
  images: string[]
  title: string
  description: string
  price: string
  condition: string
  category: string
  location: string
  calendarLink: string
}

export interface Assignment {
  unitId: string
  profileId: string
  profileName: string
}

export interface PostSession {
  id: string
  unitId: string
  unitName: string
  profileId: string
  profileName: string
  listing?: Listing
  liveUrl?: string | null
  status?: string
  state: 'pending' | 'running' | 'success' | 'failed'
  error?: string
  facebookUrl?: string
  /** browser-use session id — set once the SSE 'session' event arrives.
   *  Lets the client re-poll /api/warmup-session after a page reload. */
  browserSessionId?: string
}

interface BrowserProfile {
  id: string
  name: string | null
  cookieDomains: string[] | null
  createdAt: string
  lastUsedAt: string | null
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min }

export function randomTestDraft(): Partial<UnitDraft> {
  const streetNums = [randInt(100, 9999)]
  const streetNames = ['Maple Ave', 'Oak St', 'Birch Rd', 'Cedar Blvd', 'Pine Way', 'Elm Ct', 'Walnut Dr', 'Hickory Ln', 'Magnolia Pl', 'Sycamore Pkwy']
  const cities = [
    { city: 'Austin', state: 'TX', zip: '78701' },
    { city: 'Denver', state: 'CO', zip: '80202' },
    { city: 'Nashville', state: 'TN', zip: '37203' },
    { city: 'Raleigh', state: 'NC', zip: '27601' },
    { city: 'Boise', state: 'ID', zip: '83702' },
    { city: 'Tampa', state: 'FL', zip: '33602' },
    { city: 'Charlotte', state: 'NC', zip: '28202' },
    { city: 'Phoenix', state: 'AZ', zip: '85003' },
    { city: 'Salt Lake City', state: 'UT', zip: '84101' },
    { city: 'Portland', state: 'OR', zip: '97204' },
  ]
  const categories = ['Office', 'Industrial', 'Retail', 'Flex', 'Medical', 'Warehouse', 'Mixed Use']
  const conditions = ['New', 'Like New', 'Good', 'Fair']
  const adjectives = ['Modern', 'Spacious', 'Bright', 'Newly Renovated', 'Premium', 'Versatile', 'Flexible', 'Well-Located', 'Turn-Key', 'Updated']
  const features = [
    'open floor plan with high ceilings',
    'private offices and conference rooms',
    'large windows providing natural light',
    'dedicated parking and easy highway access',
    'kitchenette and break room',
    'updated HVAC and lighting',
    'fiber-ready connectivity',
    'flexible build-out options',
    'loading dock access',
    'on-site security and 24/7 access',
  ]
  const closings = [
    'Ideal for growing businesses looking for a long-term home.',
    'Schedule a tour today to see this opportunity in person.',
    'Available immediately with flexible lease terms.',
    'A great fit for teams seeking a productive workspace.',
    'Perfect location with strong neighborhood demographics.',
  ]

  const sqft = randInt(800, 12000)
  const cat = pick(categories)
  const cond = pick(conditions)
  const adj = pick(adjectives)
  const loc = pick(cities)
  const street = `${pick(streetNums)} ${pick(streetNames)}`
  const f1 = pick(features)
  let f2 = pick(features); while (f2 === f1) f2 = pick(features)
  const close = pick(closings)
  const monthly = randInt(8, 60) * 100

  return {
    title: `${adj} ${sqft.toLocaleString()} SF ${cat} Space for Lease`,
    description: `${adj} ${sqft.toLocaleString()} SF ${cat.toLowerCase()} space available in ${loc.city}, ${loc.state}. This unit features ${f1}, plus ${f2}. ${close}`,
    price: `$${monthly.toLocaleString()}`,
    condition: cond,
    category: cat,
    location: `${street}, ${loc.city}, ${loc.state} ${loc.zip}`,
  }
}

export function makeDefaultUnitDraft(property: PropertyData, unitId: string): UnitDraft {
  const unit = property.units.find(u => u.id === unitId)
  const category = unit?.type || property.type || 'Commercial'
  const title = `${unit?.sqft || ''} SF ${unit?.type || property.type} for Lease — ${property.name}`.trim()
  const description = `${unit?.sqft || ''} SF of ${unit?.type || property.type} space available at ${property.address}. ${property.overview || ''}`.trim()
  return {
    images: [],
    title,
    description,
    price: calcMonthlyPrice(unit?.price || '', unit?.sqft || property.totalSqft || ''),
    condition: 'Good',
    category,
    location: property.address || '',
    calendarLink: '',
  }
}

interface Props {
  activeProperty: PropertyData
  setActiveProperty: (v: PropertyData) => void
  savedProperties: PropertyData[]
  setSavedProperties: (v: PropertyData[] | ((prev: PropertyData[]) => PropertyData[])) => void
  listingFlow: 'units' | 'details' | 'kanban' | null
  setListingFlow: (v: 'units' | 'details' | 'kanban' | null) => void
  listingUnits: string[]
  setListingUnits: (v: string[] | ((prev: string[]) => string[])) => void
  unitDrafts: Record<string, UnitDraft>
  setUnitDrafts: (v: Record<string, UnitDraft> | ((prev: Record<string, UnitDraft>) => Record<string, UnitDraft>)) => void
  savedListings: Listing[]
  setSavedListings: (v: Listing[] | ((prev: Listing[]) => Listing[])) => void
  setActiveListingView: (v: Listing | null) => void
  handleMultiPost: (sessions: Array<{ unitId: string; unitName: string; profileId: string; profileName: string; listing: Listing }>) => void
  setShowGdriveInput: (v: 'property' | 'listing' | null) => void
  setGdriveInput: (v: string) => void
  setGdriveTargetUnitId: (v: string | null) => void
}

export default function GenerateListingFlow({
  activeProperty, setActiveProperty, savedProperties, setSavedProperties,
  listingFlow, setListingFlow,
  listingUnits, setListingUnits,
  unitDrafts, setUnitDrafts,
  savedListings, setSavedListings, setActiveListingView,
  handleMultiPost,
  setShowGdriveInput, setGdriveInput, setGdriveTargetUnitId,
}: Props) {

  const [activeUnitTab, setActiveUnitTab] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [dragProfile, setDragProfile] = useState<BrowserProfile | null>(null)
  const [dragOverUnit, setDragOverUnit] = useState<string | null>(null)

  // Initialize first active tab when entering details
  useEffect(() => {
    if (listingFlow === 'details' && listingUnits.length > 0 && (!activeUnitTab || !listingUnits.includes(activeUnitTab))) {
      setActiveUnitTab(listingUnits[0])
    }
  }, [listingFlow, listingUnits, activeUnitTab])

  // Seed drafts for newly selected units
  useEffect(() => {
    setUnitDrafts(prev => {
      const next = { ...prev }
      let changed = false
      for (const uid of listingUnits) {
        if (!next[uid]) { next[uid] = makeDefaultUnitDraft(activeProperty, uid); changed = true }
      }
      // Remove drafts for unselected units
      for (const k of Object.keys(next)) {
        if (!listingUnits.includes(k)) { delete next[k]; changed = true }
      }
      return changed ? next : prev
    })
    // Prune assignments for unselected units
    setAssignments(prev => prev.filter(a => listingUnits.includes(a.unitId)))
  }, [listingUnits, activeProperty, setUnitDrafts])

  // Fetch profiles when entering kanban. Render cached list immediately so the
  // kanban view populates without waiting for the paginated cloud REST call;
  // swap in fresh data when it arrives.
  useEffect(() => {
    if (listingFlow !== 'kanban') return
    const cached = getProfilesCache()
    if (cached && cached.length > 0) {
      // Cache only keeps id/name/persistent; backfill the fields the full
      // BrowserProfile shape requires so the setter accepts it. The kanban
      // only reads id + name, so the stub values are never displayed.
      setProfiles(cached.map(p => ({
        id: p.id,
        name: p.name,
        cookieDomains: null,
        createdAt: '',
        lastUsedAt: null,
      })))
      setProfilesLoading(false)
    } else {
      setProfilesLoading(true)
    }
    fetch('/api/profiles').then(r => r.json()).then(d => {
      const fresh = Array.isArray(d.profiles) ? d.profiles : []
      setProfiles(fresh)
      saveProfilesCache(fresh)
    }).catch(() => { if (!cached) setProfiles([]) }).finally(() => setProfilesLoading(false))
  }, [listingFlow])

  const toggleUnit = (id: string) => {
    setListingUnits(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const updateDraft = (unitId: string, patch: Partial<UnitDraft>) => {
    setUnitDrafts(prev => ({ ...prev, [unitId]: { ...prev[unitId], ...patch } }))
  }

  const activeDraft = activeUnitTab ? unitDrafts[activeUnitTab] : null
  const activeUnit = activeUnitTab ? activeProperty.units.find(u => u.id === activeUnitTab) : null

  const isDraftValid = (d: UnitDraft | undefined) => !!d && d.title.trim().length > 0 && d.description.length >= 50 && d.images.length > 0
  const allDraftsValid = listingUnits.every(uid => isDraftValid(unitDrafts[uid]))

  const handleKanbanDrop = (unitId: string) => {
    if (!dragProfile) return
    setAssignments(prev => {
      if (prev.some(a => a.unitId === unitId && a.profileId === dragProfile.id)) return prev
      return [...prev, { unitId, profileId: dragProfile.id, profileName: dragProfile.name || 'Unnamed' }]
    })
    setDragProfile(null)
    setDragOverUnit(null)
  }

  const removeAssignment = (unitId: string, profileId: string) => {
    setAssignments(prev => prev.filter(a => !(a.unitId === unitId && a.profileId === profileId)))
  }

  const handleGenerateListing = () => {
    // Build a Listing per unit, then map assignments → sessions (one session per assignment)
    const unitListings: Record<string, Listing> = {}
    const newlySaved: Listing[] = []
    for (const uid of listingUnits) {
      const draft = unitDrafts[uid]
      if (!draft) continue
      // Collect unique accounts assigned to post this unit
      const seen = new Set<string>()
      const postedBy = assignments
        .filter(a => a.unitId === uid)
        .filter(a => (seen.has(a.profileId) ? false : (seen.add(a.profileId), true)))
        .map(a => ({ profileId: a.profileId, profileName: a.profileName }))
      const listing: Listing = {
        id: `${Date.now()}-${uid}`,
        propertyId: activeProperty.id,
        unitId: uid,
        title: draft.title,
        description: draft.description,
        price: draft.price,
        category: draft.category,
        condition: draft.condition,
        location: draft.location,
        calendarLink: draft.calendarLink,
        images: draft.images,
        createdAt: new Date().toISOString(),
        postedBy: postedBy.length > 0 ? postedBy : undefined,
      }
      unitListings[uid] = listing
      newlySaved.push(listing)
    }
    // Save listings
    const updated = [...newlySaved, ...savedListings]
    setSavedListings(updated)
    saveListings(updated)

    const sessions = assignments.map(a => {
      const listing = unitListings[a.unitId]
      const unit = activeProperty.units.find(u => u.id === a.unitId)
      return {
        unitId: a.unitId,
        unitName: unit?.name || 'Unit',
        profileId: a.profileId,
        profileName: a.profileName,
        listing,
      }
    })
    handleMultiPost(sessions)
  }

  const stepLabel =
    listingFlow === 'units' ? 'Step 1 — Select units'
    : listingFlow === 'details' ? `Step 2 — Listing details (${listingUnits.length} unit${listingUnits.length !== 1 ? 's' : ''})`
    : listingFlow === 'kanban' ? 'Step 3 — Assign Facebook accounts'
    : ''

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setListingFlow(null) }}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 w-full max-w-6xl mx-4 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold dark:text-zinc-50">Generate Listing</h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">{stepLabel}</p>
          </div>
          <button onClick={() => setListingFlow(null)} className="text-2xl text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-white">&times;</button>
        </div>

        {/* Step 1: Multi unit selection */}
        {listingFlow === 'units' && (
          <div className="p-6">
            {activeProperty.units && activeProperty.units.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
                {activeProperty.units.map((unit) => {
                  const selected = listingUnits.includes(unit.id)
                  return (
                    <button
                      key={unit.id}
                      onClick={() => toggleUnit(unit.id)}
                      className={`w-full text-left p-4 rounded-lg border transition ${
                        selected
                          ? 'border-black dark:border-zinc-100 bg-black/5 dark:bg-white/5'
                          : 'border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-sm dark:text-zinc-50">{unit.name || 'Unnamed Space'}</div>
                          <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                            {[unit.sqft && `${unit.sqft} SF`, unit.price, unit.type].filter(Boolean).join(' · ') || 'No details'}
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                          selected ? 'border-black dark:border-white bg-black dark:bg-white' : 'border-gray-300 dark:border-zinc-600'
                        }`}>
                          {selected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-zinc-400 text-center py-8">No units available. Add units first.</p>
            )}
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-500 dark:text-zinc-400">{listingUnits.length} unit{listingUnits.length !== 1 ? 's' : ''} selected</p>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setListingFlow(null)} className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-zinc-600 font-bold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Cancel</button>
              <button
                onClick={() => { if (listingUnits.length > 0) setListingFlow('details') }}
                className={`flex-1 py-3 rounded-lg font-bold transition ${
                  listingUnits.length > 0 ? 'accent-btn' : 'bg-gray-200 dark:bg-zinc-700 text-gray-400 dark:text-zinc-500 cursor-not-allowed'
                }`}
              >Next</button>
            </div>
          </div>
        )}

        {/* Step 2: Per-unit details with tabs */}
        {listingFlow === 'details' && activeDraft && activeUnit && (
          <div className="max-h-[85vh] overflow-y-auto">
            {/* Unit tabs */}
            <div className="flex gap-1 px-6 pt-4 border-b border-gray-200 dark:border-zinc-700 overflow-x-auto">
              {listingUnits.map(uid => {
                const u = activeProperty.units.find(x => x.id === uid)
                const valid = isDraftValid(unitDrafts[uid])
                const isActive = uid === activeUnitTab
                return (
                  <button
                    key={uid}
                    onClick={() => setActiveUnitTab(uid)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap flex items-center gap-2 ${
                      isActive
                        ? 'border-black dark:border-white text-black dark:text-zinc-50'
                        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-200'
                    }`}
                  >
                    <span>{u?.name || 'Unit'}</span>
                    {valid && <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>}
                  </button>
                )
              })}
            </div>

            {/* Images sub-section */}
            <div className="p-6 border-b border-gray-200 dark:border-zinc-700">
              <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-2">Images for this unit</label>
              {activeProperty.images && activeProperty.images.length > 0 ? (
                <div className="grid grid-cols-6 gap-2 max-h-[30vh] overflow-y-auto">
                  {activeProperty.images.map((img, i) => {
                    const selected = activeDraft.images.includes(img)
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          updateDraft(activeUnitTab!, {
                            images: selected ? activeDraft.images.filter(x => x !== img) : [...activeDraft.images, img],
                          })
                        }}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition w-full ${
                          selected ? 'border-black dark:border-white' : 'border-transparent hover:border-gray-300 dark:hover:border-zinc-600'
                        }`}
                      >
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        {selected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black dark:bg-white flex items-center justify-center">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                      </button>
                    )
                  })}
                  <label className="relative aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-600 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-zinc-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400 dark:text-zinc-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files
                        if (!files || files.length === 0) return
                        const urls = await Promise.all(Array.from(files).map(f => compressImage(f)))
                        updateDraft(activeUnitTab!, { images: [...activeDraft.images, ...urls] })
                        const newImages = [...(activeProperty.images || []), ...urls]
                        setActiveProperty({ ...activeProperty, images: newImages })
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <button
                    onClick={() => { setGdriveTargetUnitId(activeUnitTab); setGdriveInput(''); setShowGdriveInput('listing') }}
                    className="relative aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-zinc-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
                    title="Import from Google Drive"
                  >
                    <svg width="20" height="20" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="opacity-60">
                      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00AC47"/>
                      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 10.4z" fill="#EA4335"/>
                      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2z" fill="#00832D"/>
                      <path d="m59.8 53h-32.3L13.75 76.8c1.35.8 2.9 1.2 4.55 1.2h36.7c1.65 0 3.2-.45 4.55-1.2z" fill="#2684FC"/>
                      <path d="M73.4 26.5 60.65 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.2 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <label className="w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-zinc-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <input
                      type="file" accept="image/*" multiple className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files
                        if (!files || files.length === 0) return
                        const urls = await Promise.all(Array.from(files).map(f => compressImage(f)))
                        updateDraft(activeUnitTab!, { images: [...activeDraft.images, ...urls] })
                        const newImages = [...(activeProperty.images || []), ...urls]
                        setActiveProperty({ ...activeProperty, images: newImages })
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-2">{activeDraft.images.length} image{activeDraft.images.length !== 1 ? 's' : ''} selected</p>
            </div>

            {/* Details fields */}
            <div className="p-6 space-y-5">
              <div className="p-4 border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/50">
                <p className="text-xs text-gray-500 dark:text-zinc-500 uppercase font-bold mb-1">Unit</p>
                <p className="text-sm font-semibold dark:text-zinc-50">{activeUnit.name}</p>
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                  {[activeUnit.sqft && `${activeUnit.sqft} SF`, activeUnit.price, activeUnit.type].filter(Boolean).join(' · ')}
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => updateDraft(activeUnitTab!, randomTestDraft())}
                  className="mb-2 px-3 py-1.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-bold uppercase tracking-wider border border-amber-300 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition"
                  title="Autofill with randomized test data"
                >
                  ⚡ Test — Autofill Random
                </button>
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Title</label>
                <input
                  type="text"
                  value={activeDraft.title}
                  onChange={(e) => updateDraft(activeUnitTab!, { title: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none text-sm focus:border-black dark:focus:border-zinc-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Price</label>
                  <input
                    type="text"
                    value={activeDraft.price}
                    onChange={(e) => {
                      let v = e.target.value
                      v = v.replace(/^\$/, '')
                      if (v && /^\d/.test(v)) v = '$' + v
                      updateDraft(activeUnitTab!, { price: v })
                    }}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none text-sm focus:border-black dark:focus:border-zinc-400"
                    placeholder="$0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Asset Class</label>
                  <select
                    value={activeDraft.category}
                    onChange={(e) => updateDraft(activeUnitTab!, { category: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 text-sm cursor-pointer outline-none appearance-none pr-10"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23999\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                  >
                    <option value="Office">Office</option>
                    <option value="Industrial">Industrial</option>
                    <option value="Retail">Retail</option>
                    <option value="Flex">Flex</option>
                    <option value="Medical">Medical</option>
                    <option value="Warehouse">Warehouse</option>
                    <option value="Mixed Use">Mixed Use</option>
                    <option value="Multifamily">Multifamily</option>
                    <option value="Hospitality">Hospitality</option>
                    <option value="Land">Land</option>
                    <option value="Commercial">Commercial</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Condition</label>
                <select
                  value={activeDraft.condition}
                  onChange={(e) => updateDraft(activeUnitTab!, { condition: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 text-sm cursor-pointer outline-none appearance-none pr-10"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23999\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                >
                  <option value="New">New</option>
                  <option value="Like New">Like New</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Description <span className="font-normal normal-case text-gray-400 dark:text-zinc-600">(min 50 characters)</span></label>
                <textarea
                  value={activeDraft.description}
                  onChange={(e) => {
                    updateDraft(activeUnitTab!, { description: e.target.value })
                    e.target.style.height = 'auto'
                    e.target.style.height = `${e.target.scrollHeight}px`
                  }}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto'
                      el.style.height = `${el.scrollHeight}px`
                    }
                  }}
                  rows={5}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none text-sm resize-y focus:border-black dark:focus:border-zinc-400 overflow-hidden min-h-[8rem]"
                />
                <p className={`text-xs mt-1 ${activeDraft.description.length >= 50 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-zinc-500'}`}>{activeDraft.description.length} / 50 min</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Location</label>
                <input
                  type="text"
                  value={activeDraft.location}
                  onChange={(e) => updateDraft(activeUnitTab!, { location: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none text-sm focus:border-black dark:focus:border-zinc-400"
                />
                {activeDraft.location.trim() && (
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1.5">Marketplace tag: <span className="font-semibold text-gray-500 dark:text-zinc-400">{getCityState(activeDraft.location)}</span></p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-1.5">Tour Link</label>
                <input
                  type="text"
                  value={activeDraft.calendarLink}
                  onChange={(e) => updateDraft(activeUnitTab!, { calendarLink: e.target.value })}
                  placeholder="https://calendly.com/your-link"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none text-sm focus:border-black dark:focus:border-zinc-400"
                />
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-zinc-700">
              <button onClick={() => setListingFlow('units')} className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-zinc-600 font-bold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Back</button>
              <button
                onClick={() => { if (allDraftsValid) setListingFlow('kanban') }}
                className={`flex-1 py-3 rounded-lg font-bold transition ${
                  allDraftsValid ? 'accent-btn' : 'bg-gray-200 dark:bg-zinc-700 text-gray-400 dark:text-zinc-500 cursor-not-allowed'
                }`}
              >{allDraftsValid ? 'Next: Assign Accounts' : 'Complete all units to continue'}</button>
            </div>
          </div>
        )}

        {/* Step 3: Kanban */}
        {listingFlow === 'kanban' && (
          <div className="max-h-[85vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-zinc-700">
              <p className="text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase mb-3">Drag a Facebook profile onto a unit to assign</p>
              {profilesLoading ? (
                <div className="flex items-center gap-2 py-4">
                  <div className="w-4 h-4 border-2 border-gray-200 dark:border-zinc-700 border-t-gray-500 dark:border-t-zinc-400 animate-spin rounded-full" />
                  <span className="text-xs text-gray-400 dark:text-zinc-500">Loading profiles...</span>
                </div>
              ) : profiles.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">No browser profiles found</p>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {profiles.map(p => {
                    const hasFacebook = p.cookieDomains?.some(d => d.includes('facebook')) || false
                    const isAssigned = assignments.some(a => a.profileId === p.id)
                    return (
                      <div
                        key={p.id}
                        draggable={!isAssigned}
                        onDragStart={() => { if (!isAssigned) setDragProfile(p) }}
                        onDragEnd={() => { setDragProfile(null); setDragOverUnit(null) }}
                        className={`flex items-center gap-2 px-3 py-2 border transition select-none ${
                          isAssigned
                            ? 'border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 opacity-40 cursor-not-allowed'
                            : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 cursor-grab active:cursor-grabbing hover:border-gray-400 dark:hover:border-zinc-500'
                        }`}
                        title={isAssigned ? 'Already assigned' : ''}
                      >
                        <div className="w-6 h-6 bg-gray-100 dark:bg-zinc-700 rounded-full flex items-center justify-center text-[11px] font-medium text-gray-500 dark:text-zinc-400">
                          {(p.name || 'P')[0].toUpperCase()}
                        </div>
                        <span className={`text-xs font-medium truncate max-w-[140px] ${isAssigned ? 'line-through dark:text-zinc-500' : 'dark:text-zinc-200'}`}>{p.name || 'Unnamed'}</span>
                        {hasFacebook && <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400 font-medium">FB</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="p-6">
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${Math.min(listingUnits.length, 4)}, minmax(0, 1fr))` }}
              >
                {listingUnits.map(uid => {
                  const u = activeProperty.units.find(x => x.id === uid)
                  const draft = unitDrafts[uid]
                  const unitAssignments = assignments.filter(a => a.unitId === uid)
                  const assignedIds = new Set(unitAssignments.map(a => a.profileId))
                  const canDropHere = dragProfile && !assignedIds.has(dragProfile.id)
                  const isOver = dragOverUnit === uid
                  return (
                    <div
                      key={uid}
                      onDragOver={(e) => {
                        if (!dragProfile) return
                        if (assignedIds.has(dragProfile.id)) return
                        e.preventDefault()
                        setDragOverUnit(uid)
                      }}
                      onDragLeave={() => { if (dragOverUnit === uid) setDragOverUnit(null) }}
                      onDrop={(e) => { e.preventDefault(); handleKanbanDrop(uid) }}
                      className={`border-2 rounded-lg p-3 min-h-[200px] transition ${
                        isOver && canDropHere ? 'border-black dark:border-white bg-black/5 dark:bg-white/5'
                        : dragProfile && !canDropHere ? 'border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-900/10'
                        : 'border-gray-200 dark:border-zinc-700 border-dashed'
                      }`}
                    >
                      <div className="mb-3">
                        <div className="text-sm font-semibold dark:text-zinc-50 truncate">{u?.name || 'Unit'}</div>
                        <div className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">{draft?.title || ''}</div>
                      </div>
                      {draft?.images[0] && (
                        <div className="w-full h-20 bg-gray-100 dark:bg-zinc-800 overflow-hidden mb-3 rounded">
                          <img src={draft.images[0]} alt="" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {unitAssignments.length === 0 ? (
                          <p className="text-[11px] text-gray-400 dark:text-zinc-600 italic text-center py-3">
                            {dragProfile && !canDropHere ? 'Already assigned' : 'Drop profile here'}
                          </p>
                        ) : unitAssignments.map(a => (
                          <div key={a.profileId} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs">
                            <span className="flex-1 truncate dark:text-zinc-200">{a.profileName}</span>
                            <button onClick={() => removeAssignment(uid, a.profileId)} className="text-gray-400 hover:text-red-500 transition">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-zinc-700">
              <button onClick={() => setListingFlow('details')} className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-zinc-600 font-bold hover:bg-gray-50 dark:hover:bg-zinc-800 transition dark:text-zinc-50">Back</button>
              <button
                onClick={handleGenerateListing}
                disabled={assignments.length === 0}
                className={`flex-1 py-3 rounded-lg font-bold transition ${
                  assignments.length > 0 ? 'accent-btn' : 'bg-gray-200 dark:bg-zinc-700 text-gray-400 dark:text-zinc-500 cursor-not-allowed'
                }`}
              >Generate Listing ({assignments.length} post{assignments.length !== 1 ? 's' : ''})</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
