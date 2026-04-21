import { COMMON_HEADER } from './common'

export function buildCleanupPrompt(): string {
  return `Facebook profile cleanup — best-effort delete of OLD archived photos and old timeline posts. New profile picture / cover have already been uploaded; those are still active. Your job is to wipe the archive behind them.

${COMMON_HEADER}

This is a best-effort task. If you can't find something, move on — do NOT get stuck trying to delete the last item. SAFETY CAPS below prevent infinite loops. Delete ONLY content owned by this account — never touch friends' posts, tagged photos from others, or messages.

CRITICAL — active vs. archived photos:
- The "Profile pictures" album contains the currently-active profile picture PLUS every previous one FB has archived. We want to delete the OLD archived ones and LEAVE the active one alone.
- The "Cover photos" album works the same way — currently-active cover + archived history.
- You do NOT have to manually figure out which is active. Facebook REFUSES to delete the currently-active profile picture / cover — the delete button is hidden or the request fails silently. If a delete attempt on a photo doesn't work, SKIP it and move to the next photo. That's almost certainly the active one.

═══════════════════════════════════════════════════════════════
TASK 1 — Delete old archived PROFILE PICTURES (cap: 12 photos):
═══════════════════════════════════════════════════════════════
- Navigate to https://www.facebook.com/me and wait for the profile to load.
- Click the "Photos" tab in the profile's horizontal navigation (between "Posts" and "Videos" / "Reels").
- Click the "Albums" sub-tab.
- Find and open the album titled "Profile pictures" (may also say "Profile photos").
- If the album does not exist OR contains 1 or 0 photos, skip to TASK 2 (there's nothing old to delete — just the current active one).
- For each photo in the album (up to 12):
  a. Click the photo to open it in the lightbox viewer.
  b. Click the "..." / three-dot menu button in the TOP-RIGHT of the viewer (NOT on the photo itself).
  c. If a menu appears, look for "Delete photo" / "Move to trash" / "Delete". If those options are NOT in the menu, this is the currently-active profile picture — close the viewer and move to the next photo.
  d. Click "Delete photo" (or "Move to trash" / "Delete").
  e. A confirmation popup appears. Click the confirm button ("Delete" / "Move" / "Confirm").
  f. The viewer closes and returns you to the album. Wait 2 seconds.
  g. If the album now shows 1 or 0 photos, stop and go to TASK 2.
- If TWO delete attempts in a row fail (no menu appears, no delete option, confirmation doesn't show): skip to TASK 2.

═══════════════════════════════════════════════════════════════
TASK 2 — Delete old archived COVER PHOTOS (cap: 12 photos):
═══════════════════════════════════════════════════════════════
- Same flow as TASK 1, but target the album "Cover photos" instead.
- Same rule: the currently-active cover photo is in this album but can't be deleted. Skip it if the delete option is missing and move on.
- If the album does not exist OR contains 1 or 0 photos, skip to TASK 3.

═══════════════════════════════════════════════════════════════
TASK 3 — Delete old TIMELINE POSTS (cap: 20 posts):
═══════════════════════════════════════════════════════════════
- Navigate to https://www.facebook.com/me and wait for the timeline ("Posts" tab) to load.
- Scroll down once so several posts are visible.
- For each post on the timeline (up to 20):
  a. IMPORTANT — verify the post is YOURS: the post header must show JUST this account's name (the one at the top of the profile). If the header says something like "John added you to his post" or "You are tagged in X's post", SKIP that post — it's not ours to delete.
  b. IMPORTANT — leave the two posts that say "updated their profile picture" and "updated their cover photo" alone if they were posted today — those are the brand-new PFP/cover we just uploaded. Scroll past them.
  c. Click the "..." / three-dot menu button in the TOP-RIGHT of the post card.
  d. From the menu, click "Move to trash" (preferred) or "Delete post".
  e. If a confirmation popup appears, click "Move" / "Delete" / "Confirm".
  f. Wait 2 seconds. The post disappears from the timeline.
  g. If the timeline shows "No posts to show" / "Nothing to see here" / empty state, stop.
- If ANY delete attempt fails twice in a row: stop TASK 3 and move to OUTPUT.

═══════════════════════════════════════════════════════════════
ABSOLUTE DON'Ts for this entire session:
═══════════════════════════════════════════════════════════════
- Do NOT unfriend anyone.
- Do NOT delete anything inside "Mobile uploads" or "Timeline photos" albums — we only wipe Profile pictures and Cover photos.
- Do NOT deactivate or delete the account.
- Do NOT delete messages / conversations.
- Do NOT leave any groups or pages.
- Do NOT empty the Trash / Recycle bin (FB auto-purges after 30 days — that's fine).
- Do NOT delete the currently-active profile picture or cover photo.

OUTPUT:
- Whether you deleted 0 items or 40 items, output exactly: DONE
- Only output FAILED if you could not even load the profile page.

FINAL OUTPUT must be exactly one word: DONE or FAILED. Do NOT output anything else.`
}
