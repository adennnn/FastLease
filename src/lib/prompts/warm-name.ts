import { COMMON_HEADER } from './common'

export function buildNamePrompt(firstName: string, lastName: string): string {
  const fn = (firstName || '').trim()
  const ln = (lastName || '').trim()
  const fnJson = JSON.stringify(fn)
  const lnJson = JSON.stringify(ln)

  const typeSteps: string[] = []
  if (fn) {
    typeSteps.push(`- Click directly inside the "First name" input field.
- Press Cmd+A (or Ctrl+A) to select all existing text, then press Delete/Backspace to clear it.
- Type ${fnJson} character-by-character into the field.`)
  }
  if (ln) {
    typeSteps.push(`- Click directly inside the "Last name" input field.
- Press Cmd+A (or Ctrl+A), then Delete/Backspace to clear it.
- Type ${lnJson} character-by-character.`)
  }
  typeSteps.push(`- Leave the "Middle name" field unchanged — do NOT touch it.
- Visually confirm the edited field(s) now show the new value(s) before continuing.`)

  const verifyCheck = (fn && ln)
    ? `If that heading contains BOTH ${fnJson} AND ${lnJson} (case-insensitive substring match): output exactly VERIFIED.`
    : `If that heading contains ${fn ? fnJson : lnJson} (case-insensitive substring match): output exactly VERIFIED.`

  const taskDesc = (fn && ln)
    ? `First=${fnJson}, Last=${lnJson}`
    : (fn ? `First=${fnJson}` : `Last=${lnJson}`)

  return `Facebook display name change — single focused task.

${COMMON_HEADER}

You are changing the account's display name to: ${taskDesc}.
You MUST complete every step below. Do NOT stop after merely opening the Name dialog — opening the dialog is NOT success. Success = the new name visibly appears on the profile page.

═══════════════════════════════════════════════════════════════
STEP 1 — Open Name settings via the top-right avatar dropdown:
═══════════════════════════════════════════════════════════════
- Click your small circular avatar in the top-right of the Facebook navbar. A dropdown appears.
- IMPORTANT: This is NOT the main profile page. Do NOT navigate to the profile page (facebook.com/me or profile.php) to change the name, and do NOT navigate directly to accountscenter.facebook.com — those paths do not reliably let you edit the name. The ONLY path that works is the top-right avatar dropdown described here.
- In the dropdown, click "Settings & privacy", then click "Settings".
- On the Settings page, find the search box at the top (labeled "Search settings" or shown with a magnifying glass icon) and type: name
- From the search results, click the entry for "Name" (it appears under "Personal details" / "Personal and account information").
- You should now see the Name section with fields for First name, Middle name (optional), and Last name. If an "Edit" button is shown next to the current name, click it to reveal the editable fields.

If the Name fields did not appear after the steps above, output NOT_VERIFIED and stop.

═══════════════════════════════════════════════════════════════
STEP 2 — Type the new name:
═══════════════════════════════════════════════════════════════
${typeSteps.join('\n')}

═══════════════════════════════════════════════════════════════
STEP 3 — Submit (push through the review + display-as screens):
═══════════════════════════════════════════════════════════════
- Click the button labeled "Review change" (it may say "Save" or "Continue" on some accounts — click whichever exists to advance).
- A second screen appears asking how to "Display as". Pick any available option (the top one — the full "First Last" version — is fine) and click "Save changes" (or "Save" / "Done" / "Confirm").
- If Facebook asks for the account password, skip this step entirely — do NOT try to enter a password. Output NOT_VERIFIED and stop.
- If Facebook says the name was changed recently and can't be changed yet, skip this step — output NOT_VERIFIED and stop.
- If FB says "Something Went Wrong - Please try again later", click OK to dismiss it. This error is OFTEN MISLEADING — the change usually saved. Continue to STEP 4.
- If a "Done" / "Close" / "X" button appears confirming success, click it to close the dialog.

═══════════════════════════════════════════════════════════════
STEP 4 — Verify (REQUIRED — do not skip even if STEP 3 looked successful):
═══════════════════════════════════════════════════════════════
- Navigate to https://www.facebook.com/me
- Wait 3 seconds for the page to fully load.
- Read the large name heading at the top of the profile (the one next to the profile picture).
- ${verifyCheck}
- If it does NOT contain the expected name: go back to STEP 1 and run STEPS 1–3 ONE MORE TIME, then re-verify. If still not visible, output exactly NOT_VERIFIED.

FINAL OUTPUT must be exactly one word: VERIFIED or NOT_VERIFIED.
Do NOT output anything else. Do NOT stop early. Stopping after STEP 1 (just opening the dialog) counts as a FAILURE.`
}
