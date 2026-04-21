import { NextRequest } from 'next/server'
import { uniquifyImage } from '@/lib/uniquifyImage'
import { createClientV3 } from '@/lib/browser-use/client'
import { createSSEStream } from '@/lib/browser-use/sse-stream'
import { createAndUpload, deleteWorkspace } from '@/lib/browser-use/workspace'
import { pollLiveUrl } from '@/lib/browser-use/poll-live-url'
import { buildNamePrompt } from '@/lib/prompts/warm-name'
import { buildBioCityPrompt } from '@/lib/prompts/warm-bio-city'
import { buildPhotoPrompt } from '@/lib/prompts/warm-photo'
import { buildCleanupPrompt } from '@/lib/prompts/warm-cleanup'

/**
 * Atomized warmup: each editable field (name, bio+city, profile pic, cover) +
 * cleanup runs as its own focused task. One task per browser-use session (each
 * client.run creates a session under the hood). One step's failure can't burn
 * the budget for the rest.
 *
 * ORDER: profile pic → cover → name → bio+city → cleanup (last).
 */

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') }
}

type Step = {
  key: string
  label: string
  prompt: string
  needsWorkspace: boolean
  isText: boolean
  budget: number
}

export async function POST(req: NextRequest) {
  const { profileId, firstName, lastName, profilePicDataUrl, bannerDataUrl, bio, city } = await req.json()

  return createSSEStream(async (sse) => {
    if (!profileId) { sse.send('error', { error: 'No profile selected' }); return }

    const client = createClientV3()
    let workspaceId: string | null = null

    try {
      const fn = (firstName || '').trim()
      const ln = (lastName || '').trim()
      const FB_BIO_MAX = 101
      const bioForFb = Array.from((bio || '').trim()).slice(0, FB_BIO_MAX).join('')
      const cityTrimmed = (city || '').trim()

      const wantName = !!(fn || ln)
      const wantBioCity = !!(bioForFb || cityTrimmed)
      const wantProfilePic = !!profilePicDataUrl
      const wantCover = !!bannerDataUrl

      if (!wantName && !wantBioCity && !wantProfilePic && !wantCover) {
        sse.send('error', { error: 'Nothing to warm up — fill in at least one field' })
        return
      }

      // Upload images into a shared workspace
      if (wantProfilePic || wantCover) {
        sse.send('status', { message: 'Preparing images...' })
        const seedBase = (Date.now() ^ (profileId as string).split('').reduce((a: number, c: string) => (a * 31 + c.charCodeAt(0)) | 0, 0)) >>> 0
        const files: Array<{ name: string; contentType: string; buffer: Buffer }> = []

        if (wantProfilePic) {
          const parsed = parseDataUrl(profilePicDataUrl)
          if (parsed) files.push({ name: 'profile.jpg', contentType: 'image/jpeg', buffer: await uniquifyImage(parsed.buffer, seedBase) })
        }
        if (wantCover) {
          const parsed = parseDataUrl(bannerDataUrl)
          if (parsed) files.push({ name: 'cover.jpg', contentType: 'image/jpeg', buffer: await uniquifyImage(parsed.buffer, seedBase + 1) })
        }

        workspaceId = await createAndUpload(client, 'warmup', files)
      }

      // Build ordered step list
      const steps: Step[] = []
      if (wantProfilePic && workspaceId) {
        steps.push({ key: 'profilePic', label: 'Profile picture', prompt: buildPhotoPrompt('profile'), needsWorkspace: true, isText: false, budget: 2.00 })
      }
      if (wantCover && workspaceId) {
        steps.push({ key: 'cover', label: 'Cover photo', prompt: buildPhotoPrompt('cover'), needsWorkspace: true, isText: false, budget: 2.00 })
      }
      if (wantName) {
        steps.push({ key: 'name', label: 'Display name', prompt: buildNamePrompt(fn, ln), needsWorkspace: false, isText: true, budget: 1.50 })
      }
      if (wantBioCity) {
        steps.push({ key: 'bioCity', label: 'Bio + city', prompt: buildBioCityPrompt(bioForFb, cityTrimmed), needsWorkspace: false, isText: true, budget: 2.00 })
      }
      steps.push({ key: 'cleanup', label: 'Delete old posts & photos', prompt: buildCleanupPrompt(), needsWorkspace: false, isText: false, budget: 4.00 })

      // Run each step sequentially
      const results: Array<{ key: string; label: string; status: 'success' | 'failed' }> = []

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        sse.send('status', { message: `[${i + 1}/${steps.length}] ${step.label}...` })

        const runPromise = client.run(step.prompt, {
          model: 'claude-opus-4.6' as any,
          maxCostUsd: step.budget,
          proxyCountryCode: 'us',
          timeout: 900000,
          profileId,
          ...(step.needsWorkspace && workspaceId ? { workspaceId } : {}),
        })

        pollLiveUrl({
          client,
          runPromise,
          sse,
          sessionMeta: { step: step.key, label: step.label },
        })

        let stepStatus: 'success' | 'failed' = 'failed'
        try {
          const result = await runPromise
          const output: string = (result.output || '').trim()
          console.log(`[Warmup ${step.key}] output=${output.substring(0, 200)}`)

          if (step.isText) {
            const ok = /(^|[^_])VERIFIED\b/.test(output)
            const notVerified = /\bNOT_VERIFIED\b/.test(output)
            stepStatus = ok && !notVerified ? 'success' : 'failed'
          } else {
            const isDone = /\bDONE\b/.test(output)
            const isFailed = /\bFAILED\b/.test(output)
            stepStatus = isDone && !isFailed ? 'success' : 'failed'
          }
        } catch (err: any) {
          console.log(`[Warmup ${step.key}] threw: ${err.message}`)
        }

        results.push({ key: step.key, label: step.label, status: stepStatus })
        sse.send('status', { message: `[${i + 1}/${steps.length}] ${step.label}: ${stepStatus === 'success' ? 'OK' : 'failed'}` })
      }

      // Aggregate results
      const passed = results.filter(r => r.status === 'success').length
      const failed = results.filter(r => r.status === 'failed').map(r => r.label)
      const summary = failed.length === 0
        ? `Done — all ${results.length} steps succeeded`
        : `Done — ${passed}/${results.length} succeeded${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`

      sse.send('status', { message: summary })
      if (passed === 0) {
        sse.send('error', { error: summary })
      } else {
        sse.send('result', { success: true, output: summary, results })
      }
    } catch (error: any) {
      console.error('[Warmup] Error:', error.message)
      sse.send('error', { error: error.message || 'Failed to warm up account' })
    } finally {
      await deleteWorkspace(client, workspaceId)
    }
  })
}
