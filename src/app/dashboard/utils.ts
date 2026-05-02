import { PropertyData, Listing } from './types'

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || ''

export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export const CITY_STATE: Record<string, string> = {
  'minneapolis': 'MN', 'st paul': 'MN', 'saint paul': 'MN', 'duluth': 'MN', 'rochester': 'MN', 'bloomington': 'MN', 'brooklyn park': 'MN', 'plymouth': 'MN', 'eagan': 'MN', 'woodbury': 'MN', 'maple grove': 'MN', 'eden prairie': 'MN',
  'chicago': 'IL', 'springfield': 'IL', 'peoria': 'IL', 'naperville': 'IL', 'rockford': 'IL', 'joliet': 'IL', 'aurora': 'IL', 'elgin': 'IL', 'decatur': 'IL', 'champaign': 'IL', 'ofallon': 'IL', "o'fallon": 'IL', 'belleville': 'IL',
  'new york': 'NY', 'brooklyn': 'NY', 'manhattan': 'NY', 'queens': 'NY', 'bronx': 'NY', 'buffalo': 'NY', 'albany': 'NY', 'syracuse': 'NY',
  'los angeles': 'CA', 'san francisco': 'CA', 'san diego': 'CA', 'sacramento': 'CA', 'san jose': 'CA', 'fresno': 'CA', 'oakland': 'CA', 'long beach': 'CA', 'bakersfield': 'CA', 'anaheim': 'CA', 'riverside': 'CA', 'irvine': 'CA',
  'houston': 'TX', 'dallas': 'TX', 'austin': 'TX', 'san antonio': 'TX', 'fort worth': 'TX', 'el paso': 'TX', 'arlington': 'TX', 'plano': 'TX', 'irving': 'TX', 'frisco': 'TX',
  'phoenix': 'AZ', 'tucson': 'AZ', 'mesa': 'AZ', 'scottsdale': 'AZ', 'chandler': 'AZ', 'tempe': 'AZ', 'gilbert': 'AZ',
  'philadelphia': 'PA', 'pittsburgh': 'PA', 'allentown': 'PA', 'erie': 'PA',
  'jacksonville': 'FL', 'miami': 'FL', 'tampa': 'FL', 'orlando': 'FL', 'st petersburg': 'FL', 'fort lauderdale': 'FL', 'tallahassee': 'FL',
  'columbus': 'OH', 'cleveland': 'OH', 'cincinnati': 'OH', 'toledo': 'OH', 'akron': 'OH', 'dayton': 'OH',
  'indianapolis': 'IN', 'fort wayne': 'IN', 'evansville': 'IN', 'south bend': 'IN',
  'charlotte': 'NC', 'raleigh': 'NC', 'greensboro': 'NC', 'durham': 'NC', 'winston-salem': 'NC',
  'seattle': 'WA', 'spokane': 'WA', 'tacoma': 'WA', 'bellevue': 'WA',
  'denver': 'CO', 'colorado springs': 'CO', 'aurora co': 'CO', 'boulder': 'CO',
  'nashville': 'TN', 'memphis': 'TN', 'knoxville': 'TN', 'chattanooga': 'TN',
  'portland': 'OR', 'salem': 'OR', 'eugene': 'OR',
  'detroit': 'MI', 'grand rapids': 'MI', 'ann arbor': 'MI', 'lansing': 'MI',
  'atlanta': 'GA', 'savannah': 'GA', 'augusta': 'GA',
  'boston': 'MA', 'worcester': 'MA', 'cambridge': 'MA',
  'las vegas': 'NV', 'reno': 'NV', 'henderson': 'NV',
  'milwaukee': 'WI', 'madison': 'WI', 'green bay': 'WI',
  'kansas city': 'MO', 'st louis': 'MO', 'saint louis': 'MO',
  'baltimore': 'MD', 'louisville': 'KY', 'oklahoma city': 'OK', 'tulsa': 'OK',
  'omaha': 'NE', 'lincoln': 'NE', 'new orleans': 'LA', 'baton rouge': 'LA',
  'salt lake city': 'UT', 'boise': 'ID', 'des moines': 'IA', 'cedar rapids': 'IA',
  'little rock': 'AR', 'birmingham': 'AL', 'huntsville': 'AL',
  'richmond': 'VA', 'virginia beach': 'VA', 'norfolk': 'VA',
  'columbia': 'SC', 'charleston': 'SC',
  'honolulu': 'HI', 'anchorage': 'AK',
  'washington': 'DC', 'dc': 'DC',
}

