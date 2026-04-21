'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MultiSessionView from './MultiSessionView'
import type { PostSession } from './GenerateListingFlow'
import { getSigninSessions, saveSigninSessions } from '../utils'
import { readSSEStream } from '@/hooks/useSSEStream'
import { useSessionPoller } from '@/hooks/useSessionPoller'

interface Props {
  onImported?: () => void
}

interface ParsedRow {
  label: string         // e.g. "Facebook acc 13 - Name" — used as the BU profile name
  email: string
  fbPass: string
  emailPass: string
  dob: string
  backupCode: string
  lineNo: number
}

// ─── Row parsing (TSV from spreadsheet paste, CSV fallback) ────────────
// Google Sheets / Excel copy-paste gives TSV. We detect tabs first, commas
// second. Backup codes contain spaces, so we never split on whitespace.
function parseRows(text: string): string[][] {
  const trimmed = text.replace(/^\uFEFF/, '')
  const delim = trimmed.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (inQuotes) {
      if (c === '"') {
        if (trimmed[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === delim) { cur.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && trimmed[i + 1] === '\n') i++
        cur.push(field); field = ''
        if (cur.some(v => v.trim().length > 0)) rows.push(cur)
        cur = []
      } else {
        field += c
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    if (cur.some(v => v.trim().length > 0)) rows.push(cur)
  }
  return rows
}

const canonHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')

// "/" separator = US MM/DD/YYYY; "-" separator = DD-MM-YYYY.
function normaliseDob(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, month, day, year] = slash
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dash) {
    const [, day, month, year] = dash
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, year, month, day] = iso
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return s
}

function rowsToParsed(rows: string[][]): { parsed: ParsedRow[]; errors: string[] } {
  const errors: string[] = []
  if (rows.length === 0) return { parsed: [], errors: ['Nothing to parse'] }
  const header = rows[0].map(canonHeader)
  // First column is the freeform label (e.g. "Facebook acc 13 - Name"). We use
  // it as the new BU profile name; falls back to email if blank.
  const idx = {
    email: header.indexOf('email'),
    fbPass: header.findIndex(h => h === 'fbpass' || h === 'facebookpass' || h === 'password'),
    emailPass: header.findIndex(h => h === 'emailpass' || h === 'emailpassword'),
    dob: header.findIndex(h => h === 'dob' || h === 'dateofbirth' || h === 'birthday'),
    backupCode: header.findIndex(h => h === 'backupcode' || h === 'backupcodes' || h === 'twofa' || h === 'tfa'),
  }
  if (idx.email < 0 || idx.fbPass < 0) {
    errors.push('Paste must include at least "Email" and "FB pass" columns in the header row')
    return { parsed: [], errors }
  }
  const parsed: ParsedRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const label = (r[0] || '').trim()
    const email = (r[idx.email] || '').trim()
    const fbPass = (r[idx.fbPass] || '').trim()
    if (!email || !fbPass) { errors.push(`Line ${i + 1}: missing email or password`); continue }
    parsed.push({
      label,
      email,
      fbPass,
      emailPass: idx.emailPass >= 0 ? (r[idx.emailPass] || '').trim() : '',
      dob: idx.dob >= 0 ? normaliseDob(r[idx.dob] || '') : '',
      backupCode: idx.backupCode >= 0 ? (r[idx.backupCode] || '').trim() : '',
      lineNo: i + 1,
    })
  }
  return { parsed, errors }
}

