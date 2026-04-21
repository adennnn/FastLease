import { NextRequest } from 'next/server'
import { startCaptchaWatcher, type CaptchaWatcherHandle } from '@/lib/captcha-solver'
import { createClientRoot } from '@/lib/browser-use/client'
import { createSSEStream } from '@/lib/browser-use/sse-stream'
import { pollLiveUrlWithCDP } from '@/lib/browser-use/poll-live-url'
import { buildSigninPrompt } from '@/lib/prompts/signin'

/**
 * One row → create a fresh browser-use profile → log into FB on it.
 * On LOGIN_OK we keep the profile (so it shows up in /api/profiles for warmup).
 * On any other outcome we delete the orphan so the BU dashboard stays clean.
 */
export async function POST(req: NextRequest) {
  const { email, fbPass, emailPass, dob, backupCode, profileName } = await req.json()

  return createSSEStream(async (sse) => {
    if (!email || !fbPass) { sse.send('error', { error: 'Missing email or password' }); return }

    const client = createClientRoot()
    let createdProfileId: string | null = null
    let sessionId: string | null = null
    let loginOk = false
    const watcherRef: { current: CaptchaWatcherHandle | null } = { current: null }

    const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
    console.log(`[Signin ${email}] Anthropic key present: ${!!anthropicKey} (len=${anthropicKey.length})`)

    try {
      sse.send('status', { message: 'Creating browser profile...' })
      const profile: any = await client.profiles.create({ name: profileName || email })
      createdProfileId = profile.id
      console.log(`[Signin] Created profile ${createdProfileId} (name="${profileName || email}") for ${email}`)

      const prompt = buildSigninPrompt({ email, fbPass, emailPass, dob, backupCode })

      sse.send('status', { message: 'Connecting to browser session...' })
      const preSession: any = await client.sessions.create({
        profileId: createdProfileId!,
        proxyCountryCode: 'us',
        keepAlive: false,
      })
      sessionId = preSession.id
      console.log(`[Signin ${email}] Pre-created session ${sessionId} keepAlive=false`)

      const runPromise = client.run(prompt, {
        model: 'claude-opus-4.6' as any,
        maxCostUsd: 4.00,
        timeout: 900000,
        sessionId: sessionId!,
      } as any)

      pollLiveUrlWithCDP({
        client,
        runPromise,
        sse,
        maxAttempts: 90,
        logPrefix: `[Signin ${email}]`,
        onSessionId: (sid) => { sessionId = sid },
        onCDPUrl: anthropicKey
          ? (cdpHttps) => {
              if (!watcherRef.current) {
                watcherRef.current = startCaptchaWatcher(cdpHttps, anthropicKey, email)
                console.log(`[Signin ${email}] Vision watcher started cdp=${cdpHttps.slice(0, 80)}`)
              }
            }
          : undefined,
      })

      const result = await runPromise
      const output: string = (result.output || '').trim()
      console.log(`[Signin ${email}] status=${result.status} output=${output.substring(0, 300)}`)

      loginOk = /\bLOGIN_OK\b/.test(output)

      if (loginOk) {
        sse.send('status', { message: 'Saving cookies to profile...' })
        let cookieDomains: string[] = []
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const prof: any = await client.profiles.get(createdProfileId!)
            if (prof?.cookieDomains?.length > 0) { cookieDomains = prof.cookieDomains; break }
          } catch {}
        }
        if (cookieDomains.length === 0) {
          console.log(`[Signin ${email}] WARNING: LOGIN_OK but no cookieDomains after 60s — profile is empty, deleting`)
          sse.send('error', { error: 'Login succeeded but cookies failed to persist to profile — try again' })
          loginOk = false
        } else {
          console.log(`[Signin ${email}] cookies persisted: ${cookieDomains.join(', ')}`)
          sse.send('result', { success: true, profileId: createdProfileId, output, cookieDomains })
        }
      } else {
        const reasonMatch = output.match(/LOGIN_FAILED:?\s*(.+)/i)
        const captchaStuck = /NEEDS_HUMAN_CAPTCHA/.test(output)
        const reason = reasonMatch
          ? reasonMatch[1].trim().slice(0, 200)
          : captchaStuck
            ? 'CAPTCHA was not solved in time'
            : (output.slice(0, 200) || 'Login did not complete')
        sse.send('error', { error: `Sign-in failed: ${reason}` })
      }
    } catch (error: any) {
      console.error(`[Signin ${email}] Error:`, error.message)
      sse.send('error', { error: error.message || 'Failed to sign in' })
    } finally {
      if (watcherRef.current) {
        try { watcherRef.current.abort(); await watcherRef.current.done } catch {}
      }
      if (sessionId && !loginOk) {
        try { await client.sessions.stop(sessionId) } catch {}
      }
      if (createdProfileId && !loginOk) {
        try {
          await client.profiles.delete(createdProfileId)
          console.log(`[Signin] Deleted orphan profile ${createdProfileId}`)
        } catch (e: any) {
          console.log(`[Signin] Failed to delete profile ${createdProfileId}: ${e.message}`)
        }
      }
    }
  })
}
