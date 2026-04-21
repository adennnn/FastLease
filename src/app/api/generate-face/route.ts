import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI, Modality } from '@google/genai'

/**
 * Generates a profile picture + optional banner image that match the given persona.
 * Uses Gemini 2.5 Flash Image (nano-banana) — it produces photorealistic people
 * while allowing ethnicity / gender / age / setting control via prompt.
 *
 * VARIATION STRATEGY: we randomize across seven dimensions per generation (scene,
 * framing, camera style, outfit, lighting, expression, optional prop). Gemini's
 * default behavior with a terse prompt is to center on a head-and-shoulders
 * smiling portrait — diverse pool entries nudge it toward full-body shots,
 * candid mid-laugh photos, driver-seat selfies, farmers-market candids, etc.
 * Without this, every generated account looks like the same studio portrait
 * with only ethnicity / background swapped.
 */

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const PORTRAIT_SCENES = [
  'Sitting at a coffee shop table with a latte partially in frame',
  'Standing in front of a nice house exterior, house keys loose in one hand',
  'A selfie from the driver\'s seat of a car, seatbelt visible, dashboard below',
  'Standing behind a kitchen island in a staged home during an open house',
  'Leaning against a home kitchen counter with morning light streaming in',
  'On a backyard patio with string lights softly blurred behind',
  'Walking a dog down a neighborhood sidewalk, leash visible',
  'Sitting at a desk in a real-estate office with a monitor and paperwork behind',
  'On the sidelines of a kid\'s soccer or baseball game, other parents softly blurred',
  'At an outdoor farmers market with produce stands and shoppers blurred behind',
  'At a lakefront or riverside park, water and trees in the background',
  'In a restaurant booth with warm dim evening lighting',
  'At a backyard barbecue with a grill faintly visible behind',
  'In workout clothes on a neighborhood sidewalk, pausing mid-jog',
  'Wrapped in a blanket on a living-room couch in winter, warm lamp light',
  'On the front porch of a house at golden hour',
  'At a tailgate with a stadium parking lot blurred behind',
  'At a holiday dinner table with candles, plates, and glassware in frame',
  'On a hiking trail with natural outdoor light',
  'On a boat on a lake, sunglasses pushed up on the head, wind in hair',
  'At a brewery patio table with a pint glass visible',
  'At a wedding reception, slightly dressed up, soft string lights behind',
  'On a neighborhood playground with kids visible in the background',
  'At the front door of a home, handing over keys during a close',
  'At a neighborhood block party with people mingling softly behind',
  'Inside a coffee-shop window seat, rain streaking the glass outside',
  'Sitting on a park bench with autumn leaves scattered around',
  'At an ice-cream shop counter with a cone in hand',
  'In a car with friends, backseat candid selfie vibe',
  'At a pumpkin patch or apple orchard in fall',
]

const PORTRAIT_FRAMINGS = [
  'Tight head-and-shoulders selfie at arm\'s length',
  'Medium shot showing upper torso, slightly off-center composition',
  'Three-quarter body shot in a relaxed pose',
  'Full body standing, leaning on a counter or railing',
  'Candid mid-motion from a few feet away, not posing',
  'Shot from across a table while seated',
  'Side profile with eyes turned toward the camera',
  'Shot from slightly below, camera angle tilted up',
  'Slightly overhead angle looking down on the subject',
  'Close-up of the face with one shoulder partially in frame',
  'Waist-up shot with hands visible doing something casual',
]

const PORTRAIT_CAMERA_STYLES = [
  'iPhone front camera selfie with slight pincushion distortion',
  'friend-took-this-photo casual iPhone snap from a short distance',
  'a mirror selfie on an iPhone (phone visible in the reflection, screen glare)',
  'a self-timer iPhone shot on a propped phone — subject looks natural, not posed',
  'someone else snapping a candid phone photo mid-conversation',
  'slightly out-of-focus phone camera snap',
  'a blurry mid-motion phone photo with visible motion blur',
  'a webcam / laptop camera grab during a video call',
  'a slightly grainy night-mode phone photo',
  'an iPhone portrait-mode shot with soft background bokeh',
]

const PORTRAIT_OUTFITS = [
  'business casual — a blazer over a plain tee',
  'a polo shirt in a solid color, relaxed fit',
  'a button-down with the sleeves rolled up',
  'a plain t-shirt and jeans',
  'a cozy sweater for a weekend vibe',
  'athletic / running gear, clearly just came from or heading to a workout',
  'a casual summer outfit appropriate to their gender',
  'shorts and a breezy top',
  'a winter coat with a scarf, cold-weather outdoor',
  'a professional blouse or shirt with a light blazer, dressed up',
  'a plaid flannel layered over a tee',
  'a hoodie, very casual lounge vibe',
  'slightly dressed-up wedding-guest level attire',
  'a local sports-team t-shirt or jersey',
  'a baseball cap and sunglasses pushed up on the head',
  'a light jacket over jeans',
  'scrubs-free office-casual: neat sweater over collared shirt',
]

