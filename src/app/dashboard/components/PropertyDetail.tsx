'use client'

import { PropertyData, Unit } from '../types'
import { mapboxStaticUrl, compressImage, saveProperties } from '../utils'
import { MapboxPropertyView } from './FindProperty'

interface PropertyDetailProps {
  activeProperty: PropertyData
  setActiveProperty: (v: PropertyData) => void
  savedProperties: PropertyData[]
  setSavedProperties: (v: PropertyData[] | ((prev: PropertyData[]) => PropertyData[])) => void
  selectedImage: number
  setSelectedImage: (v: number) => void
  isDark: boolean
  setLightbox: (v: { images: string[]; index: number } | null) => void
  setExpandedMap: (v: boolean) => void
  expandedMap: boolean
  setShowGallery: (v: boolean) => void
  showGallery: boolean
  setShowGdriveInput: (v: 'property' | 'listing' | null) => void
  setGdriveInput: (v: string) => void
  setListingFlow: (v: 'units' | 'details' | 'kanban' | null) => void
  setListingUnits: (v: string[]) => void
  setUnitDrafts: (v: Record<string, any>) => void
  addUnit: () => void
  updateUnit: (unitId: string, field: keyof Unit, value: string) => void
  removeUnit: (unitId: string) => void
}

export default function PropertyDetail({
  activeProperty, setActiveProperty, savedProperties, setSavedProperties,
  selectedImage, setSelectedImage, isDark,
  setLightbox, setExpandedMap, expandedMap,
  setShowGallery, showGallery,
  setShowGdriveInput, setGdriveInput,
  setListingFlow, setListingUnits, setUnitDrafts,
  addUnit, updateUnit, removeUnit,
}: PropertyDetailProps) {
  const ap = activeProperty

  return (
    <div className="max-w-5xl mx-auto p-8">
      {/* Image Gallery with Map as last slide */}
      {(() => {
        const hasImages = ap.images && ap.images.length > 0
        const hasMap = ap.lat && ap.lon
        const totalSlides = (hasImages ? ap.images.length : 0) + (hasMap ? 1 : 0)
        const mapIndex = hasImages ? ap.images.length : 0
        const isMapSlide = selectedImage === mapIndex && hasMap
        const clampedImage = Math.min(selectedImage, totalSlides - 1)

        if (totalSlides === 0) {
          return (
            <div className="w-full rounded-xl bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center mb-8" style={{ height: '300px' }}>
              <span className="text-gray-400 dark:text-zinc-500">No images available</span>
            </div>
          )
        }

        return (
          <div className="mb-8">
            <div className="relative w-full rounded-xl bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 overflow-hidden mb-2 group" style={{ height: '500px' }}>
              {isMapSlide ? (
                <>
                  <img src={mapboxStaticUrl(ap.lat!, ap.lon!, 1200, 500, isDark) || ''} alt="Map" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setExpandedMap(true)}
                    className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 hover:bg-black/30 transition group/map"
                  >
                    <div className="px-5 py-3 bg-white dark:bg-zinc-900 shadow-lg font-bold text-sm flex items-center gap-2 text-gray-900 dark:text-zinc-50">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                      Open Interactive Map
                    </div>
                  </button>
                </>
              ) : hasImages ? (
                <>
                  <img src={ap.images[clampedImage]} alt={ap.name} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox({ images: ap.images, index: clampedImage })} />
                  <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setShowGallery(true)}
                      className="w-9 h-9 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full"
                      title="Gallery view"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    </button>
                    <button
                      onClick={() => setLightbox({ images: ap.images, index: clampedImage })}
                      className="w-9 h-9 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full"
                      title="Expand image"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    </button>
                  </div>
                </>
              ) : null}
              {totalSlides > 1 && (
                <>
                  <button
                    onClick={() => setSelectedImage(clampedImage === 0 ? totalSlides - 1 : clampedImage - 1)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <button
                    onClick={() => setSelectedImage(clampedImage === totalSlides - 1 ? 0 : clampedImage + 1)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/50 text-white text-xs font-medium rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    {clampedImage + 1} / {totalSlides}
                  </div>
                </>
              )}
            </div>
            {/* Thumbnail strip */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {hasImages && ap.images.map((img, i) => (
                <div key={i} className="relative group/thumb flex-shrink-0">
                  <button onClick={() => setSelectedImage(i)}
                    className={`w-24 h-16 rounded-md border-2 overflow-hidden block ${clampedImage === i ? 'border-black dark:border-zinc-300' : 'border-gray-200 dark:border-zinc-700'}`}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const newImages = (ap.images || []).filter((_, idx) => idx !== i)
                      const updated = { ...ap, images: newImages }
                      setActiveProperty(updated)
                      setSavedProperties(prev => {
                        const next = prev.map(p => p.id === updated.id ? updated : p)
                        saveProperties(next)
                        return next
                      })
                      if (clampedImage >= newImages.length) setSelectedImage(Math.max(0, newImages.length - 1))
                    }}
                    title="Delete image"
                    className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center bg-black/70 hover:bg-red-600 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
              <label className="flex-shrink-0 w-24 h-16 rounded-md border-2 border-dashed border-gray-300 dark:border-zinc-600 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-zinc-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400 dark:text-zinc-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="text-[9px] text-gray-400 dark:text-zinc-500 font-medium">Add</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files
                    if (!files || files.length === 0) return
                    const urls = await Promise.all(Array.from(files).map(f => compressImage(f)))
                    const newImages = [...(ap.images || []), ...urls]
                    const updated = { ...ap, images: newImages }
                    setActiveProperty(updated)
                    setSavedProperties(prev => {
                      const next = prev.map(p => p.id === updated.id ? updated : p)
                      saveProperties(next)
                      return next
                    })
                  }}
                />
              </label>
              <button
                onClick={() => { setGdriveInput(''); setShowGdriveInput('property') }}
                className="flex-shrink-0 w-24 h-16 rounded-md border-2 border-dashed border-gray-300 dark:border-zinc-600 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-zinc-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
                title="Import from Google Drive"
              >
                <svg width="16" height="16" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="opacity-40">
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                  <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00AC47"/>
                  <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 10.4z" fill="#EA4335"/>
                  <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2z" fill="#00832D"/>
                  <path d="m59.8 53h-32.3L13.75 76.8c1.35.8 2.9 1.2 4.55 1.2h36.7c1.65 0 3.2-.45 4.55-1.2z" fill="#2684FC"/>
                  <path d="M73.4 26.5 60.65 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.2 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
                </svg>
                <span className="text-[9px] text-gray-400 dark:text-zinc-500 font-medium">Drive</span>
              </button>
              {hasMap && (
                <button onClick={() => setSelectedImage(mapIndex)}
                  className={`flex-shrink-0 w-24 h-16 rounded-md border-2 overflow-hidden relative ${clampedImage === mapIndex ? 'border-black dark:border-zinc-300' : 'border-gray-200 dark:border-zinc-700'}`}>
                  <img src={mapboxStaticUrl(ap.lat!, ap.lon!, 200, 128, isDark) || ''} alt="Map" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                  </div>
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Header + Facts Grid */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold mb-1 dark:text-zinc-50">{ap.name}</h1>
        <p className="text-gray-600 dark:text-zinc-400 mb-4">{ap.address}</p>
        {ap.loopnetUrl && (
          <a href={ap.loopnetUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline text-gray-500 dark:text-zinc-400 mb-4">View on LoopNet</a>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          {[
            ['Type', ap.type],
            ['Total SF', ap.totalSqft],
            ['Year Built', ap.yearBuilt],
            ['Spaces', String(ap.units?.length || 0)],
          ].map(([label, val]) => (
            <div key={label} className="p-4 border-r border-b border-gray-200 dark:border-zinc-700 last:border-r-0">
              <div className="text-xs uppercase font-bold mb-1" style={{ color: 'var(--accent-muted)' }}>{label}</div>
              <div className="font-bold dark:text-zinc-50">{val || '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Highlights */}
      {ap.highlights && ap.highlights.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-extrabold mb-4 dark:text-zinc-50">Highlights</h2>
          <ul className="space-y-2">
            {ap.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-zinc-300">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-black flex-shrink-0"></span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Features */}
      {ap.features && Object.keys(ap.features).length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-extrabold mb-4 dark:text-zinc-50">Features</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
            {Object.entries(ap.features).map(([label, val]) => (
              <div key={label} className="p-4 border-r border-b border-gray-200 dark:border-zinc-700">
                <div className="text-xs uppercase font-bold mb-1" style={{ color: 'var(--accent-muted)' }}>{label}</div>
                <div className="font-bold text-sm dark:text-zinc-50">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spaces Available Table */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-extrabold dark:text-zinc-50">Spaces Available ({ap.units?.length || 0})</h2>
          <button onClick={addUnit} className="px-4 py-2 rounded-lg accent-btn text-sm font-bold">+ Add Unit</button>
        </div>
        {ap.units && ap.units.length > 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-zinc-700 overflow-x-auto overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Space</th>
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Size</th>
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Term</th>
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Rental Rate</th>
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Space Use</th>
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Condition</th>
                  <th className="p-3 text-left text-xs font-bold text-gray-500 dark:text-zinc-500 uppercase">Available</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {ap.units.map((unit) => (
                  <tr key={unit.id} className="border-b border-gray-200 dark:border-zinc-700 last:border-b-0">
                    <td className="p-3"><input value={unit.name} onChange={(e) => updateUnit(unit.id, 'name', e.target.value)} className="w-full bg-transparent outline-none text-sm font-medium dark:text-zinc-50" placeholder="Suite name" /></td>
                    <td className="p-3"><input value={unit.sqft} onChange={(e) => updateUnit(unit.id, 'sqft', e.target.value)} className="w-full bg-transparent outline-none text-sm dark:text-zinc-50" placeholder="SF" /></td>
                    <td className="p-3 text-sm dark:text-zinc-300">{unit.term || '—'}</td>
                    <td className="p-3"><input value={unit.price} onChange={(e) => updateUnit(unit.id, 'price', e.target.value)} className="w-full bg-transparent outline-none text-sm dark:text-zinc-50" placeholder="Rate" /></td>
                    <td className="p-3">
                      <select value={unit.type || ''} onChange={(e) => updateUnit(unit.id, 'type', e.target.value)} className="w-full bg-transparent outline-none text-sm dark:text-zinc-50 dark:bg-transparent cursor-pointer pr-6 appearance-none border-none focus:ring-0 focus:outline-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23999\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}>
                        <option value="">—</option>
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
                      </select>
                    </td>
                    <td className="p-3 text-sm dark:text-zinc-300">{unit.condition || '—'}</td>
                    <td className="p-3 text-sm dark:text-zinc-300">{unit.available || 'Now'}</td>
                    <td className="p-3 text-right"><button onClick={() => removeUnit(unit.id)} className="text-red-500 text-sm hover:underline">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-zinc-700 p-8 text-center text-gray-400 dark:text-zinc-500">No units added yet. Click &quot;+ Add Unit&quot; to add available spaces.</div>
        )}
        {ap.units && ap.units.length > 0 && (
          <div className="mt-4 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <td className="p-4 font-bold text-gray-700 dark:text-zinc-300">Total Units</td>
                  <td className="p-4 text-right font-bold text-gray-900 dark:text-zinc-50">{ap.units.length}</td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-gray-700 dark:text-zinc-300">Projected Earnings</td>
                  <td className="p-4 text-right">
                    <span className="px-3 py-1 rounded bg-green-500/20 text-green-700 dark:text-green-300 font-extrabold">
                      ${ap.units.reduce((sum, u) => sum + (parseInt(u.price?.replace(/\D/g, '') || '0') || 0), 0).toLocaleString()}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Property Overview */}
      {ap.overview && (
        <div className="mb-8">
          <h2 className="text-xl font-extrabold mb-4 dark:text-zinc-50">Property Overview</h2>
          <div className="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{ap.overview}</div>
        </div>
      )}

      {/* Facility Facts */}
      {ap.facilityFacts && Object.keys(ap.facilityFacts).length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-extrabold mb-4 dark:text-zinc-50">Facility Facts</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
            {Object.entries(ap.facilityFacts).map(([label, val]) => (
              <div key={label} className="p-4 border-r border-b border-gray-200 dark:border-zinc-700">
                <div className="text-xs uppercase font-bold mb-1" style={{ color: 'var(--accent-muted)' }}>{label}</div>
                <div className="font-bold text-sm dark:text-zinc-50">{val.replace(/<br\s*\/?>/gi, '\n').split('\n').filter(Boolean).map((line, i) => <span key={i}>{i > 0 && <br />}{line.trim()}</span>)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <button onClick={() => { setListingFlow('units'); setListingUnits([]); setUnitDrafts({}) }} className="px-6 py-3 rounded-lg accent-btn font-bold">Generate Listing</button>
      </div>
    </div>
  )
}
