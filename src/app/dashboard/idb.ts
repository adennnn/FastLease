/**
 * Tiny IndexedDB wrapper for heavy blobs that overflow localStorage.
 *
 * Why: localStorage caps at ~5MB per origin. A single generated profile picture
 * (Gemini nano-banana @ 1024×1024 base64 JPEG) is 1-2MB, so 3-4 accounts with
 * pfp+banner is enough to blow the cap. Once over, ALL localStorage writes
 * fail — including the tiny ones like session state — so the whole dashboard
 * appears to lose its memory on reload.
 *
 * IndexedDB per-origin quota is typically 50MB on iOS, up to several GB on
 * desktop — plenty for hundreds of warmup accounts.
 *
 * We store ONE record per accountId with both pfp + banner dataUrls inline.
 * Keys = browser-use profileId. Values = { profilePic?: string, banner?: string }.
 *
 * All functions are safe to call during SSR (they no-op when window is undefined).
 */

const DB_NAME = 'leasely'
const DB_VERSION = 1
const STORE_IMAGES = 'warmup_images'

export interface WarmupImageRecord {
  profilePic?: string
  banner?: string
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES)
      }
    }
  })
}

/** Write (or overwrite) the image record for one account. Fire-and-forget safe. */
export async function idbSetWarmupImages(accountId: string, record: WarmupImageRecord): Promise<void> {
  if (!isBrowser()) return
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite')
      const req = tx.objectStore(STORE_IMAGES).put(record, accountId)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch (err) {
    console.warn('[idb] setWarmupImages failed', err)
  }
}

/** Delete the image record for one account (e.g. when user removes a PFP). */
export async function idbDeleteWarmupImages(accountId: string): Promise<void> {
  if (!isBrowser()) return
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite')
      const req = tx.objectStore(STORE_IMAGES).delete(accountId)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch (err) {
    console.warn('[idb] deleteWarmupImages failed', err)
  }
}

/** Load ALL image records at once — one IDB transaction, single round-trip. */
export async function idbGetAllWarmupImages(): Promise<Record<string, WarmupImageRecord>> {
  if (!isBrowser()) return {}
  try {
    const db = await openDB()
    return await new Promise<Record<string, WarmupImageRecord>>((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly')
      const store = tx.objectStore(STORE_IMAGES)
      const keysReq = store.getAllKeys()
      const valuesReq = store.getAll()
      let keys: IDBValidKey[] | null = null
      let values: WarmupImageRecord[] | null = null
      const finish = () => {
        if (keys === null || values === null) return
        const out: Record<string, WarmupImageRecord> = {}
        for (let i = 0; i < keys.length; i++) out[String(keys[i])] = values[i]
        resolve(out)
      }
      keysReq.onsuccess = () => { keys = keysReq.result; finish() }
      valuesReq.onsuccess = () => { values = valuesReq.result; finish() }
      keysReq.onerror = () => reject(keysReq.error)
      valuesReq.onerror = () => reject(valuesReq.error)
    })
  } catch (err) {
    console.warn('[idb] getAllWarmupImages failed', err)
    return {}
  }
}