const PORTRAIT_LIGHTING = [
  'bright morning sunlight through a window',
  'warm golden-hour outdoor light',
  'soft overcast midday light',
  'warm interior evening light from lamps',
  'harsh noon outdoor sunlight with visible shadows',
  'dim cafe lighting with incidental window light',
  'fluorescent office-style light',
  'slight backlit halo from the sun behind them',
  'warm restaurant patio string lights',
  'morning kitchen light with shadows across the counter',
  'blue-hour dusk light with warm street lamps in the background',
  'cloudy-day flat diffuse light',
  'neon sign glow reflecting slightly on the face (night out)',
]

const PORTRAIT_EXPRESSIONS = [
  'warm genuine smile, eyes making direct contact with the camera',
  'laughing mid-motion with the head slightly back',
  'neutral thoughtful expression with a hint of a smile, eyes slightly off-camera',
  'smirking with the head tilted',
  'candid unposed expression caught mid-conversation',
  'relaxed grin with kind eyes',
  'serious but friendly, professional demeanor',
  'mid-laugh with the eyes crinkled',
  'slightly goofy face, friend-group energy',
  'surprised-happy expression like they just noticed the camera',
  'content, soft, looking off into the distance',
  'mouth slightly open mid-word, natural and unposed',
]

// Deliberately weighted toward null so not every photo has a prop.
const PORTRAIT_PROPS: Array<string | null> = [
  'holding a coffee cup',
  'holding house keys loosely',
  'looking down at their phone',
  'holding a clipboard or folder of real-estate paperwork',
  'holding an iced drink with visible condensation',
  'with a small dog nearby or on a leash',
  'with a kid in frame — hand on shoulder or kid in their lap',
  'pointing off-camera at something out of frame',
  'giving a casual thumbs up',
  'holding a SOLD sign casually at the side',
  'holding a glass of wine',
  'holding a slice of pizza mid-bite',
  null, null, null, null, null, // no prop is the most common
]

function buildPortraitPrompt({ ethnicity, gender, age, city, job }: {
  ethnicity: string; gender: string; age: number; city: string; job: string
}): string {
  const scene = pick(PORTRAIT_SCENES)
  const framing = pick(PORTRAIT_FRAMINGS)
  const camera = pick(PORTRAIT_CAMERA_STYLES)
  const outfit = pick(PORTRAIT_OUTFITS)
  const lighting = pick(PORTRAIT_LIGHTING)
  const expression = pick(PORTRAIT_EXPRESSIONS)
  const prop = pick(PORTRAIT_PROPS)
  const propLine = prop ? `\n- They are ${prop}.` : ''

  return `A candid personal photograph — NOT a professional headshot — of a ${age}-year-old ${ethnicity} ${gender} who works as a ${job} in ${city}. The kind of photo a real person would use as their Facebook profile picture.

Setting / scene:
- ${scene}.

Framing & camera:
- ${framing}.
- Captured as ${camera}.
- Aspect ratio: 1:1 square.

Subject:
- Wearing ${outfit}.
- ${expression}.${propLine}
- Realistic hair with real strands; natural skin texture with pores, faint blemishes, minor asymmetries. Real humans are NOT perfectly symmetrical.

Lighting:
- ${lighting}.

CRITICAL — must look like a REAL photograph a friend took, not a professional headshot, not a stock photo, not obviously AI-generated. Avoid: airbrushed plastic skin, overly perfect teeth, glowing AI lighting, oversaturated colors, uncanny symmetry, surreal or dreamy backgrounds. Authentic imperfection is the goal.`
}

const BANNER_SCENES: Array<(city: string) => string> = [
  (c) => `A wide panoramic photograph of the ${c} skyline at golden hour — warm sunset light, scattered clouds, clearly recognizable as ${c}`,
  (c) => `A wide panoramic drone shot of the ${c} skyline at dusk, city lights just turning on, blue sky fading to warm`,
  (c) => `A wide photograph of a tree-lined residential neighborhood street in ${c}, morning light, sidewalks and front porches visible`,
  (c) => `A wide shot of the ${c} waterfront or riverfront at sunset, soft reflections on the water`,
  (c) => `A wide shot of a park in ${c} in autumn, fallen leaves and joggers softly blurred`,
  (c) => `A wide shot of downtown ${c}'s historic district, old brick buildings and warm street lamps at twilight`,
  (c) => `A wide shot of a suburban cul-de-sac near ${c}, nice homes with manicured lawns, golden-hour side-light`,
  (c) => `A wide photograph of a lakefront home or lakeside dock near ${c}, clear blue water, calm morning`,
  (c) => `A wide shot of a beautifully staged living-room interior — warm wood, natural daylight, the kind of listing photo a realtor would brag about`,
  (c) => `A wide Midwestern farmland scene near ${c} — big sky, tall grass, golden sunset`,
  (c) => `A wide night shot of the ${c} skyline with city lights reflecting on a river`,
  (c) => `A wide shot of an inviting front porch on a nice home in ${c}, seasonal decor, golden evening light`,
  (c) => `A wide family-friendly lakefront picnic scene near ${c}, soft focus, casual cozy vibe`,
  (c) => `A wide spring-bloom scene — flowering trees lining a residential street in ${c}, soft pastel light`,
  (c) => `A wide winter scene — snowy neighborhood street in ${c}, warm windows glowing`,
  (c) => `A wide overhead shot of fall foliage along a tree-lined road in ${c}`,
]

