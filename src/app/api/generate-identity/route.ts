import { NextResponse } from 'next/server'
import { GoogleGenAI, Type } from '@google/genai'

/**
 * Generates a random realistic-sounding Facebook persona for account warmup.
 * Ethnicity + gender are picked server-side from a fixed pool so we get diversity.
 * Gemini fills in name (culturally consistent), bio (realtor-adjacent, casual),
 * and city (Midwest metro).
 */

// Weighted pool — White and East Asian show up more; fair-skinned Hispanic is rarer.
// No Middle Eastern, no South Asian, no Southeast Asian, no darker-skinned Hispanic per user direction.
const POOL: Array<{ ethnicity: string; gender: 'male' | 'female' }> = [
  // White — heaviest weight
  { ethnicity: 'White / European American', gender: 'male' },
  { ethnicity: 'White / European American', gender: 'female' },
  { ethnicity: 'White / European American', gender: 'male' },
  { ethnicity: 'White / European American', gender: 'female' },
  // East Asian (Chinese / Korean / Japanese — lighter complexion)
  { ethnicity: 'East Asian', gender: 'male' },
  { ethnicity: 'East Asian', gender: 'female' },
  { ethnicity: 'East Asian', gender: 'male' },
  { ethnicity: 'East Asian', gender: 'female' },
  // Black / African American
  { ethnicity: 'Black / African American', gender: 'male' },
  { ethnicity: 'Black / African American', gender: 'female' },
  { ethnicity: 'Black / African American', gender: 'male' },
  { ethnicity: 'Black / African American', gender: 'female' },
  // Light-skinned / Spanish-European Hispanic (fair complexion) — rarer
  { ethnicity: 'White Hispanic (fair-skinned, Spanish / European Latino features)', gender: 'male' },
  { ethnicity: 'White Hispanic (fair-skinned, Spanish / European Latino features)', gender: 'female' },
]

const MIDWEST_CITIES = [
  'Chicago', 'Indianapolis', 'Detroit', 'Minneapolis', 'Milwaukee',
  'Columbus', 'Cleveland', 'Cincinnati', 'St. Louis', 'Kansas City',
  'Des Moines', 'Madison', 'Grand Rapids', 'Ann Arbor', 'Dayton',
]

const JOBS = [
  'Realtor', 'Real estate agent', 'Title agent at a title company',
  'Mortgage loan officer', 'Escrow officer', 'Property manager',
  'Real estate broker', 'Mortgage broker', 'Real estate photographer',
]

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

/**
 * Gemini routinely 503s with "high demand" during spikes. Retry a few times with
 * exponential backoff before surfacing the error to the user.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      const msg = String(e?.message || '')
      const retryable = /503|UNAVAILABLE|overloaded|high demand|429|RESOURCE_EXHAUSTED/i.test(msg)
      if (!retryable || i === attempts - 1) throw e
      const delay = 800 * Math.pow(2, i) + Math.random() * 400
      console.log(`[generate-identity] retrying after ${Math.round(delay)}ms (attempt ${i + 2}/${attempts}): ${msg.slice(0, 120)}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set in .env.local' }, { status: 500 })
  }

  const persona = pick(POOL)
  const city = pick(MIDWEST_CITIES)
  const job = pick(JOBS)
  const age = 28 + Math.floor(Math.random() * 18) // 28–45

  const ai = new GoogleGenAI({ apiKey })

  const prompt = `Generate a realistic Facebook persona for someone who works in real estate.

REQUIREMENTS (you MUST use these exact values):
- Ethnicity: ${persona.ethnicity}
- Gender: ${persona.gender}
- Age: around ${age}
- Current city: ${city}
- Job: ${job}

Rules:
- First name and last name MUST be culturally consistent with the ethnicity (e.g. for South Asian female, names like "Priya Patel" or "Anjali Sharma"; for East Asian male, "Kenji Tanaka" or "David Chen"; for Black female, "Keisha Johnson" or "Tanisha Williams"; for Hispanic male, "Carlos Rivera"; etc.). Use common American/Anglicized first names when that fits the persona.
- Bio must feel casual and real, like an actual Facebook bio — short (under 80 chars), lowercase-friendly, may use one or two emojis, and MUST reference both the real-estate job AND a personal detail (kids, pets, born-and-raised, faith, sports team, college, hobby). Examples of the vibe (do NOT copy the wording, just match the tone — and do NOT wrap your output in quotes):
  realtor @ redfin | born and raised in chi-town | boy mom x2 💙
  title agent • indy native • coffee + dogs 🐾
  helping families find home since 2018 🏡 | go blue 〽️
- IMPORTANT: Do NOT put any double-quote characters (" or "" or "") inside the bio string. The bio field value itself should contain NO quotation marks of any kind. Use pipes (|) or bullets (•) as separators — never quotes.
- City should be JUST the city name (no state): "${city}".
- Do NOT include the state in any field.`

  const callModel = (model: string) => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          firstName: { type: Type.STRING },
          lastName: { type: Type.STRING },
          bio: { type: Type.STRING },
        },
        required: ['firstName', 'lastName', 'bio'],
      },
    },
  })

  // Primary model, then fall back to a less-loaded sibling if Gemini keeps 503ing.
  // Both return the same schema so downstream parsing is identical.
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite']

  try {
    let response: any = null
    let lastErr: any = null
    for (const model of MODELS) {
      try {
        response = await withRetry(() => callModel(model))
        break
      } catch (e: any) {
        lastErr = e
        console.log(`[generate-identity] ${model} exhausted retries: ${String(e?.message || '').slice(0, 120)}`)
      }
    }
    if (!response) throw lastErr || new Error('All Gemini models failed')

    const text = response.text ?? ''
    const parsed = JSON.parse(text)

    // Gemini sometimes leaks quote characters into the bio (the prompt's example
    // bios used to be wrapped in "..." and the model copied that pattern into
    // its output as stray "" after each segment). Strip ALL quote variants —
    // straight, curly, and CJK — from the bio before storing. Collapse any
    // double-spaces that leaves behind, and trim separator punctuation that
    // ends up orphaned.
    const stripQuotes = (s: string) =>
      (s || '')
        .replace(/["'“”‘’„‟«»]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*\|\s*\|/g, ' | ')  // collapse empty segments
        .replace(/^\s*[|•,\s]+|[|•,\s]+\s*$/g, '')
        .trim()

    return NextResponse.json({
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      bio: stripQuotes(parsed.bio),
      city,
      ethnicity: persona.ethnicity,
      gender: persona.gender,
      age,
      job,
    })
  } catch (e: any) {
    console.error('[generate-identity] error:', e.message)
    return NextResponse.json({ error: e.message || 'Generation failed' }, { status: 500 })
  }
}
