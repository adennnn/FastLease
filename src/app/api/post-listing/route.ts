import { NextRequest } from 'next/server'
import { uniquifyImage } from '@/lib/uniquifyImage'
import { createClientV3 } from '@/lib/browser-use/client'
import { createSSEStream } from '@/lib/browser-use/sse-stream'
import { createAndUpload, deleteWorkspace } from '@/lib/browser-use/workspace'
import { pollLiveUrl } from '@/lib/browser-use/poll-live-url'
import { acquireSessionSlot, releaseSessionSlot, getGateStats } from '@/lib/browser-use/concurrency-gate'
import { buildPostListingPrompt } from '@/lib/prompts/post-listing'

export const maxDuration = 1800

async function fetchImageBuffers(
  urls: string[],
  seedBase: number,
): Promise<Array<{ name: string; contentType: string; buffer: Buffer }>> {
  const results: Array<{ name: string; contentType: string; buffer: Buffer }> = []
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i])
      if (!res.ok) continue
      const raw = Buffer.from(await res.arrayBuffer())
      const unique = await uniquifyImage(raw, seedBase + i)
      results.push({ name: `image-${i + 1}.jpg`, contentType: 'image/jpeg', buffer: unique })
    } catch {
      console.log(`[PostListing] Failed to fetch/uniquify image ${i + 1}: ${urls[i]}`)
    }
  }
  return results
}

