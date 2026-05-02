/**
 * Single entry point for creating a Browserbase SDK client.
 *
 * Mirrors the shape of src/lib/browser-use/client.ts so route handlers can
 * depend on one call site. Browserbase's Node SDK is ESM/CJS dual, so we can
 * import it directly (no eval('require') shim needed).
 */

import Browserbase from '@browserbasehq/sdk'

function getApiKey(): string {
  const key = process.env.BROWSERBASE_API_KEY
  if (!key) throw new Error('BROWSERBASE_API_KEY not set')
  return key
}

export function getBrowserbaseProjectId(): string {
  const id = process.env.BROWSERBASE_PROJECT_ID
  if (!id) throw new Error('BROWSERBASE_PROJECT_ID not set')
  return id
}

export function createBrowserbaseClient(): Browserbase {
  return new Browserbase({ apiKey: getApiKey() })
}
