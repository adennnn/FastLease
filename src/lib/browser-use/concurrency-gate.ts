/**
 * In-process semaphore that caps how many BU sessions we have in flight.
 *
 * BU's plan has a hard concurrent-session limit. If we exceed it, the overflow
 * requests get rejected with TooManyConcurrentActiveSessions errors which we
 * retry — but retries waste HTTP roundtrips and can stall the user with long
 * "Waiting for capacity" screens. Gating at the route layer means we only send
 * as many starts as BU can accept, and the rest queue in memory until capacity
 * frees up.
 *
 * Tune via env var `BU_MAX_CONCURRENT` (default 25). Set this at or slightly
 * below your actual BU plan limit.
 *
 * NOTE: this is per Node process, not cross-instance. Works on single-process
 * dev servers and a single serverless warm instance; if you scale out, BU's
 * own 429 retry in post-listing/route.ts remains the safety net.
 */

const MAX_CONCURRENT = Number(process.env.BU_MAX_CONCURRENT || '25')

let inFlight = 0
const waiters: Array<() => void> = []

export async function acquireSessionSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++
    return
  }
  await new Promise<void>(resolve => waiters.push(resolve))
  inFlight++
}

export function releaseSessionSlot(): void {
  inFlight = Math.max(0, inFlight - 1)
  const next = waiters.shift()
  if (next) next()
}

export function getGateStats() {
  return { inFlight, waiting: waiters.length, limit: MAX_CONCURRENT }
}
