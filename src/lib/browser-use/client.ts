/**
 * Single entry point for creating a BrowserUse SDK client.
 *
 * Centralises the `eval('require')` CJS workaround so every route handler
 * doesn't have to carry it. Import either the v3 or root SDK depending on
 * what you need (v3 has workspaces but no profiles; root has profiles).
 */

export interface BrowserUseClient {
  run: (prompt: string, opts: Record<string, any>) => any
  sessions: {
    create: (opts: Record<string, any>) => Promise<any>
    get: (id: string) => Promise<any>
    stop: (id: string) => Promise<any>
  }
  workspaces: {
    create: (opts: { name: string }) => Promise<any>
    uploadFiles: (id: string, opts: { files: any[] }) => Promise<any>
    delete: (id: string) => Promise<void>
  }
  profiles: {
    create: (opts: { name: string }) => Promise<any>
    get: (id: string) => Promise<any>
    delete: (id: string) => Promise<void>
    list: (...args: any[]) => Promise<any>
  }
  tasks: {
    get: (id: string) => Promise<any>
  }
}

function getApiKey(): string {
  const key = process.env.BROWSER_USE_API_KEY
  if (!key) throw new Error('BROWSER_USE_API_KEY not set')
  return key
}

const runtimeRequire = eval('require') as NodeRequire

/** v3 SDK — has workspaces + sessions but NOT profiles. */
export function createClientV3(): BrowserUseClient {
  const { BrowserUse } = runtimeRequire('browser-use-sdk/v3')
  return new BrowserUse({ apiKey: getApiKey() }) as BrowserUseClient
}

/** Root SDK — has profiles + tasks but workspaces live under v3. */
export function createClientRoot(): BrowserUseClient {
  const { BrowserUse } = runtimeRequire('browser-use-sdk')
  return new BrowserUse({ apiKey: getApiKey() }) as BrowserUseClient
}
