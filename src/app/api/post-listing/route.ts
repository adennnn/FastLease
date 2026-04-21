import { NextRequest } from 'next/server'
import { uniquifyImage } from '@/lib/uniquifyImage'
import { createClientV3 } from '@/lib/browser-use/client'
import { createSSEStream } from '@/lib/browser-use/sse-stream'
import { createAndUpload, deleteWorkspace } from '@/lib/browser-use/workspace'
import { pollLiveUrl } from '@/lib/browser-use/poll-live-url'
import { buildPostListingPrompt } from '@/lib/prompts/post-listing'

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

      sse.send('status', { message: 'Connecting to browser session...' })
      console.log(`[PostListing] Using persistent profile: ${profileId}, workspace: ${workspaceId}, images: ${imageFiles.length}`)

      const runPromise = client.run(prompt, {
        model: 'claude-opus-4.6' as any,
        maxCostUsd: 7.00,
        proxyCountryCode: 'us',
        timeout: 1800000,
        profileId,
        ...(workspaceId ? { workspaceId } : {}),
      })

      pollLiveUrl({
        client,
        runPromise,
        sse,
        maxAttempts: 60,
        onSessionId: (sid) => { sessionId = sid },
      })

      const result = await runPromise
      const output = result.output || ''
      const isTaskSuccessful = result.isTaskSuccessful
      console.log(`[PostListing] Browser Use status: ${result.status}, isTaskSuccessful: ${isTaskSuccessful}, output: ${output.substring(0, 500)}`)

      const listingUrlMatch = output.match(/https?:\/\/(?:www\.)?facebook\.com\/marketplace\/item\/\d+/i)
        || output.match(/https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>]+/i)
      const listingUrl = listingUrlMatch ? listingUrlMatch[0] : null

      const agentReportedFailure = isTaskSuccessful === false && output && !output.includes('Task ended unexpectedly')
      const realFailure = agentReportedFailure && !listingUrl

      if (realFailure) {
        const shortOutput = (output || '').substring(0, 300)
        sse.send('error', { error: `Posting failed: ${shortOutput || 'the agent could not complete the task'}` })
      } else {
        sse.send('result', { success: true, output, listingUrl })
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
      await deleteWorkspace(client, workspaceId)
    }
  })
}
