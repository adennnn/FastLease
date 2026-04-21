import { COMMON_HEADER } from './common'

export function buildBioCityPrompt(bio: string, city: string): string {
  const parts: string[] = []
  if (bio) {
    parts.push(`(a) Set bio:
  - Navigate to https://www.facebook.com/me.
  - Find the "Intro" section in the LEFT column. Click "Edit bio" (or "Add bio").
  - In the dialog textarea (shows "0/101" counter), type EXACTLY: ${JSON.stringify(bio)}
  - Click "Save".`)
  }
  if (city) {
    parts.push(`(b) Set current city:
  - Navigate to https://www.facebook.com/me.
  - In the "Intro" section, click "Edit details" or the pencil icon (NOT the big "Edit profile" button).
  - In the "Current city" field, type ONLY: ${city}
  - Wait 2 seconds for dropdown suggestions, then click the FIRST "${city}, <State>" option.
  - Click "Save".`)
  }

  const verifyChecks: string[] = []
  if (bio) verifyChecks.push(`- Bio check: the Intro section must contain the substring ${JSON.stringify(bio.slice(0, 30))}.`)
  if (city) verifyChecks.push(`- City check: the Intro section must show "${city}" (any state).`)

  return `Facebook profile Intro edits.

${COMMON_HEADER}

STEP A — Make the changes:
${parts.join('\n\n')}

STEP B — Verify:
- Navigate to https://www.facebook.com/me. Wait for the Intro section to render.
${verifyChecks.join('\n')}
- If ALL checks pass, output exactly: VERIFIED
- If any check fails, retry the failed sub-step ONCE then re-verify. If still failing, output exactly: NOT_VERIFIED

FINAL OUTPUT must be exactly one word: VERIFIED or NOT_VERIFIED.`
}