// ─── Tab ────────────────────────────────────────────────────────────────
export default function SignInAccountsTab({ onImported }: Props) {
  const [pasted, setPasted] = useState<string>('')
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [sessions, setSessions] = useState<PostSession[] | null>(null)
  const firedImportRef = useRef(false)
  // Hydration guard. Must be STATE not ref: React fires save effects in the
  // same commit cycle as the mount effect with the pre-setState state values,
  // so flipping a ref to true in the mount effect still lets the save run
  // with `sessions === null` and overwrite the persisted key. Using state
  // forces a re-render where both `hydrated === true` AND `sessions` carry
  // the restored value before the save effect fires.
  const [hydrated, setHydrated] = useState(false)

  // On mount: rehydrate sign-in sessions from localStorage so reloads don't lose
  // the live-view grid. The parsed[] rows aren't persisted (they contain creds),
  // so retry is only available for still-in-memory sessions — rehydrated ones show
  // the live view + status but can't be retried; the user has to re-paste creds.
  useEffect(() => {
    const persisted = getSigninSessions()
    if (persisted && persisted.length > 0) {
      const anyRunning = persisted.some(s => s.state === 'running' || s.state === 'pending')
      if (!anyRunning && persisted.every(s => s.state === 'success')) {
        // Fully-done sessions from a previous run — start clean instead of showing stale grid.
        saveSigninSessions(null)
      } else {
        setSessions(persisted.map(p => ({
          id: p.id, unitId: p.unitId, unitName: p.unitName,
          profileId: p.profileId, profileName: p.profileName,
          liveUrl: p.liveUrl, status: p.status, state: p.state, error: p.error,
          facebookUrl: p.facebookUrl,
        })))
      }
    }
    setHydrated(true)
  }, [])

  // When the user clicks "End all sessions" in the sidebar, immediately flip
  // every still-running tile to failed without waiting for the SSE stream to
  // notice — BU's task-stop signal can lag many seconds before runPromise resolves.
  useEffect(() => {
    const handler = () => {
      setSessions(prev => prev ? prev.map(s =>
        (s.state === 'running' || s.state === 'pending')
          ? { ...s, state: 'failed', liveUrl: null, status: 'Stopped', error: 'Stopped via End all sessions' }
          : s
      ) : prev)
    }
    window.addEventListener('endAllSessions', handler)
    return () => window.removeEventListener('endAllSessions', handler)
  }, [])

  // Persist sessions to localStorage whenever they change. Gated on `hydrated`
  // (a state, not a ref — see note above) so the initial-mount firing doesn't
  // wipe the persisted key before hydration has populated state.
  useEffect(() => {
    if (!hydrated) return
    if (!sessions) { saveSigninSessions(null); return }
    saveSigninSessions(sessions.map(s => ({
      id: s.id, unitId: s.unitId, unitName: s.unitName,
      profileId: s.profileId, profileName: s.profileName,
      liveUrl: s.liveUrl, status: s.status, state: s.state, error: s.error,
      facebookUrl: s.facebookUrl,
      browserSessionId: s.browserSessionId,
    })))
  }, [sessions, hydrated])

  // Reconnect poller for rehydrated "running" sessions
  const pollerSessions = (sessions || []).map(s => ({
    id: s.id,
    state: s.state,
    browserSessionId: s.browserSessionId,
  }))
  useSessionPoller(pollerSessions, {
    onLiveUrl: (id, liveUrl) => {
      setSessions(prev => prev ? prev.map(s =>
        s.id === id && liveUrl !== s.liveUrl ? { ...s, liveUrl } : s
      ) : prev)
    },
    onTerminal: (id, status) => {
      setSessions(prev => prev ? prev.map(s => {
        if (s.id !== id) return s
        if (status === 'completed' || status === 'stopped') return { ...s, state: 'success', liveUrl: null, status: 'Signed in' }
        return { ...s, state: 'failed', liveUrl: null, error: status === 'timed_out' ? 'Session timed out' : `Session ${status}` }
      }) : prev)
    },
  })

  const reparse = useCallback((text: string) => {
    setPasted(text)
    if (!text.trim()) { setParsed([]); setParseErrors([]); return }
    const rows = parseRows(text)
    const { parsed, errors } = rowsToParsed(rows)
    setParsed(parsed)
    setParseErrors(errors)
  }, [])

  const updateSession = useCallback((id: string, patch: Partial<PostSession>) => {
    setSessions(prev => prev ? prev.map(s => s.id === id ? { ...s, ...patch } : s) : prev)
  }, [])

  const runSingleSignin = useCallback(async (row: ParsedRow, sessionId: string) => {
    updateSession(sessionId, { state: 'running', status: 'Creating browser profile...' })
    try {
      const res = await fetch('/api/account-signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: row.email,
          fbPass: row.fbPass,
          emailPass: row.emailPass,
          dob: row.dob,
          backupCode: row.backupCode,
          profileName: row.label || row.email,
        }),
      })
      await readSSEStream(res, ({ event, data: parsed }) => {
        if (event === 'status') updateSession(sessionId, { status: parsed.message })
        else if (event === 'session') updateSession(sessionId, { browserSessionId: parsed.sessionId })
        else if (event === 'liveUrl') updateSession(sessionId, { liveUrl: parsed.liveUrl, status: 'Connecting browser...', browserSessionId: parsed.sessionId || undefined })
        else if (event === 'result') {
          updateSession(sessionId, { state: 'success', status: 'Signed in', liveUrl: null })
          if (!firedImportRef.current) { firedImportRef.current = true; onImported?.() }
        }
        else if (event === 'error') updateSession(sessionId, { state: 'failed', error: parsed.error, liveUrl: null })
      })
    } catch (e: any) {
      updateSession(sessionId, { state: 'failed', error: e.message || 'Sign-in request failed', liveUrl: null })
    }
  }, [onImported, updateSession])

  const startSignin = useCallback(() => {
    if (parsed.length === 0) return
    firedImportRef.current = false
    const initial: PostSession[] = parsed.map((row, i) => ({
      id: `signin-${Date.now()}-${i}`,
      unitId: row.email,
      unitName: row.label || row.email,
      profileId: '',
      profileName: row.email,
      state: 'pending',
      status: 'Queued',
    }))
    setSessions(initial)
    initial.forEach((s, i) => runSingleSignin(parsed[i], s.id))
  }, [parsed, runSingleSignin])

  const retry = useCallback((id: string) => {
    const s = sessions?.find(x => x.id === id)
    if (!s) return
    const row = parsed.find(r => r.email === s.unitId)
    if (!row) return
    updateSession(id, { state: 'pending', error: undefined, liveUrl: null, status: 'Retrying...' })
    runSingleSignin(row, id)
  }, [parsed, runSingleSignin, sessions, updateSession])

  const onConnected = useCallback((id: string) => {
    setSessions(prev => prev ? prev.map(s => s.id === id && s.state === 'running' ? { ...s, status: 'Connected' } : s) : prev)
  }, [])

  const maskedPass = useMemo(() => '••••••••', [])

  // Live grid once any session exists
  if (sessions) {
    return (
      <MultiSessionView
        sessions={sessions}
        onRetry={retry}
        onDismissAll={() => setSessions(null)}
        onConnected={onConnected}
        headerTitle={`Signing in ${sessions.length} account${sessions.length !== 1 ? 's' : ''}`}
        successLabel="Signed in"
      />
    )
  }

  // Upload view
  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold dark:text-zinc-50">Sign In Accounts</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1.5">
            Paste rows from your spreadsheet — each row spawns a fresh browser-use profile (named after the first column, e.g. &ldquo;Facebook acc 13 - Name&rdquo;) and logs the FB account into it.
            Failed sign-ins delete their orphan profile.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-zinc-200">
            Paste rows from the spreadsheet (include the header row)
          </label>
          <textarea
            value={pasted}
            onChange={e => reparse(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={`Email\tFB pass\tEmail pass\tDOB\tBackup code\njacobfrost5@outlook.com\tffPggYyoU#duD@58\tbiddut009900\t23-10-2004\tGE5K XSGJ ...`}
            className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 px-4 py-3 text-xs font-mono bg-white dark:bg-zinc-900 dark:text-zinc-50 outline-none focus:border-[var(--accent-muted)] transition resize-y"
          />
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1.5">
            Tab- or comma-separated. The first column becomes the new profile name. <strong>Email</strong> and <strong>FB pass</strong> columns are required.
          </p>
        </div>

        {parseErrors.length > 0 && (
          <div className="mt-5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-4 py-3">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">
              {parseErrors.length} issue{parseErrors.length !== 1 ? 's' : ''} while parsing
            </p>
            <ul className="text-xs text-red-600 dark:text-red-300 space-y-0.5 list-disc pl-5 max-h-24 overflow-y-auto">
              {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {parsed.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-2">
              Preview — {parsed.length} account{parsed.length !== 1 ? 's' : ''}
            </p>
            <div className="rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-zinc-800/50">
                  <tr className="text-left text-gray-500 dark:text-zinc-400">
                    <th className="px-3 py-2 font-semibold">New profile name</th>
                    <th className="px-3 py-2 font-semibold">Email</th>
                    <th className="px-3 py-2 font-semibold">FB pass</th>
                    <th className="px-3 py-2 font-semibold">DOB</th>
                    <th className="px-3 py-2 font-semibold">Backup code</th>
                  </tr>
                </thead>
                <tbody className="dark:text-zinc-200">
                  {parsed.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-zinc-800">
                      <td className="px-3 py-2 font-mono truncate max-w-[260px]">{r.label || <span className="text-gray-400">{r.email}</span>}</td>
                      <td className="px-3 py-2 font-mono">{r.email}</td>
                      <td className="px-3 py-2 font-mono">{maskedPass}</td>
                      <td className="px-3 py-2 font-mono">{r.dob || <span className="text-gray-300 dark:text-zinc-600">—</span>}</td>
                      <td className="px-3 py-2 font-mono truncate max-w-[280px]" title={r.backupCode}>
                        {r.backupCode || <span className="text-gray-300 dark:text-zinc-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          onClick={startSignin}
          disabled={parsed.length === 0}
          className="w-full mt-8 py-3.5 rounded-xl accent-btn font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {parsed.length === 0 ? 'Paste rows to start' : `Sign in ${parsed.length} account${parsed.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