export function getCityState(input: string): string {
  const trimmed = input.trim()
  // Match "..., City, ST [ZIP]" / "City, ST [ZIP]" / "City, ST" — strip street + zip, keep city + state
  const m = trimmed.match(/(?:^|,)\s*([^,]+?),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/)
  if (m) return `${m[1].trim()}, ${m[2]}`
  const lower = trimmed.toLowerCase().replace(/,?\s*$/, '')
  const state = CITY_STATE[lower]
  if (state) return `${trimmed}, ${state}`
  return trimmed
}

export function compressImage(file: File, maxWidth = 1200, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let w = img.width, h = img.height
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.src = URL.createObjectURL(file)
  })
}

export function saveProperties(props: PropertyData[]) {
  const withData = props.map(p => ({ ...p, images: p.images.filter(img => !img.startsWith('blob:')) }))
  try { localStorage.setItem('leasely_properties', JSON.stringify(withData)); return } catch {}
  const clean = props.map(p => ({ ...p, images: p.images.filter(img => img.startsWith('http')) }))
  try { localStorage.setItem('leasely_properties', JSON.stringify(clean)) } catch {}
}

export function saveListings(listings: Listing[]) {
  const withData = listings.map(l => ({ ...l, images: l.images.filter(img => !img.startsWith('blob:')) }))
  try { localStorage.setItem('leasely_listings', JSON.stringify(withData)); return } catch {}
  const clean = listings.map(l => ({ ...l, images: l.images.filter(img => img.startsWith('http')) }))
  try { localStorage.setItem('leasely_listings', JSON.stringify(clean)) } catch {}
}

/**
 * Accounts the user has marked as "already warmed up" — no work needed.
 * Explicit `true` / `false` (not missing) = user override. Missing keys fall through
 * to auto-detection from the profile name (e.g. "David Hartz - good").
 */