export async function POST(req: NextRequest) {
  const { title, description, price, category, condition, location, images, calendarLink, profileId } = await req.json()

  return createSSEStream(async (sse) => {
    if (!profileId) {
      sse.send('error', { error: 'No browser profile selected — please choose an account to post from' })
      return
    }

    const client = createClientV3()
    let sessionId: string | null = null
    let workspaceId: string | null = null
    let slotHeld = false

    try {
      // Upload images to workspace
      const imageFiles: Array<{ name: string; contentType: string }> = []
      if (Array.isArray(images) && images.length > 0) {
        sse.send('status', { message: 'Preparing photos...' })
        const seedBase = (Date.now() ^ (profileId as string).split('').reduce((a: number, c: string) => (a * 31 + c.charCodeAt(0)) | 0, 0)) >>> 0
        try {
          const buffers = await fetchImageBuffers(images, seedBase)
          if (buffers.length > 0) {
            workspaceId = await createAndUpload(client, 'listing', buffers)
            if (workspaceId) {
              imageFiles.push(...buffers.map(b => ({ name: b.name, contentType: b.contentType })))
            }
          }
        } catch (imgErr: any) {
          console.log(`[PostListing] Image upload failed, continuing without photos: ${imgErr.message}`)
        }
      }

      const listingText = [description, calendarLink ? `Schedule a tour: ${calendarLink}` : null]
        .filter((s): s is string => !!s)
        .join('\n\n')

      const prompt = buildPostListingPrompt({
        title,
        description: listingText,
        price,
        condition,
        location,
        calendarLink,
        imageFiles: imageFiles.map(f => ({ name: f.name })),
      })

      // Wait for a BU concurrency slot before kicking off the run. When the
      // user fires 50 posts simultaneously, this queues the overflow in memory
      // instead of hammering BU with requests that are guaranteed to 429.
      const gatePre = getGateStats()
      if (gatePre.inFlight >= gatePre.limit) {
        sse.send('status', { message: `Queued — ${gatePre.waiting + 1} ahead, waiting for capacity (limit ${gatePre.limit})` })
        console.log(`[PostListing] Gate full (${gatePre.inFlight}/${gatePre.limit}, ${gatePre.waiting} waiting) — queuing`)
      }
      await acquireSessionSlot()
      slotHeld = true

      sse.send('status', { message: 'Connecting to browser session...' })
      console.log(`[PostListing] Using persistent profile: ${profileId}, workspace: ${workspaceId}, images: ${imageFiles.length}, slot ${getGateStats().inFlight}/${getGateStats().limit}`)

      const runOpts = {
        model: 'claude-opus-4.6' as any,
        maxCostUsd: 7.00,
        proxyCountryCode: 'us',
        timeout: 1800000,
        profileId,
        ...(workspaceId ? { workspaceId } : {}),
      }

      // BU throws TooManyConcurrentActiveSessionsError (429) when the plan's
      // concurrency limit is hit. Kicking off ~13 posts in parallel exceeds
      // the limit and silently drops the overflow — retry with backoff so
      // every posting eventually runs as capacity frees up.
      const MAX_CONCURRENCY_ATTEMPTS = 20
      let output = ''
      let isTaskSuccessful: boolean | null | undefined = null
      let statusValue = ''
      for (let attempt = 0; ; attempt++) {
        const runPromise = client.run(prompt, runOpts)
        pollLiveUrl({
          client,
          runPromise,
          sse,
          maxAttempts: 60,
          onSessionId: (sid) => { sessionId = sid },
        })
        try {
          const result = await runPromise
          output = result.output || ''
          isTaskSuccessful = result.isTaskSuccessful
          statusValue = result.status || ''
          break
        } catch (err: any) {
          const detailStr = typeof err?.detail === 'string' ? err.detail : JSON.stringify(err?.detail ?? '')
          const combined = `${err?.message || ''} ${detailStr}`
          const statusCode = err?.statusCode
          const isConcurrency = statusCode === 429 || statusCode === 403 || /concurrent|too many|rate.?limit|capacity/i.test(combined)
          console.log(`[PostListing] run rejected — statusCode=${statusCode}, message="${err?.message}", detail=${detailStr.slice(0, 200)}, isConcurrency=${isConcurrency}`)
          if (isConcurrency && attempt < MAX_CONCURRENCY_ATTEMPTS - 1) {
            const waitSec = Math.min(20 + attempt * 5, 60)
            console.log(`[PostListing] Concurrency limit hit (attempt ${attempt + 1}/${MAX_CONCURRENCY_ATTEMPTS}), waiting ${waitSec}s`)
            sse.send('status', { message: `Waiting for capacity… (retry in ${waitSec}s)` })
            await new Promise(r => setTimeout(r, waitSec * 1000))
            sessionId = null
            continue
          }
          // Non-concurrency failure — BU often aborts the runPromise when a
          // session is stopped externally (cleanup, End-all, BU-side stop) even
          // though the agent already posted and captured a URL. Recover the
          // final output from the session before giving up.
          if (!sessionId) throw err
          console.log(`[PostListing] run aborted (${err?.message}); recovering from session ${sessionId}`)
          const session: any = await client.sessions.get(sessionId).catch(() => null)
          if (!session) throw err
          const sessionOutput = typeof session.output === 'string' ? session.output : ''
          output = sessionOutput || (typeof session.lastStepSummary === 'string' ? session.lastStepSummary : '')
          isTaskSuccessful = session.isTaskSuccessful ?? null
          statusValue = session.status || 'stopped'
          break
        }
      }

      console.log(`[PostListing] Browser Use status: ${statusValue}, isTaskSuccessful: ${isTaskSuccessful}, output: ${output.substring(0, 500)}`)

      const listingUrlMatch = output.match(/https?:\/\/(?:www\.)?facebook\.com\/marketplace\/item\/\d+/i)
        || output.match(/https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>]+/i)
      const listingUrl = listingUrlMatch ? listingUrlMatch[0] : null

      const agentReportedFailure = isTaskSuccessful === false && output && !output.includes('Task ended unexpectedly')
      const realFailure = agentReportedFailure && !listingUrl

      if (listingUrl) {
        // A captured marketplace URL is ground truth — the post is live,
        // regardless of BU's status (stopped/aborted/etc).
        sse.send('result', { success: true, output, listingUrl })
      } else if (realFailure) {
        const shortOutput = (output || '').substring(0, 300)
        sse.send('error', { error: `Posting failed: ${shortOutput || 'the agent could not complete the task'}` })
      } else if (statusValue === 'stopped' || statusValue === 'failed') {
        sse.send('error', { error: 'Session stopped before the listing finished posting' })
      } else {
        sse.send('result', { success: true, output, listingUrl: null })
      }
    } catch (error: any) {
      console.error('[PostListing] Error:', error.message)
      if (sessionId) {
        try {
          console.log(`[PostListing] Stopping orphaned session: ${sessionId}`)
          await client.sessions.stop(sessionId)
        } catch {}
      }
      sse.send('error', { error: error.message || 'Failed to post listing' })
    } finally {
      if (slotHeld) releaseSessionSlot()
      await deleteWorkspace(client, workspaceId)
    }
  })
}
