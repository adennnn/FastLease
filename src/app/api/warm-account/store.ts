/**
 * In-memory token-gated image store for warmup runs.
 * Files served via /api/warm-account/image/[token]/[file] so the browser-use
 * cloud agent can wget them — sidesteps the broken /workspace mount.
 *
 * Lives only for the duration of a single Node process — restart wipes it.
 * That's fine: warmups are short-lived and credentials live in the prompt only.
 */

interface Entry {
  buffer: Buffer
  contentType: string
  expiresAt: number
}

const store = new Map<string, Entry>()

const TTL_MS = 30 * 60 * 1000

export function putImage(token: string, name: string, buffer: Buffer, contentType: string): void {
  store.set(`${token}/${name}`, { buffer, contentType, expiresAt: Date.now() + TTL_MS })
}

export function getImage(token: string, name: string): Entry | null {
  const k = `${token}/${name}`
  const entry = store.get(k)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) { store.delete(k); return null }
  return entry
}

export function generateToken(): string {
  // 32 hex chars = 128 bits — plenty for short-lived URL gating
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Periodic sweep so we don't leak buffers across many warmups.
if (typeof setInterval !== 'undefined' && !(globalThis as any).__warmupSweepInstalled) {
  setInterval(() => {
    const now = Date.now()
    store.forEach((v, k) => { if (v.expiresAt < now) store.delete(k) })
  }, 5 * 60 * 1000).unref?.()
  ;(globalThis as any).__warmupSweepInstalled = true
}