export function getWarmedAccounts(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('leasely_warmed_accounts')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export function saveWarmedAccounts(m: Record<string, boolean>) {
  try { localStorage.setItem('leasely_warmed_accounts', JSON.stringify(m)) } catch {}
}

/** Browser-use profile IDs the user has hidden from the Warm Accounts view.
 *  Purely local — does NOT delete the profile from browser-use cloud. Lets the
 *  user prune duds / duplicates from the list without destroying real data.
 *  Keyed by profileId → true means hidden. */
export function getHiddenAccounts(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('leasely_hidden_accounts')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export function saveHiddenAccounts(m: Record<string, boolean>) {
  try { localStorage.setItem('leasely_hidden_accounts', JSON.stringify(m)) } catch {}
}

/** Heuristic to detect accounts that are already warmed, based on the name convention. */
export function looksAlreadyWarm(name: string): boolean {
  return /\b-\s*good\b/i.test(name)
}

/** Facebook profile URL per browser-use profileId. Set once per account, reused everywhere. */
export function getProfileUrls(): Record<string, string> {
  try {
    const raw = localStorage.getItem('leasely_profile_urls')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export function saveProfileUrls(urls: Record<string, string>) {
  try { localStorage.setItem('leasely_profile_urls', JSON.stringify(urls)) } catch {}
}

/** Generated warmup identity per browser profile.
 *
 *  Storage split (because base64 dataUrls blow the ~5MB localStorage cap with
 *  20+ accounts):
 *    - localStorage  →  text fields + image-name stubs (profilePic: { name } only)
 *    - IndexedDB     →  the actual image dataUrls (see src/app/dashboard/idb.ts)
 *
 *  On load, WarmAccountsTab first reads text sync via `getWarmupData()`, then
 *  merges in image dataUrls async via `idbGetAllWarmupImages()`.
 */
export function getWarmupData(): Record<string, any> {
  try {
    const raw = localStorage.getItem('leasely_warmup_data')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export function saveWarmupData(data: Record<string, any>) {
  // localStorage holds ONLY text fields. Images live in IndexedDB (see idb.ts).
  // We drop profilePic/banner entirely here — IDB is the source of truth, so on
  // reload the UI shows no image briefly, then IDB merges the dataUrls in.
  // This keeps the payload under a few KB regardless of account count.
  const lean: Record<string, any> = {}
  for (const [id, v] of Object.entries(data)) {
    const obj = (v as any) || {}
    const { profilePic: _pp, banner: _bn, ...rest } = obj
    lean[id] = rest
  }
  try {
    localStorage.setItem('leasely_warmup_data', JSON.stringify(lean))
  } catch {
    // localStorage is full from ANOTHER key (properties / listings). Nothing
    // we can do here — log and move on; the user's next save attempt will retry
    // and IDB has already absorbed the images regardless.
    console.warn('[saveWarmupData] localStorage quota exceeded even for text-only payload — something else is hogging storage')
  }
}

/** Per-account warmup session — survives reload so the running badge and
 *  liveUrl iframe can be restored. Only serializable fields are kept.
 *  `sessionIds` is the list of browser-use session ids spawned for this run
 *  (one per warmup step); `currentSessionId` is the one currently active. */
export interface PersistedWarmupSession {
  state: 'running' | 'success' | 'failed'
  liveUrl?: string
  status?: string
  error?: string
  sessionIds?: string[]
  currentSessionId?: string
  startedAt?: number
}

export function getWarmupSessions(): Record<string, PersistedWarmupSession> {
  try {
    const raw = localStorage.getItem('leasely_warmup_sessions')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export function saveWarmupSessions(sessions: Record<string, PersistedWarmupSession>) {
  try { localStorage.setItem('leasely_warmup_sessions', JSON.stringify(sessions)) } catch {}
}

/**
 * Generic per-session persistence for multi-session flows (listing posts, sign-ins).
 * We store enough to rebuild the UI card after a reload — status, liveUrl, the
 * browser-use sessionId, and the original row metadata — but NOT the heavy payload
 * (image data URLs, passwords). Each flow keys its sessions by a distinct localStorage
 * key so they don't collide.
 */
export interface PersistedMultiSession {
  id: string
  unitId: string
  unitName: string
  profileId: string
  profileName: string
  liveUrl?: string | null
  status?: string
  state: 'pending' | 'running' | 'success' | 'failed'
  error?: string
  facebookUrl?: string
  /** browser-use session id — lets us reconnect via /api/warmup-session */
  browserSessionId?: string
  startedAt?: number
}

function readSessions(key: string): PersistedMultiSession[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeSessions(key: string, sessions: PersistedMultiSession[] | null) {
  try {
    if (!sessions || sessions.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(sessions))
  } catch {}
}

// Listing post sessions (handleMultiPost)
export const getListingSessions = () => readSessions('leasely_listing_sessions')
export const saveListingSessions = (s: PersistedMultiSession[] | null) => writeSessions('leasely_listing_sessions', s)

// Sign-in sessions (SignInAccountsTab)
export const getSigninSessions = () => readSessions('leasely_signin_sessions')
export const saveSigninSessions = (s: PersistedMultiSession[] | null) => writeSessions('leasely_signin_sessions', s)

/**
 * Browser-use profile list cache — so Warm Accounts / Sign-in / Listings tabs
 * render instantly on mount instead of waiting 2–5s for the paginated
 * browser-use REST API round-trip. The tab still fires the fetch in the
 * background and swaps in fresh data when it arrives.
 *
 * Shape mirrors the `/api/profiles` response: `{ id, name, persistent }[]`.
 * We only keep the fields the UI actually reads; skipping big nested metadata
 * keeps this well under the 5 MB localStorage cap even with hundreds of profiles.
 */
export interface CachedProfile {
  id: string
  name: string
  persistent?: boolean
}

export function getProfilesCache(): CachedProfile[] | null {
  try {
    const raw = localStorage.getItem('leasely_profiles_cache')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveProfilesCache(profiles: CachedProfile[] | null) {
  try {
    // Only an EXPLICIT null wipes the cache. An empty array is almost always
    // a degraded fetch (server returned {} or {error:...} instead of
    // {profiles:[...]}, and the caller defaulted `[]`) — wiping in that case
    // is what caused the "all my accounts disappeared" bug after a 429.
    // A real "user has zero profiles" state is harmless to keep cached too.
    if (profiles === null) {
      localStorage.removeItem('leasely_profiles_cache')
      return
    }
    if (profiles.length === 0) return
    // Strip to just the fields the tabs read — keeps the blob small.
    const lean = profiles.map(p => ({ id: p.id, name: p.name, persistent: p.persistent }))
    localStorage.setItem('leasely_profiles_cache', JSON.stringify(lean))
  } catch {}
}

export function mapboxStaticUrl(lat: number, lon: number, w = 600, h = 400, dark = true) {
  if (!MAPBOX_TOKEN) return null
  const style = dark ? 'satellite-streets-v12' : 'light-v11'
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${lon},${lat},17,0,60/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}`
}
