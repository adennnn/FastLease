export interface ListingFields {
  title: string
  description: string
  price: string
  condition: string
  location: string
  calendarLink?: string
  imageFiles: Array<{ name: string }>
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

export function buildPostListingPrompt(fields: ListingFields): string {
  const priceNum = fields.price.replace(/[^0-9.]/g, '') || '0'

  const listingText = [
    fields.description,
    fields.calendarLink ? `Schedule a tour: ${fields.calendarLink}` : null,
  ]
    .filter((s): s is string => !!s)
    .join('\n\n')

  // Extract city + state for the location dropdown
  const loc = fields.location.trim()
  const cityStateMatch = loc.match(/(?:^|,)\s*([^,]+?),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/)
  const cityOnly = cityStateMatch ? cityStateMatch[1].trim() : loc.split(',')[0].trim()
  const stateAbbr = cityStateMatch ? cityStateMatch[2] : ''
  const stateFull = STATE_NAMES[stateAbbr] || ''
  const cityQuery = stateFull ? `${cityOnly}, ${stateFull}` : cityOnly

  const photoStep = fields.imageFiles.length > 0
    ? `STEP 1 (DO THIS FIRST — it's the hardest step, do not skip): Click the "Add photos" button. When the file picker opens, upload these files from your workspace:\n${fields.imageFiles.map(f => `/workspace/${f.name}`).join('\n')}\nWait for all photos to finish uploading before moving on. If the upload stalls, try once more then continue.`
    : 'STEP 1: Skip photos.'

  return `Facebook Marketplace post.

Go to facebook.com/marketplace/create/item and select "Item for sale".

${photoStep}

STEP 2: Fill in the text fields:
- Title: ${fields.title}
- Price: ${priceNum}
- Category: Miscellaneous
- Condition: ${fields.condition}
- Description: paste the EXACT text between the <<<DESCRIPTION>>> markers below into the description textarea. Preserve every line break and every blank line exactly as written — do NOT collapse paragraphs, do NOT join lines, do NOT reformat or re-wrap. The description box accepts multi-line input with Enter (newline = new line, two newlines = blank line between paragraphs). After typing, visually verify the textarea shows the same line/blank-line structure as the source before moving on.
<<<DESCRIPTION>>>
${listingText}
<<<END DESCRIPTION>>>

STEP 3: Location field — type EXACTLY this into the location box: "${cityQuery}"
- Type the full state name (e.g. "South Carolina", not "SC"). This makes FB's dropdown surface the right city when multiple states share the name.
- Do NOT type a zip code.
- Wait for the dropdown suggestions to appear, then click the option that matches "${cityOnly}, ${stateFull || '<State>'}".
- If no exact match shows, click the closest "${cityOnly}, ${stateFull || '<State>'}" option (do not pick a different state).

STEP 4: Fields to SKIP entirely (leave completely blank):
- SKU
- Product tags

STEP 5: Click "Next". If a "Meetup preferences" or delivery option appears, always select "Public Meetup". Then click "Publish".

STEP 6 — after clicking Publish:
1. Wait for the success page to load.
2. Read the URL from the browser address bar — it should contain facebook.com/marketplace/item/NUMBERS.
3. Return that URL as your FINAL OUTPUT. Nothing else. Do not click anything else.
4. If you can't find it in the address bar, look for a "View Listing" / "See Listing" link and return that URL.

RULES: Already logged in — do NOT log in. Do NOT retry failed steps more than once. Be efficient. STOP immediately after returning the URL.`
}