function buildBannerPrompt({ city }: { city: string }): string {
  const scene = pick(BANNER_SCENES)(city)
  return `${scene}. Photorealistic, shot on a DSLR or high-end camera, looks like a real photograph someone would proudly use as their Facebook cover photo. No text, no watermarks, no logos.

Aspect ratio: 16:5 very wide panoramic.`
}

/** Recognized hard quota error — the API key's project has no image-gen quota.
 *  Retrying won't help; the user has to enable billing at https://aistudio.google.com/apikey. */
function isQuotaError(msg: string): boolean {
  return /RESOURCE_EXHAUSTED|quota exceeded|free_tier|Please retry in/i.test(msg)
}

class QuotaExceededError extends Error {
  constructor(msg: string) { super(msg); this.name = 'QuotaExceededError' }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      const msg = String(e?.message || '')
      // 429 quota on image models = hard billing-gated limit. Don't burn time retrying.
      if (isQuotaError(msg)) throw new QuotaExceededError(msg)
      const retryable = /503|UNAVAILABLE|overloaded|high demand/i.test(msg)
      if (!retryable || i === attempts - 1) throw e
      const delay = 800 * Math.pow(2, i) + Math.random() * 400
      console.log(`[generate-face] retrying after ${Math.round(delay)}ms (attempt ${i + 2}/${attempts}): ${msg.slice(0, 120)}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// Image-generation models this key is authorized to call. We cycle through on
// 503/overload (different models often live on different capacity pools), but
// NOT on 429 — those share one project-wide billing quota, retrying is useless.
const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'nano-banana-pro-preview',
  'gemini-3-pro-image-preview',
]

async function genImage(ai: GoogleGenAI, prompt: string, label: string): Promise<string | null> {
  let lastQuotaErr: QuotaExceededError | null = null
  for (const model of IMAGE_MODELS) {
    for (let outer = 0; outer < 2; outer++) {
      try {
        const response = await withRetry(() => ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        }))

        const parts = response.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) {
          if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/')) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
          }
        }

        // No image part. Log what we DID get so the root cause is visible in `npm run dev` output.
        const textPart = parts.find((p: any) => p.text)?.text?.slice(0, 200) || '(empty)'
        const finishReason = response.candidates?.[0]?.finishReason || 'UNKNOWN'
        const blockReason = (response as any).promptFeedback?.blockReason
        console.log(`[generate-face] ${label} model=${model} attempt ${outer + 1}/2 returned no image. finishReason=${finishReason} blockReason=${blockReason} text=${textPart}`)

        if (blockReason) return null // safety block — no point retrying
        await new Promise(r => setTimeout(r, 500))
      } catch (e: any) {
        if (e instanceof QuotaExceededError) {
          // Remember it and try the next model — some accounts have per-model quota.
          lastQuotaErr = e
          console.log(`[generate-face] ${label} model=${model} quota exhausted — trying next model`)
          break // no point retrying THIS model's outer loop
        }
        throw e
      }
    }
  }
  if (lastQuotaErr) throw lastQuotaErr
  return null
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set in .env.local' }, { status: 500 })
  }

  const body = await req.json()
  const { ethnicity, gender, age, city, job, wantBanner } = body

  if (!ethnicity || !gender || !age || !city || !job) {
    return NextResponse.json({ error: 'Missing persona fields' }, { status: 400 })
  }

  const ai = new GoogleGenAI({ apiKey })

  try {
    // Generate portrait and banner in parallel
    const [profilePicDataUrl, bannerDataUrl] = await Promise.all([
      genImage(ai, buildPortraitPrompt({ ethnicity, gender, age, city, job }), 'portrait'),
      wantBanner ? genImage(ai, buildBannerPrompt({ city }), 'banner') : Promise.resolve(null),
    ])

    return NextResponse.json({ profilePicDataUrl, bannerDataUrl })
  } catch (e: any) {
    console.error('[generate-face] error:', e.message)
    // Flag quota errors with a dedicated code so the client can tell the user
    // to enable billing (retrying won't help — free-tier image quota is zero).
    if (e?.name === 'QuotaExceededError' || /RESOURCE_EXHAUSTED|quota exceeded|free_tier/i.test(e?.message || '')) {
      return NextResponse.json({
        error: 'Gemini image-generation quota is 0 on this API key. Enable billing on the Google Cloud project at https://aistudio.google.com/apikey (click the key → "Enable billing on project") and retry.',
        code: 'QUOTA_EXCEEDED',
      }, { status: 429 })
    }
    return NextResponse.json({ error: e.message || 'Image generation failed' }, { status: 500 })
  }
}
