'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

interface LogEntry {
  t: string
  kind: 'status' | 'session' | 'liveUrl' | 'result' | 'error'
  text: string
}

interface ParsedCreds {
  label: string
  email: string
  fbPass: string
  emailPass: string
  dob: string
  backupCode: string
}

// Parse TSV/CSV paste (same format as the BU SignInAccountsTab). Returns the
// first data row only — this test page runs one session at a time. Backup
// codes contain spaces, so we never split on whitespace.
function parseFirstRow(text: string): { creds: ParsedCreds | null; error: string | null } {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { creds: null, error: null }
  const delim = trimmed.includes('\t') ? '\t' : ','
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return { creds: null, error: 'Paste the header row and at least one data row' }

  const header = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const idx = {
    email: header.indexOf('email'),
    fbPass: header.findIndex(h => h === 'fbpass' || h === 'facebookpass' || h === 'password'),
    emailPass: header.findIndex(h => h === 'emailpass' || h === 'emailpassword'),
    dob: header.findIndex(h => h === 'dob' || h === 'dateofbirth' || h === 'birthday'),
    backupCode: header.findIndex(h => h === 'backupcode' || h === 'backupcodes' || h === 'twofa' || h === 'tfa'),
  }
  if (idx.email < 0 || idx.fbPass < 0) {
    return { creds: null, error: 'Header must include "Email" and "FB pass" columns' }
  }

  const row = lines[1].split(delim)
  const email = (row[idx.email] || '').trim()
  const fbPass = (row[idx.fbPass] || '').trim()
  if (!email || !fbPass) return { creds: null, error: 'First data row is missing email or password' }

  return {
    creds: {
      label: (row[0] || '').trim(),
      email,
      fbPass,
      emailPass: idx.emailPass >= 0 ? (row[idx.emailPass] || '').trim() : '',
      dob: idx.dob >= 0 ? (row[idx.dob] || '').trim() : '',
      backupCode: idx.backupCode >= 0 ? (row[idx.backupCode] || '').trim() : '',
    },
    error: null,
  }
}

export default function BrowserbaseTest() {
  const [pasted, setPasted] = useState('')
  const [running, setRunning] = useState(false)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [contextId, setContextId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const { creds, error: parseError } = useMemo(() => parseFirstRow(pasted), [pasted])

  const push = useCallback((kind: LogEntry['kind'], text: string) => {
    setLogs(prev => [...prev, { t: new Date().toLocaleTimeString(), kind, text }])
  }, [])

  const start = useCallback(async () => {
    if (running) return
    setRunning(true)
    setLiveUrl(null)
    setSessionId(null)
    setContextId(null)
    setAccountId(null)
    setLogs([])

    const ctrl = new AbortController()
    abortRef.current = ctrl

    if (!creds) {
      push('error', 'Paste a valid row first')
      setRunning(false)
      return
    }

    const body = {
      label: creds.label || undefined,
      email: creds.email,
      fbPass: creds.fbPass,
      emailPass: creds.emailPass || undefined,
      dob: creds.dob || undefined,
      backupCode: creds.backupCode || undefined,
    }

    try {
      const res = await fetch('/api/warm-account-bb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '')
        push('error', `HTTP ${res.status}: ${txt || 'request failed'}`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)

          let ev = 'message'
          let data = ''
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim()
            else if (line.startsWith('data:')) data = line.slice(5).trim()
          }
          if (!data) continue

          let parsed: any
          try { parsed = JSON.parse(data) } catch { continue }

          if (ev === 'status') push('status', parsed.message || '')
          else if (ev === 'session') {
            setSessionId(parsed.sessionId)
            setContextId(parsed.contextId)
            push('session', `session=${parsed.sessionId} context=${parsed.contextId}`)
          } else if (ev === 'liveUrl') {
            setLiveUrl(parsed.liveUrl)
            push('liveUrl', parsed.liveUrl)
          } else if (ev === 'result') {
            setAccountId(parsed.accountId)
            push('result', `Saved account ${parsed.accountId} (context ${parsed.browserbaseContextId})`)
          } else if (ev === 'error') {
            push('error', parsed.error || 'Unknown error')
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') push('error', err?.message || 'Stream failed')
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [creds, push, running])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const maskedPass = creds?.fbPass ? '•'.repeat(Math.min(creds.fbPass.length, 10)) : ''

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Browserbase warm-account (agentic login)</h1>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Paste a row from the accounts spreadsheet (header + one data row). The server spins up a fresh
        Browserbase context, runs Stagehand&apos;s CUA agent against the FB signin prompt — including
        2FA via 2fa.live — and persists the logged-in cookies to the context on success. Leave the
        textarea empty to fall back to manual login in the live view.
      </p>

      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        Paste header row + one account row (TSV from Google Sheets / Excel)
      </label>
      <textarea
        value={pasted}
        onChange={e => setPasted(e.target.value)}
        disabled={running}
        rows={5}
        spellCheck={false}
        placeholder={'Label\tEmail\tFB pass\tEmail pass\tDOB\tBackup code\nFacebook acc 25 - Name\tmorseadrian9722@outlook.com\t29m22...\tkmac...\t\t3QY5 MREO ...'}
        style={{ width: '100%', padding: 10, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12, marginBottom: 8, resize: 'vertical' }}
      />

      {parseError && (
        <div style={{ padding: 8, background: '#fee', border: '1px solid #f88', borderRadius: 4, marginBottom: 8, color: '#800', fontSize: 12 }}>
          {parseError}
        </div>
      )}

      {creds && (
        <div style={{ padding: 10, background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4, marginBottom: 12, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
          <div><b>Label:</b> {creds.label || <i>(none)</i>}</div>
          <div><b>Email:</b> {creds.email}</div>
          <div><b>FB pass:</b> {maskedPass}</div>
          <div><b>DOB:</b> {creds.dob || <i>(none)</i>}</div>
          <div><b>Backup code:</b> {creds.backupCode ? creds.backupCode.slice(0, 20) + '…' : <i>(none)</i>}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <button
          onClick={start}
          disabled={running || !creds}
          style={{ padding: '8px 16px', background: (running || !creds) ? '#aaa' : '#111', color: '#fff', border: 0, borderRadius: 4, cursor: (running || !creds) ? 'default' : 'pointer' }}
        >
          {running ? 'Running…' : 'Start automatic login'}
        </button>
        {running && (
          <button
            onClick={cancel}
            style={{ padding: '8px 16px', background: '#b33', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </div>

      {liveUrl && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
            Live session: <a href={liveUrl} target="_blank" rel="noreferrer" style={{ color: '#06c' }}>open in new tab</a>
          </div>
          <iframe
            src={liveUrl}
            style={{ width: '100%', height: 640, border: '1px solid #ccc', borderRadius: 4 }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}

      {accountId && (
        <div style={{ padding: 12, background: '#e6ffe6', border: '1px solid #7c7', borderRadius: 4, marginBottom: 16 }}>
          <b>Saved:</b> accountId <code>{accountId}</code> · contextId <code>{contextId}</code>
        </div>
      )}

      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#111', color: '#ddd', padding: 12, borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
        {logs.length === 0 && <div style={{ color: '#777' }}>Logs will appear here…</div>}
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.kind === 'error' ? '#f88' : l.kind === 'result' ? '#8f8' : '#ddd' }}>
            [{l.t}] [{l.kind}] {l.text}
          </div>
        ))}
      </div>
    </div>
  )
}
