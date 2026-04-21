'use client'

import { useState, useEffect, useCallback, memo, useRef } from 'react'
import {
  getProfileUrls, saveProfileUrls,
  getWarmedAccounts, saveWarmedAccounts,
  looksAlreadyWarm,
  getWarmupData, saveWarmupData,
  getWarmupSessions, saveWarmupSessions,
  getProfilesCache, saveProfilesCache,
  getHiddenAccounts, saveHiddenAccounts,
} from '../utils'
import { idbGetAllWarmupImages, idbSetWarmupImages, idbDeleteWarmupImages } from '../idb'
import { readSSEStream } from '@/hooks/useSSEStream'
import { useSessionPoller } from '@/hooks/useSessionPoller'

interface Profile {
  id: string
  name: string
}

interface UploadedImage {
  dataUrl: string
  name: string
}

interface WarmupData {
  firstName: string
  lastName: string
  profilePic: UploadedImage | null
  banner: UploadedImage | null
  bio: string
  city: string
  /** Stored if the user generated an identity so we can regenerate the face later. */
  persona?: {
    ethnicity: string
    gender: string
    age: number
    job: string
  }
  /** Short descriptions of posts/photos currently on the live FB profile — captured
   *  by "Sync latest data" so the user can see what needs removal during cleanup. */
  currentAttachments?: string[]
  /** Epoch ms of the last successful "Sync latest data" run for this account. */
  syncedAt?: number
}

interface Session {
  state: 'running' | 'success' | 'failed'
  liveUrl?: string
  status?: string
  error?: string
  /** Browser-use session id for the step that's currently running. Used to
   *  reconnect after a page reload by polling /api/warmup-session?sid=... */
  currentSessionId?: string
  sessionIds?: string[]
  startedAt?: number
}

type AccountStatus = 'empty' | 'ready' | 'running' | 'success' | 'failed' | 'warm'

const emptyData = (): WarmupData => ({
  firstName: '', lastName: '', profilePic: null, banner: null, bio: '', city: '',
})

const hasAnyContent = (d: WarmupData | undefined) =>
  !!d && !!(d.firstName.trim() || d.lastName.trim() || d.profilePic || d.banner || d.bio.trim() || d.city.trim())

/** Strip " - good" / " - cooked - identity verifcation" etc. from profile names for display. */
function stripProfileSuffix(name: string): string {
  return name.replace(/\s*[-–]\s*(good|cooked).*$/i, '').trim()
}

/**
 * Gemini occasionally leaked stray quote characters into bios (the old prompt's
 * example bios were wrapped in "..." and the model copied that pattern into
 * its output). Newly generated bios are scrubbed server-side, but already-
 * saved bios in localStorage still have them — so we scrub here at render time
 * too. Also collapses the double-space / orphaned separator artifacts that
 * removing the quotes leaves behind.
 */
