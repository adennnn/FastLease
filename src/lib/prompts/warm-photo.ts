import { COMMON_HEADER } from './common'

export function buildPhotoPrompt(kind: 'profile' | 'cover'): string {
  const fileName = kind === 'profile' ? 'profile.jpg' : 'cover.jpg'
  const targetLabel = kind === 'profile' ? 'profile picture' : 'cover photo'
  const filePath = `/workspace/${fileName}`

  const rules = `RULES (each prevents a past failure mode):
  ✗ Do NOT use JavaScript / DOM injection to manipulate <input type=file> (.files, dispatchEvent, synthetic clicks). Facebook detects this and fails the upload silently.
  ✗ Do NOT run shell commands (ls, find, cat) against /workspace/ — it's an SDK abstraction, listing returns nothing. The file IS there.
  ✗ Do NOT navigate to m.facebook.com or any mobile variant. Stay on www.facebook.com.
  ✓ When the file picker dialog opens, upload this EXACT path: ${filePath}
  ✓ If the upload fails twice in a row on the same step, output FAILED and stop.`

  if (kind === 'profile') {
    return `Update Facebook profile picture.

${COMMON_HEADER}

${rules}

STEP 1 — Record the CURRENT profile picture state (needed to verify the change landed later):
- Go to https://www.facebook.com/me and wait for the profile to fully load.
- Find the round profile picture at the top (next to your display name).
- Read the <img> element's src attribute (the URL the image loads from). Remember this value as BEFORE_URL. Ignore any "?..." query string — we only care about the path portion.
- Also visually note: is the current avatar (a) the DEFAULT silhouette (FB's generic grey-outline head) or (b) an EXISTING photograph? Remember which.

STEP 2 — Upload the new photo:
- Click the round profile picture. A small menu pops up.
- Click "Update profile picture" (may also say "Change profile picture" / "Edit profile picture").
- On the next screen, click "Upload photo" (NOT "Choose from existing", NOT "Take photo", NOT a frame/avatar/text option).
- When the file picker dialog opens, upload this file: ${filePath}
- After the upload finishes, Facebook shows a crop/preview screen.
- Click "Save" (may also say "Save changes" / "Done").
- Wait 5 seconds for the dialog to close and the profile to re-render.

STEP 3 — MANDATORY VERIFICATION (do not skip — this catches silent upload failures):
- Navigate back to https://www.facebook.com/me and wait for the page to fully reload.
- Look at the round profile picture and read its <img> src attribute again. Call this AFTER_URL (again, ignore "?..." query string).
- Decide success with BOTH signals:
  * URL check: is the path portion of AFTER_URL DIFFERENT from BEFORE_URL? Yes = good.
  * Visual check: does the profile picture now show a realistic photograph of a person (not the default silhouette)? Yes = good.
- SUCCESS requires at least one of the two signals above to clearly indicate change. If both signals show no change, the upload did not land.

OUTPUT (exactly one word, nothing else):
- DONE — if STEP 3 verification confirms the profile picture changed.
- FAILED — if STEP 3 shows the same image as BEFORE, OR if the file picker never opened, OR if Save never appeared, OR if FB showed an error.

IMPORTANT: do NOT output DONE without actually reloading /me and comparing BEFORE vs AFTER. "I clicked Save" is not sufficient — FB can fail silently. The verify step is mandatory.`
  }

  return `Update Facebook cover photo (banner).

${COMMON_HEADER}

${rules}

STEP 1 — Record the CURRENT cover photo state (needed to verify the change later):
- Go to https://www.facebook.com/me and wait for the profile to fully load.
- Find the wide cover-photo banner at the very top of the profile (above the profile picture).
- Read the cover photo's <img> src attribute (or the background-image URL of the cover div). Remember as BEFORE_URL. Ignore "?..." query string.
- Also visually note: is there currently a cover photo, or just a default blank/gradient banner? Remember which.

STEP 2 — Upload the new cover:
- Click the small camera icon on the cover photo, OR click "Add cover photo" / "Edit cover photo" if visible.
- A menu appears. Click "Upload photo".
- When the file picker dialog opens, upload this file: ${filePath}
- After the upload finishes, Facebook shows a positioning screen.
- Accept the default position. Click "Save changes" (may also say "Save" / "Publish").
- Wait 5 seconds for the dialog to close.

STEP 3 — MANDATORY VERIFICATION:
- Navigate back to https://www.facebook.com/me and wait for the page to fully reload.
- Look at the cover photo banner and read its src (or background-image URL). Call this AFTER_URL.
- Decide success with BOTH signals:
  * URL check: path portion of AFTER_URL differs from BEFORE_URL? Yes = good.
  * Visual check: is the cover now a realistic photograph (not the blank default banner)? Yes = good.
- SUCCESS requires at least one signal to clearly indicate change.

OUTPUT (exactly one word, nothing else):
- DONE — if STEP 3 verification confirms the cover photo changed.
- FAILED — if STEP 3 shows the same cover as BEFORE, OR if Upload photo / file picker / Save flow broke at any point.

IMPORTANT: do NOT output DONE without actually reloading /me and comparing BEFORE vs AFTER.`
}