function cleanBio(s: string | undefined | null): string {
  if (!s) return ''
  return s
    .replace(/["'“”‘’„‟«»]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*\|/g, ' | ')
    .replace(/^\s*[|•,\s]+|[|•,\s]+\s*$/g, '')
    .trim()
}

function getStatus(
  profile: Profile,
  data: WarmupData | undefined,
  session: Session | undefined,
  warmedOverride: Record<string, boolean>,
): AccountStatus {
  if (session?.state === 'running') return 'running'
  if (session?.state === 'failed') return 'failed'
  if (session?.state === 'success') return 'success'
  const override = warmedOverride[profile.id]
  if (override === true) return 'warm'
  if (override !== false && looksAlreadyWarm(profile.name)) return 'warm'
  return hasAnyContent(data) ? 'ready' : 'empty'
}

function isWarmForProfile(profile: Profile, warmedOverride: Record<string, boolean>): boolean {
  const override = warmedOverride[profile.id]
  if (override === true) return true
  if (override === false) return false
  return looksAlreadyWarm(profile.name)
}

interface ToastMsg {
  id: number
  type: 'error' | 'success' | 'info'
  message: string
}

interface ConfirmRequest {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}

export default function WarmAccountsTab() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [data, setData] = useState<Record<string, WarmupData>>({})
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  const [profileUrls, setProfileUrlsState] = useState<Record<string, string>>({})
  const [warmedOverride, setWarmedOverride] = useState<Record<string, boolean>>({})
  const [hiddenOverride, setHiddenOverride] = useState<Record<string, boolean>>({})
  const [showHidden, setShowHidden] = useState(false)
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [fetchingUrl, setFetchingUrl] = useState<Set<string>>(new Set())
  const [urlFetchAttempted, setUrlFetchAttempted] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState<Set<string>>(new Set())

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, type, message }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 6000 : 4000)
  }, [])

  // Diff ref for IDB image writes (see useEffect below) — declared up here so
  // the mount effect can prime it when it loads images out of IDB.
  const lastImagesRef = useRef<Map<string, { pfp?: string; banner?: string }>>(new Map())
  // Hydration guard. Needs to be a STATE, not a ref: if we flip a ref to true
  // inside the mount effect, React still fires the save effects in the same
  // commit cycle with the OLD state (`{}`), and they overwrite localStorage
  // before hydration's re-render lands. Using state forces a re-render where
  // both `hydrated === true` AND the state variables carry hydrated values,
  // at which point the save effects fire once with real data and persist it.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // Instant render: show whatever profiles we last fetched, synchronously.
    // The /api/profiles endpoint proxies the browser-use cloud REST list —
    // with ~20 paginated pages × ~250ms network round-trip, mount was stalled
    // on "Loading accounts..." for 2-5s cold. The cache path avoids that
    // entirely; we still refresh in the background to pick up new profiles.
    const cached = getProfilesCache()
    if (cached && cached.length > 0) {
      setProfiles(cached)
      setLoadingProfiles(false)
    }
    fetch('/api/profiles')
      .then(r => r.json())
      .then(d => {
        const fresh = Array.isArray(d.profiles) ? d.profiles : []
        setProfiles(fresh)
        saveProfilesCache(fresh)
      })
      .catch(() => { if (!cached) setProfiles([]) })
      .finally(() => setLoadingProfiles(false))
    setProfileUrlsState(getProfileUrls())
    setWarmedOverride(getWarmedAccounts())
    setHiddenOverride(getHiddenAccounts())

    // Two-stage hydration:
    //   1. Sync — text fields (name, bio, city, persona, sessions) from localStorage.
    //   2. Async — image dataUrls (profilePic, banner) from IndexedDB. We keep
    //      images out of localStorage because 20+ accounts × 2-3MB each easily
    //      overflow the ~5MB per-origin cap, which then breaks EVERY localStorage
    //      write — including the small session-state one — with quota errors.
    // One-time migration: clean any quote artifacts from previously-generated
    // bios (see cleanBio() above). The setter below will cascade into the
    // `saveWarmupData` effect so the cleaned version lands in localStorage.
    const textData = getWarmupData() as Record<string, WarmupData>
    for (const id in textData) {
      const b = textData[id]?.bio
      if (b && /["'“”‘’„‟«»]/.test(b)) textData[id] = { ...textData[id], bio: cleanBio(b) }
    }
    setData(textData)
    const persistedSessions = getWarmupSessions() as Record<string, Session>
    setSessions(persistedSessions)
    // Flip hydrated → true. This triggers a re-render where BOTH `hydrated`
    // is true AND data/sessions carry their hydrated values; the save effects
    // then fire once with real data and persist it. See comment on `hydrated`
    // for why this must be state (not a ref).
    setHydrated(true)

    idbGetAllWarmupImages().then(images => {
      if (Object.keys(images).length === 0) return
      // Prime the save-diff ref so the next `data`-change effect doesn't
      // mistake these just-loaded images for new writes and re-push them to IDB.
      for (const [id, rec] of Object.entries(images)) {
        lastImagesRef.current.set(id, { pfp: rec.profilePic, banner: rec.banner })
      }
      setData(prev => {
        const next = { ...prev }
        for (const [id, rec] of Object.entries(images)) {
          const cur = next[id] ?? emptyData()
          next[id] = {
            ...cur,
            profilePic: rec.profilePic
              ? { dataUrl: rec.profilePic, name: cur.profilePic?.name || 'pfp.jpg' }
              : cur.profilePic,
            banner: rec.banner
              ? { dataUrl: rec.banner, name: cur.banner?.name || 'banner.jpg' }
              : cur.banner,
          }
        }
        return next
      })
    })
  }, [])

  // Persist text + session state to localStorage (small, sync). Gated on the
  // `hydrated` flag so the initial-render firing (when both states are still
  // `{}`) doesn't clobber the persisted copy before the mount effect has
  // restored it. Both effects depend on `hydrated` so they re-fire once it
  // flips from false → true with the hydrated data.
  useEffect(() => { if (hydrated) saveWarmupData(data) }, [data, hydrated])
  useEffect(() => { if (hydrated) saveWarmupSessions(sessions) }, [sessions, hydrated])

  // Persist image dataUrls to IndexedDB (heavy, async). We diff against
  // `lastImagesRef` (declared above, next to `pollersRef`) so we only write
  // the records that actually changed — writing 20 accounts' pfp+banner on
  // every state update would be wasteful even though it's off the main thread.
  useEffect(() => {
    const prev = lastImagesRef.current
    const seen = new Set<string>()
    for (const [id, d] of Object.entries(data)) {
      const next = { pfp: d.profilePic?.dataUrl, banner: d.banner?.dataUrl }
      const last = prev.get(id)
      seen.add(id)
      if (last?.pfp !== next.pfp || last?.banner !== next.banner) {
        prev.set(id, next)
        if (next.pfp || next.banner) {
          void idbSetWarmupImages(id, { profilePic: next.pfp, banner: next.banner })
        } else {
          void idbDeleteWarmupImages(id)
        }
      }
    }
    // If an account was removed from state (unlikely but possible), drop its IDB record too.
    for (const id of Array.from(prev.keys())) {
      if (!seen.has(id)) { prev.delete(id); void idbDeleteWarmupImages(id) }
    }
  }, [data])

  // Reconnect poller — after a page reload, any session still in "running" with
  // a persisted browser-use sessionId needs to be re-polled so we can refresh
  // liveUrl + detect terminal state.
  const pollerSessions = Object.entries(sessions).map(([id, s]) => ({
    id,
    state: s.state,
    browserSessionId: s.currentSessionId,
  }))
  useSessionPoller(pollerSessions, {
    onLiveUrl: (accountId, liveUrl) => {
      setSessions(prev => {
        const cur = prev[accountId]
        if (!cur || cur.state !== 'running') return prev
        if (liveUrl === cur.liveUrl) return prev
        return { ...prev, [accountId]: { ...cur, liveUrl } }
      })
    },
    onTerminal: (accountId, status) => {
      setSessions(prev => {
        const cur = prev[accountId]
        if (!cur) return prev
        if (status === 'completed' || status === 'stopped') {
          return { ...prev, [accountId]: { ...cur, state: 'success', liveUrl: undefined, currentSessionId: undefined, status: 'Done (finished while reloaded)' } }
        }
        return { ...prev, [accountId]: { ...cur, state: 'failed', liveUrl: undefined, currentSessionId: undefined, error: status === 'timed_out' ? 'Session timed out' : `Session ${status}` } }
      })
    },
  })

  useEffect(() => {
    const handler = () => {
      setSessions(prev => {
        const next: Record<string, Session> = {}
        let changed = false
        for (const [id, s] of Object.entries(prev)) {
          if (s.state === 'running') {
            next[id] = { ...s, state: 'failed', liveUrl: undefined, currentSessionId: undefined, status: 'Stopped', error: 'Stopped via End all sessions' }
            changed = true
          } else {
            next[id] = s
          }
        }
        return changed ? next : prev
      })
    }
    window.addEventListener('endAllSessions', handler)
    return () => window.removeEventListener('endAllSessions', handler)
  }, [])

  const updateData = useCallback((id: string, patch: Partial<WarmupData>) => {
    setData(d => ({ ...d, [id]: { ...(d[id] ?? emptyData()), ...patch } }))
  }, [])

  const setSession = useCallback((id: string, patch: Partial<Session>) => {
    setSessions(s => {
      const prev = s[id] ?? { state: 'running' as const }
      return { ...s, [id]: { ...prev, ...patch } as Session }
    })
  }, [])

  const updateProfileUrl = useCallback((id: string, url: string) => {
    setProfileUrlsState(cur => {
      const next = { ...cur }
      if (url.trim()) next[id] = url.trim()
      else delete next[id]
      saveProfileUrls(next)
      return next
    })
  }, [])

  const toggleWarm = useCallback((id: string, nextWarm: boolean) => {
    setWarmedOverride(cur => {
      const next = { ...cur, [id]: nextWarm }
      saveWarmedAccounts(next)
      return next
    })
  }, [])

  // Hide / unhide. Local-only — this does NOT delete the browser-use profile,
  // it just removes it from the warm-accounts view so the user can prune duds
  // and duplicates. Restore via the "Show hidden" toggle in the toolbar.
  const setHidden = useCallback((id: string, nextHidden: boolean) => {
    setHiddenOverride(cur => {
      const next = { ...cur }
      if (nextHidden) next[id] = true
      else delete next[id]
      saveHiddenAccounts(next)
      return next
    })
  }, [])

  // ─── Generate identity (text + images + FB url in parallel) ────────────
  const generateIdentity = useCallback(async (id: string, opts?: { wantBanner?: boolean }) => {
    setGenerating(prev => new Set(prev).add(id))
    // Kick off URL fetch in parallel — doesn't need persona, and takes longer than text gen.
    const currentUrls = getProfileUrls()
    if (!currentUrls[id]) {
      setFetchingUrl(prev => new Set(prev).add(id))
      setUrlFetchAttempted(prev => new Set(prev).add(id))
      fetch('/api/fetch-profile-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      })
        .then(async r => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}))
            const e = body?.error
            throw new Error(typeof e === 'string' ? e : JSON.stringify(e || body))
          }
          const { profileUrl } = await r.json()
          if (profileUrl) {
            setProfileUrlsState(cur => {
              const next = { ...cur, [id]: profileUrl }
              saveProfileUrls(next)
              return next
            })
            showToast('Profile URL detected ✓', 'success')
          }
        })
        .catch((e: any) => showToast(`Couldn't fetch profile URL: ${e.message}`, 'error'))
        .finally(() => setFetchingUrl(prev => { const n = new Set(prev); n.delete(id); return n }))
    }
    try {
      // 1. Text (name, bio, city, persona)
      const textRes = await fetch('/api/generate-identity', { method: 'POST' })
      if (!textRes.ok) throw new Error((await textRes.json()).error || 'Identity gen failed')
      const persona = await textRes.json()

      // Fill text fields immediately so the user sees progress
      setData(d => ({
        ...d,
        [id]: {
          ...(d[id] ?? emptyData()),
          firstName: persona.firstName,
          lastName: persona.lastName,
          bio: persona.bio,
          city: persona.city,
          persona: {
            ethnicity: persona.ethnicity,
            gender: persona.gender,
            age: persona.age,
            job: persona.job,
          },
        },
      }))

      // 2. Images (profile pic + optional banner) — slower
      const faceRes = await fetch('/api/generate-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ethnicity: persona.ethnicity,
          gender: persona.gender,
          age: persona.age,
          city: persona.city,
          job: persona.job,
          wantBanner: opts?.wantBanner ?? true,
        }),
      })
      if (!faceRes.ok) {
        const errBody = await faceRes.json().catch(() => ({}))
        console.error('[identity] image gen failed:', errBody)
        if (errBody?.code === 'QUOTA_EXCEEDED') {
          showToast('Image gen blocked — your Gemini API key has 0 free-tier image quota. Enable billing on the Google Cloud project (aistudio.google.com/apikey → your key → Enable billing).', 'error')
        } else {
          showToast(`Image generation failed: ${typeof errBody?.error === 'string' ? errBody.error.slice(0, 140) : 'Gemini overloaded'}. Retry from ↻ Regenerate.`, 'error')
        }
        return
      }
      const face = await faceRes.json()
      if (!face.profilePicDataUrl && !face.bannerDataUrl) {
        showToast('Image generation returned nothing — hit ↻ Regenerate to retry.', 'error')
      }
      setData(d => ({
        ...d,
        [id]: {
          ...(d[id] ?? emptyData()),
          profilePic: face.profilePicDataUrl ? { dataUrl: face.profilePicDataUrl, name: 'pfp.jpg' } : (d[id]?.profilePic ?? null),
          banner: face.bannerDataUrl ? { dataUrl: face.bannerDataUrl, name: 'banner.jpg' } : (d[id]?.banner ?? null),
        },
      }))
    } catch (e: any) {
      console.error('[generateIdentity]', e)
      showToast(`Generate failed: ${e.message}`, 'error')
    } finally {
      setGenerating(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [showToast])

  // Regenerate just one image using stored persona
  const regenerateFace = useCallback(async (id: string, type: 'profilePic' | 'banner') => {
    const d = data[id]
    if (!d?.persona) {
      showToast('Generate a full identity first.', 'error')
      return
    }
    setGenerating(prev => new Set(prev).add(id))
    try {
      const res = await fetch('/api/generate-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ethnicity: d.persona.ethnicity,
          gender: d.persona.gender,
          age: d.persona.age,
          city: d.city || 'Chicago',
          job: d.persona.job,
          wantBanner: type === 'banner',
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        if (errBody?.code === 'QUOTA_EXCEEDED') {
          showToast('Image gen blocked — your Gemini API key has 0 free-tier image quota. Enable billing at aistudio.google.com/apikey.', 'error')
          return
        }
        throw new Error(errBody?.error || 'Image gen failed')
      }
      const face = await res.json()
      const newUrl = type === 'profilePic' ? face.profilePicDataUrl : face.bannerDataUrl
      if (!newUrl) {
        showToast('Gemini returned no image — try again.', 'error')
        return
      }
      setData(cur => ({
        ...cur,
        [id]: {
          ...(cur[id] ?? emptyData()),
          ...(type === 'profilePic'
            ? { profilePic: { dataUrl: face.profilePicDataUrl, name: 'pfp.jpg' } }
            : {}),
          ...(type === 'banner'
            ? { banner: { dataUrl: face.bannerDataUrl, name: 'banner.jpg' } }
            : {}),
        },
      }))
      showToast(`${type === 'profilePic' ? 'Profile picture' : 'Banner'} regenerated ✓`, 'success')
    } catch (e: any) {
      showToast(`Regenerate failed: ${e.message}`, 'error')
    } finally {
      setGenerating(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [data, showToast])

  // ─── Fetch FB profile URL via browser-use ───────────────────────────────
  const fetchProfileUrl = useCallback(async (id: string) => {
    setFetchingUrl(prev => new Set(prev).add(id))
    setUrlFetchAttempted(prev => new Set(prev).add(id))
    try {
      const res = await fetch('/api/fetch-profile-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const e = body?.error
        throw new Error(typeof e === 'string' ? e : JSON.stringify(e || body))
      }
      const { profileUrl } = await res.json()
      if (profileUrl) {
        setProfileUrlsState(cur => {
          const next = { ...cur, [id]: profileUrl }
          saveProfileUrls(next)
          return next
        })
        showToast('Profile URL detected ✓', 'success')
      }
    } catch (e: any) {
      showToast(`Couldn't fetch profile URL: ${e.message}`, 'error')
    } finally {
      setFetchingUrl(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [showToast])

  // Auto-fetch profile URL when opening an account that doesn't have one yet.
  useEffect(() => {
    if (!editingId) return
    if (profileUrls[editingId]) return
    if (urlFetchAttempted.has(editingId)) return
    fetchProfileUrl(editingId)
  }, [editingId, profileUrls, urlFetchAttempted, fetchProfileUrl])

  // ─── Sync latest data (read-only browser-use per account) ───────────────
  // Spins up a browser-use session per account that navigates to /me and
  // reads back the live display name, bio, profile pic, cover photo, city,
  // and recent-timeline items — then merges everything into state. Signed
  // scontent.fbcdn.net URLs are fetched server-side and returned as base64
  // data URLs so they persist through IDB like generated images do.
  const syncOne = useCallback(async (id: string) => {
    setSyncing(prev => new Set(prev).add(id))
    try {
      const res = await fetch('/api/sync-account-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const e = body?.error
        throw new Error(typeof e === 'string' ? e : JSON.stringify(e || body))
      }
      const info = await res.json()
      setData(d => {
        const cur = d[id] ?? emptyData()
        return {
          ...d,
          [id]: {
            ...cur,
            // Only overwrite text fields when the agent actually found something —
            // don't clobber a human-edited persona with an empty sync result.
            ...(info.firstName ? { firstName: info.firstName } : {}),
            ...(info.lastName ? { lastName: info.lastName } : {}),
            ...(info.bio ? { bio: info.bio } : {}),
            ...(info.city ? { city: info.city } : {}),
            ...(info.profilePicDataUrl
              ? { profilePic: { dataUrl: info.profilePicDataUrl, name: 'pfp-live.jpg' } }
              : {}),
            ...(info.bannerDataUrl
              ? { banner: { dataUrl: info.bannerDataUrl, name: 'banner-live.jpg' } }
              : {}),
            // Always stamp attachments (including an empty list — that's still
            // a real signal: "we looked and found nothing to remove").
            currentAttachments: Array.isArray(info.attachments) ? info.attachments : [],
            syncedAt: Date.now(),
          },
        }
      })
    } catch (e: any) {
      showToast(`Sync failed: ${e.message}`, 'error')
      throw e
    } finally {
      setSyncing(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [showToast])

  const syncAllVisible = useCallback(async (targetIds: string[]) => {
    const CONCURRENCY = 4
    let okCount = 0
    let failCount = 0
    for (let i = 0; i < targetIds.length; i += CONCURRENCY) {
      const batch = targetIds.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(syncOne))
      for (const r of results) r.status === 'fulfilled' ? okCount++ : failCount++
    }
    showToast(
      `Sync complete — ${okCount} updated${failCount ? `, ${failCount} failed` : ''}`,
      failCount ? (okCount ? 'info' : 'error') : 'success',
    )
  }, [syncOne, showToast])

  // ─── Run warmup ────────────────────────────────────────────────────────
  const runWarmup = useCallback(async (id: string) => {
    const d = data[id]
    if (!d || !hasAnyContent(d)) return
    setSession(id, { state: 'running', status: 'Connecting...', liveUrl: undefined, error: undefined })
    try {
      const res = await fetch('/api/warm-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: id,
          firstName: d.firstName,
          lastName: d.lastName,
          profilePicDataUrl: d.profilePic?.dataUrl || null,
          bannerDataUrl: d.banner?.dataUrl || null,
          bio: d.bio,
          city: d.city,
        }),
      })
      await readSSEStream(res, ({ event, data: parsed }) => {
        if (event === 'status') setSession(id, { status: parsed.message })
        else if (event === 'session') {
          setSessions(s => {
            const prev = s[id] ?? { state: 'running' as const }
            const sids = Array.from(new Set([...(prev.sessionIds || []), parsed.sessionId])).filter(Boolean)
            return { ...s, [id]: { ...prev, currentSessionId: parsed.sessionId, sessionIds: sids, status: `${parsed.label || parsed.step}…` } }
          })
        }
        else if (event === 'liveUrl') setSession(id, { liveUrl: parsed.liveUrl, currentSessionId: parsed.sessionId || undefined })
        else if (event === 'result') setSession(id, { state: 'success', status: 'Done', liveUrl: undefined, currentSessionId: undefined })
        else if (event === 'error') setSession(id, { state: 'failed', error: parsed.error, liveUrl: undefined, currentSessionId: undefined })
      })
    } catch (e: any) {
      setSession(id, { state: 'failed', error: e.message || 'Warmup failed' })
    }
  }, [data, setSession])

  const startAllReady = () => {
    for (const p of profiles) {
      const status = getStatus(p, data[p.id], sessions[p.id], warmedOverride)
      if (status === 'ready') runWarmup(p.id)
    }
  }

  const generateAllEmpty = async () => {
    const targets = profiles.filter(p => getStatus(p, data[p.id], sessions[p.id], warmedOverride) === 'empty')
    const CONCURRENCY = 3
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      await Promise.all(targets.slice(i, i + CONCURRENCY).map(p => generateIdentity(p.id)))
    }
  }

  // ─── Editor view ────────────────────────────────────────────────────────
  if (editingId) {
    const profile = profiles.find(p => p.id === editingId)
    if (!profile) {
      setEditingId(null)
      return null
    }
    const d = data[editingId] ?? emptyData()
    const isGenerating = generating.has(editingId)
    const status = getStatus(profile, data[editingId], sessions[editingId], warmedOverride)
    const warm = isWarmForProfile(profile, warmedOverride)
    return (
      <>
        <AccountEditor
          profile={profile}
          data={d}
          status={status}
          isWarm={warm}
          isGenerating={isGenerating}
          profileUrl={profileUrls[editingId] || ''}
          fetchingProfileUrl={fetchingUrl.has(editingId)}
          onUpdate={patch => updateData(editingId, patch)}
          onUpdateProfileUrl={url => updateProfileUrl(editingId, url)}
          onRefetchProfileUrl={() => fetchProfileUrl(editingId)}
          onToggleWarm={next => toggleWarm(editingId, next)}
          onGenerateIdentity={() => generateIdentity(editingId)}
          onRegenerateFace={type => regenerateFace(editingId, type)}
          onDone={() => setEditingId(null)}
          onStartNow={() => { runWarmup(editingId); setEditingId(null) }}
        />
        <ToastStack toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
        <ConfirmModal request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      </>
    )
  }

  // ─── Spreadsheet view ───────────────────────────────────────────────────
  // Visible set respects the hidden-accounts filter (unless the user toggled
  // Show hidden on). Warmed accounts drop to the bottom of the visible list.
  const visibleProfiles = showHidden
    ? profiles
    : profiles.filter(p => !hiddenOverride[p.id])
  const sortedProfiles = [...visibleProfiles].sort((a, b) => {
    const aw = getStatus(a, data[a.id], sessions[a.id], warmedOverride) === 'warm' ? 1 : 0
    const bw = getStatus(b, data[b.id], sessions[b.id], warmedOverride) === 'warm' ? 1 : 0
    return aw - bw
  })

  const statuses = visibleProfiles.map(p => getStatus(p, data[p.id], sessions[p.id], warmedOverride))
  const readyCount = statuses.filter(s => s === 'ready').length
  const emptyCount = statuses.filter(s => s === 'empty').length
  const runningCount = statuses.filter(s => s === 'running').length
  const warmCount = statuses.filter(s => s === 'warm').length
  const hiddenCount = Object.keys(hiddenOverride).filter(id => profiles.some(p => p.id === id)).length

  // One grid template shared between the header and every body row so columns
  // stay perfectly aligned. Photo cell is a fixed-size square. Bio and
  // Attachments both flex (1fr) so they split the remaining width evenly —
  // attachments = list of posts/photos currently live on FB that need cleanup.
  const ROW_COLS = 'grid-cols-[160px_240px_1fr_1fr_200px_140px_140px_40px]'

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="max-w-[1500px] mx-auto px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight dark:text-zinc-50">Warm Accounts</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1.5">
            Click a row to fill in a profile, or Generate to have one created automatically. Start individually or run every ready account in parallel.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button
            onClick={generateAllEmpty}
            disabled={emptyCount === 0 || generating.size > 0}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-sm font-medium dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Generate identities for all empty ({emptyCount})
          </button>
          <button
            onClick={startAllReady}
            disabled={readyCount === 0}
            className="px-4 py-2 rounded-lg accent-btn text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start all ready ({readyCount})
          </button>
          <button
            onClick={() => {
              const targetIds = visibleProfiles.map(p => p.id)
              const n = targetIds.length
              if (n === 0) return
              setConfirmRequest({
                title: `Sync latest data for ${n} account${n === 1 ? '' : 's'}?`,
                body:
                  `This opens ${n} concurrent browser-use sessions (read-only) to pull the ` +
                  `current display name, profile picture, bio, city, and recent posts from ` +
                  `Facebook for each visible account. Estimated cost ~$${(n * 0.05).toFixed(2)}–$${(n * 0.15).toFixed(2)}. ` +
                  `Can take several minutes. It will NOT edit anything — the data is only pulled ` +
                  `so you can see what's actually live before deciding what to change.`,
                confirmLabel: `Sync all (${n})`,
                onConfirm: () => { void syncAllVisible(targetIds) },
              })
            }}
            disabled={syncing.size > 0 || loadingProfiles || visibleProfiles.length === 0}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-sm font-medium dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-1.5"
            title="Pull live name, photo, bio, and recent posts from Facebook for every visible account"
          >
            {syncing.size > 0 ? (
              <>
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Syncing {syncing.size}…
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                Sync latest data
              </>
            )}
          </button>
          <div className="flex-1" />
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-50 dark:bg-blue-500/10 text-xs font-medium text-blue-700 dark:text-blue-300">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              {runningCount} running
            </span>
          )}
          {warmCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {warmCount} already warm
            </span>
          )}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(v => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-zinc-700 text-xs font-medium text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
            >
              {showHidden ? `Hide ${hiddenCount} hidden` : `Show ${hiddenCount} hidden`}
            </button>
          )}
        </div>

        {/* Account spreadsheet */}
        {loadingProfiles && (
          <p className="text-xs text-gray-400 dark:text-zinc-500 px-3 py-2">Loading accounts…</p>
        )}
        {!loadingProfiles && profiles.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-zinc-500 px-3 py-2">No browser profiles found.</p>
        )}
        {!loadingProfiles && profiles.length > 0 && sortedProfiles.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-zinc-500 px-3 py-2">All accounts are hidden. Click &ldquo;Show {hiddenCount} hidden&rdquo; to restore.</p>
        )}
        {!loadingProfiles && sortedProfiles.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-x-auto bg-white dark:bg-zinc-900/50">
            <div className="min-w-[1400px]">
              {/* Header row */}
              <div className={`grid ${ROW_COLS} border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/70 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400 sticky top-0 z-10`}>
                <div className="px-4 py-3">Photo</div>
                <div className="px-4 py-3 border-l border-gray-200 dark:border-zinc-800">Identity</div>
                <div className="px-4 py-3 border-l border-gray-200 dark:border-zinc-800">Bio</div>
                <div className="px-4 py-3 border-l border-gray-200 dark:border-zinc-800">Live posts to clean</div>
                <div className="px-4 py-3 border-l border-gray-200 dark:border-zinc-800">Profile URL</div>
                <div className="px-4 py-3 border-l border-gray-200 dark:border-zinc-800">Status</div>
                <div className="px-4 py-3 border-l border-gray-200 dark:border-zinc-800">Actions</div>
                <div className="px-2 py-3 border-l border-gray-200 dark:border-zinc-800" />
              </div>

              {/* Body rows */}
              {sortedProfiles.map(p => {
                const d = data[p.id]
                const customName = [d?.firstName, d?.lastName].filter(Boolean).join(' ').trim()
                const displayName = customName || stripProfileSuffix(p.name)
                return (
                  <AccountRow
                    key={p.id}
                    cols={ROW_COLS}
                    profile={p}
                    data={d}
                    status={getStatus(p, d, sessions[p.id], warmedOverride)}
                    session={sessions[p.id]}
                    profileUrl={profileUrls[p.id]}
                    isGenerating={generating.has(p.id)}
                    isSyncing={syncing.has(p.id)}
                    isHidden={!!hiddenOverride[p.id]}
                    onEdit={() => setEditingId(p.id)}
                    onStart={() => runWarmup(p.id)}
                    onGenerate={() => generateIdentity(p.id)}
                    onSync={() => { void syncOne(p.id) }}
                    onHide={() => setConfirmRequest({
                      title: 'Hide account?',
                      body: `"${displayName}" will be removed from this view. This does not delete the browser-use profile — you can restore it later with the "Show hidden" toggle.`,
                      confirmLabel: 'Hide',
                      destructive: true,
                      onConfirm: () => setHidden(p.id, true),
                    })}
                    onUnhide={() => setHidden(p.id, false)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
      <ToastStack toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
      <ConfirmModal request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}

// ─── Confirm modal (in-app, replaces native window.confirm) ──────────────
//
// Called with a ConfirmRequest. Renders a backdrop + centered card with
// title / body / Cancel + Confirm. ESC, backdrop click, and clicking Cancel
// all dismiss. Enter triggers Confirm. The `destructive` flag swaps the
// primary button to a red variant (for delete/hide/etc).

function ConfirmModal({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Auto-focus the confirm button when the modal opens, and wire up ESC/Enter.
  useEffect(() => {
    if (!request) return
    // Focus next tick so React finishes the mount first.
    const t = setTimeout(() => confirmRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Enter') {
        // Only fire if the confirm button itself isn't what's focused — if it
        // IS focused, the default button behavior will already fire it.
        if (document.activeElement !== confirmRef.current) {
          e.preventDefault()
          request.onConfirm()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [request, onClose])

  if (!request) return null

  const confirmLabel = request.confirmLabel ?? 'Confirm'
  const cancelLabel = request.cancelLabel ?? 'Cancel'
  const primaryClass = request.destructive
    ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white'
    : 'accent-btn'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 id="confirm-modal-title" className="text-base font-semibold dark:text-zinc-50">
            {request.title}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400 leading-relaxed whitespace-pre-line">
            {request.body}
          </p>
        </div>
        <div className="px-6 pb-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={() => { request.onConfirm(); onClose() }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${primaryClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toast stack (in-app, not native) ────────────────────────────────────

function ToastStack({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const color = {
          error: 'bg-red-600 dark:bg-red-500 text-white',
          success: 'bg-emerald-600 dark:bg-emerald-500 text-white',
          info: 'bg-zinc-800 dark:bg-zinc-700 text-zinc-50',
        }[t.type]
        const icon = { error: '✕', success: '✓', info: 'ℹ' }[t.type]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg max-w-sm text-sm ${color} animate-in slide-in-from-right duration-200`}
          >
            <span className="font-bold text-base leading-tight">{icon}</span>
            <span className="flex-1 font-medium leading-snug">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="opacity-70 hover:opacity-100 text-lg leading-none -mt-0.5"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Account row (spreadsheet row) ───────────────────────────────────────
// Each row is a CSS-grid that matches the header's grid template so columns
// line up. Big cells — 160px row height leaves room for a substantial photo /
// bio preview without making the table too tall to scan.

const AccountRow = memo(function AccountRow({
  cols, profile, data, status, session, profileUrl, isGenerating, isSyncing, isHidden,
  onEdit, onStart, onGenerate, onSync, onHide, onUnhide,
}: {
  cols: string
  profile: Profile
  data: WarmupData | undefined
  status: AccountStatus
  session: Session | undefined
  profileUrl: string | undefined
  isGenerating: boolean
  isSyncing: boolean
  isHidden: boolean
  onEdit: () => void
  onStart: () => void
  onGenerate: () => void
  onSync: () => void
  onHide: () => void
  onUnhide: () => void
}) {
  const cleanName = stripProfileSuffix(profile.name)
  const customName = [data?.firstName, data?.lastName].filter(Boolean).join(' ').trim()
  const displayName = customName || cleanName
  const showSubtitle = customName && customName !== cleanName
  const isDimmed = status === 'warm' || isHidden

  // Profile names from browser-use are typically "Facebook acc 17 - Name". The
  // old placeholder just sliced the first two chars → every empty row showed
  // "FA", which was useless. Extract the account number so empty rows are
  // visually distinguishable at a glance.
  const accMatch = cleanName.match(/acc\s*(\d+)/i)
  const photoPlaceholder = accMatch ? `#${accMatch[1]}` : cleanName.slice(0, 2).toUpperCase()

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  // Shared cell wrapper classes — h-40 = 160px, big enough for a legible photo
  // and 3-4 lines of bio without feeling cramped.
  const cell = 'h-40 px-4 py-3 border-l border-gray-200 dark:border-zinc-800 flex flex-col min-w-0'

  return (
    <div
      onClick={onEdit}
      className={`group grid ${cols} border-b border-gray-200 dark:border-zinc-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-900/70 transition ${isDimmed ? 'opacity-50 hover:opacity-100' : ''}`}
    >
      {/* Photo cell — square-ish. Shows live-view iframe instead when the
          warmup agent is running so the user can watch progress in the row. */}
      <div className="relative h-40 bg-gray-50 dark:bg-zinc-900 overflow-hidden">
        {status === 'running' && session?.liveUrl ? (
          <iframe
            src={session.liveUrl}
            className="absolute inset-0 w-full h-full"
            style={{ border: 'none' }}
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay"
            onClick={stop}
          />
        ) : data?.profilePic ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.profilePic.dataUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-2xl font-semibold text-gray-400 dark:text-zinc-600 select-none tabular-nums tracking-tight">
              {photoPlaceholder}
            </span>
          </div>
        )}

        {/* Loading overlay during identity generation */}
        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-6 h-6 border-[3px] border-white border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-medium text-white">Generating…</span>
            </div>
          </div>
        )}

        {/* Loading overlay while syncing live FB state */}
        {isSyncing && !isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-6 h-6 border-[3px] border-white border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-medium text-white">Syncing…</span>
            </div>
          </div>
        )}

        {/* Fallback spinner when running but liveUrl hasn't arrived yet */}
        {status === 'running' && !session?.liveUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-5 h-5 border-[2.5px] border-white border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-medium text-white">Connecting…</span>
            </div>
          </div>
        )}
      </div>

      {/* Identity cell — name + persona meta */}
      <div className={`${cell} justify-center`}>
        <h3 className="text-sm font-medium dark:text-zinc-50 truncate">{displayName}</h3>
        {showSubtitle && (
          <p className="text-[11px] text-gray-400 dark:text-zinc-500 truncate mt-0.5">{cleanName}</p>
        )}
        {data?.persona && (
          <div className="mt-2 space-y-0.5">
            <p className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">
              {data.persona.ethnicity}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 truncate">
              {data.persona.gender} · {data.persona.age}y · {data.persona.job}
            </p>
          </div>
        )}
      </div>

      {/* Bio cell — up to ~5 lines. Empty state is a quiet em-dash. */}
      <div className={`${cell} justify-center`}>
        {data?.bio ? (
          <p className="text-xs text-gray-600 dark:text-zinc-400 leading-relaxed line-clamp-5 whitespace-pre-wrap">{cleanBio(data.bio)}</p>
        ) : (
          <p className="text-xs text-gray-300 dark:text-zinc-700 select-none">—</p>
        )}
      </div>

      {/* Live posts/photos currently on the FB profile — captured by "Sync
          latest data". Populated empty arrays still mean "we looked and
          found nothing to clean up", so we distinguish that from "never
          synced" (no syncedAt) with different copy. */}
      <div className={`${cell} justify-center gap-1`}>
        {data?.currentAttachments && data.currentAttachments.length > 0 ? (
          <ul className="text-[11px] text-gray-600 dark:text-zinc-400 leading-snug space-y-0.5 overflow-hidden">
            {data.currentAttachments.slice(0, 5).map((a, i) => (
              <li key={i} className="truncate" title={a}>• {a}</li>
            ))}
            {data.currentAttachments.length > 5 && (
              <li className="text-[10px] text-gray-400 dark:text-zinc-500">
                +{data.currentAttachments.length - 5} more
              </li>
            )}
          </ul>
        ) : data?.syncedAt ? (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 select-none">Profile is clean</p>
        ) : (
          <button
            onClick={e => { stop(e); onSync() }}
            disabled={isSyncing}
            className="self-start inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition"
            title="Pull live posts/photos currently on the FB profile"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Sync to see
          </button>
        )}
      </div>

      {/* Profile URL cell */}
      <div className={`${cell} justify-center`}>
        {profileUrl ? (
          <a
            href={profileUrl}
            onClick={stop}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline truncate"
            title={profileUrl}
          >
            View profile
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
          </a>
        ) : (
          <span className="text-xs text-gray-300 dark:text-zinc-700 select-none">—</span>
        )}
      </div>

      {/* Status cell — badge + running/error detail line */}
      <div className={`${cell} justify-center gap-1.5`}>
        <StatusBadge status={status} />
        {session?.status && status === 'running' && (
          <p className="text-[10px] text-blue-600 dark:text-blue-400 line-clamp-3 leading-tight">{session.status}</p>
        )}
        {session?.error && status === 'failed' && (
          <p className="text-[10px] text-red-600 dark:text-red-400 line-clamp-3 leading-tight">{session.error}</p>
        )}
      </div>

      {/* Actions cell — status-dependent button */}
      <div className={`${cell} justify-center items-stretch`}>
        {status === 'empty' && (
          <button
            onClick={e => { stop(e); onGenerate() }}
            disabled={isGenerating}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-zinc-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition"
          >
            Generate
          </button>
        )}
        {status === 'ready' && (
          <button
            onClick={e => { stop(e); onStart() }}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium accent-btn"
          >
            Start
          </button>
        )}
        {status === 'failed' && (
          <button
            onClick={e => { stop(e); onStart() }}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium accent-btn"
          >
            Retry
          </button>
        )}
        {status === 'running' && session?.liveUrl && (
          <a
            href={session.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-white transition"
            title="Open live view in new tab"
          >
            Pop out
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
          </a>
        )}
        {(status === 'running' && !session?.liveUrl) && (
          <span className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg text-[11px] font-medium text-gray-400 dark:text-zinc-500">
            Running…
          </span>
        )}
        {status === 'success' && (
          <span className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            Done
          </span>
        )}
        {status === 'warm' && (
          <span className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg text-[11px] font-medium text-gray-400 dark:text-zinc-500">
            Open
          </span>
        )}
      </div>

      {/* Hide / unhide column — small icon button. Stays on hover, tinted
          muted so it doesn't compete with the primary action. */}
      <div className="h-40 flex items-center justify-center border-l border-gray-200 dark:border-zinc-800">
        {isHidden ? (
          <button
            onClick={e => { stop(e); onUnhide() }}
            className="w-8 h-8 rounded-md text-gray-400 hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 transition flex items-center justify-center"
            title="Restore to list"
            aria-label="Restore account"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 5 3 12 10 12"/></svg>
          </button>
        ) : (
          <button
            onClick={e => { stop(e); onHide() }}
            className="w-8 h-8 rounded-md text-gray-300 hover:text-red-600 dark:text-zinc-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition flex items-center justify-center opacity-0 group-hover:opacity-100"
            title="Hide from list"
            aria-label="Hide account"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        )}
      </div>
    </div>
  )
})

function StatusBadge({ status }: { status: AccountStatus }) {
  const style = {
    empty: 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400',
    ready: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    running: 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300',
    success: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    failed: 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300',
    warm: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200',
  }[status]
  const label = {
    empty: 'Empty', ready: 'Ready', running: 'Running', success: 'Done', failed: 'Failed', warm: '✓ Warm',
  }[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${style}`}>
      {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  )
}

// ─── Account editor view ─────────────────────────────────────────────────

function AccountEditor({
  profile, data, status, isWarm, isGenerating, profileUrl, fetchingProfileUrl,
  onUpdate, onUpdateProfileUrl, onRefetchProfileUrl, onToggleWarm,
  onGenerateIdentity, onRegenerateFace,
  onDone, onStartNow,
}: {
  profile: Profile
  data: WarmupData
  status: AccountStatus
  isWarm: boolean
  isGenerating: boolean
  profileUrl: string
  fetchingProfileUrl: boolean
  onUpdate: (patch: Partial<WarmupData>) => void
  onUpdateProfileUrl: (url: string) => void
  onRefetchProfileUrl: () => void
  onToggleWarm: (next: boolean) => void
  onGenerateIdentity: () => void
  onRegenerateFace: (type: 'profilePic' | 'banner') => void
  onDone: () => void
  onStartNow: () => void
}) {
  const canStart = hasAnyContent(data) && status !== 'running'
  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onDone}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-100 transition"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to accounts
          </button>
          <button
            onClick={onGenerateIdentity}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-zinc-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition"
          >
            {isGenerating ? (
              <>
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              <>Generate full identity</>
            )}
          </button>
        </div>

        <div className="mb-6 pb-4 border-b border-gray-100 dark:border-zinc-800">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-1">Editing account</p>
          <h1 className="text-2xl font-bold dark:text-zinc-50">{profile.name}</h1>
          {data.persona && (
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                {data.persona.ethnicity}
              </span>
              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                {data.persona.gender}
              </span>
              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                {data.persona.age} years
              </span>
              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                {data.persona.job}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Already-warm toggle */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 cursor-pointer">
            <input
              type="checkbox"
              checked={isWarm}
              onChange={e => onToggleWarm(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-emerald-500"
            />
            <div>
              <p className="text-sm font-semibold dark:text-zinc-200">Already warmed</p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                Skip this account in bulk actions. Data below is kept so you can edit later.
              </p>
            </div>
          </label>

          {/* Facebook profile URL */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium dark:text-zinc-200">Facebook profile URL</label>
              <button
                onClick={onRefetchProfileUrl}
                disabled={fetchingProfileUrl}
                className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-100 disabled:opacity-60 transition"
              >
                {fetchingProfileUrl ? (
                  <>
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>↻ {profileUrl ? 'Refetch from Facebook' : 'Fetch from Facebook'}</>
                )}
              </button>
            </div>
            <input
              value={profileUrl}
              onChange={e => onUpdateProfileUrl(e.target.value)}
              placeholder={fetchingProfileUrl ? 'Fetching from Facebook…' : 'https://www.facebook.com/...'}
              className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 px-4 py-3 text-sm bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none focus:border-[var(--accent-muted)] transition"
            />
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
              Auto-filled on first open by a browser-use agent that visits facebook.com/me.
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5 dark:text-zinc-200">Display name on Facebook</label>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={data.firstName}
                onChange={e => onUpdate({ firstName: e.target.value })}
                placeholder="First name"
                className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 px-4 py-3 text-sm bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none focus:border-[var(--accent-muted)] transition"
              />
              <input
                value={data.lastName}
                onChange={e => onUpdate({ lastName: e.target.value })}
                placeholder="Last name"
                className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 px-4 py-3 text-sm bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none focus:border-[var(--accent-muted)] transition"
              />
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
              Leave blank to skip. Facebook limits name changes to once every 60 days.
            </p>
          </div>

          {/* Profile pic */}
          <ImageUpload
            label="Profile picture"
            value={data.profilePic}
            onChange={v => onUpdate({ profilePic: v })}
            onRegenerate={data.persona ? () => onRegenerateFace('profilePic') : undefined}
            isGenerating={isGenerating}
            aspect="1/1"
            previewWidth={160}
          />

          {/* Banner */}
          <ImageUpload
            label="Cover photo (banner)"
            value={data.banner}
            onChange={v => onUpdate({ banner: v })}
            onRegenerate={data.persona ? () => onRegenerateFace('banner') : undefined}
            isGenerating={isGenerating}
            aspect="820/312"
          />

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium mb-1.5 dark:text-zinc-200">Bio</label>
            <textarea
              value={data.bio}
              onChange={e => onUpdate({ bio: e.target.value })}
              rows={3}
              placeholder="A short line to appear under the profile name…"
              className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 px-4 py-3 text-sm bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none focus:border-[var(--accent-muted)] transition resize-none"
            />
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">Leave blank to skip.</p>
          </div>

          {/* City */}
          <div>
            <label className="block text-sm font-medium mb-1.5 dark:text-zinc-200">Current city</label>
            <input
              value={data.city}
              onChange={e => onUpdate({ city: e.target.value })}
              placeholder="e.g. Chicago"
              className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 px-4 py-3 text-sm bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none focus:border-[var(--accent-muted)] transition"
            />
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">City name only — the agent will select &ldquo;City, State&rdquo; from the dropdown.</p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-8 flex gap-3">
          <button
            onClick={onDone}
            className="flex-1 py-3.5 rounded-xl border border-gray-200 dark:border-zinc-700 font-semibold text-sm dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
          >
            Done
          </button>
          <button
            onClick={onStartNow}
            disabled={!canStart}
            className="flex-1 py-3.5 rounded-xl accent-btn font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === 'running' ? 'Already running…' : 'Start warmup now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Image upload component ──────────────────────────────────────────────

const ImageUpload = memo(function ImageUpload({
  label, value, onChange, onRegenerate, isGenerating, aspect, previewWidth,
}: {
  label: string
  value: UploadedImage | null
  onChange: (v: UploadedImage | null) => void
  onRegenerate?: () => void
  isGenerating?: boolean
  aspect: string
  previewWidth?: number
}) {
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => onChange({ dataUrl: reader.result as string, name: f.name })
    reader.readAsDataURL(f)
  }

  const containerStyle: React.CSSProperties = {
    aspectRatio: aspect,
    ...(previewWidth ? { maxWidth: `${previewWidth}px` } : {}),
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm font-medium dark:text-zinc-200">{label}</label>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={isGenerating}
            className="text-xs text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-100 disabled:opacity-40 transition"
          >
            {isGenerating ? 'Generating…' : value ? 'Regenerate' : 'Generate'}
          </button>
        )}
      </div>
      {value ? (
        <div
          className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-700"
          style={containerStyle}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.dataUrl} alt="" className="w-full h-full object-cover" />
          {isGenerating && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-7 h-7 border-4 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <button
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white text-sm flex items-center justify-center hover:bg-black/80"
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      ) : isGenerating ? (
        <div
          className="flex items-center justify-center rounded-xl border-2 border-dashed border-gray-200 dark:border-zinc-700 text-sm text-gray-400 dark:text-zinc-500"
          style={containerStyle}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-[3px] border-current border-t-transparent rounded-full animate-spin opacity-70" />
            <span className="text-xs">Generating image…</span>
          </div>
        </div>
      ) : (
        <label
          className="flex items-center justify-center rounded-xl border-2 border-dashed border-gray-200 dark:border-zinc-700 cursor-pointer hover:border-gray-300 dark:hover:border-zinc-600 transition text-sm text-gray-400 dark:text-zinc-500"
          style={containerStyle}
        >
          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
          + Upload
        </label>
      )}
    </div>
  )
})
