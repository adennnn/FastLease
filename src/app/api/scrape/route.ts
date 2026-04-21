import { NextRequest, NextResponse } from 'next/server'
import { FirecrawlClient } from '@mendable/firecrawl-js'

export const runtime = 'nodejs'
export const maxDuration = 300

function launchPuppeteer() {
  const runtimeRequire = eval('require') as NodeRequire
  const puppeteerExtraModule = runtimeRequire('puppeteer-extra')
  const stealthPluginModule = runtimeRequire('puppeteer-extra-plugin-stealth')
  const puppeteerExtra = puppeteerExtraModule.default || puppeteerExtraModule
  const StealthPlugin = stealthPluginModule.default || stealthPluginModule
  puppeteerExtra.use(StealthPlugin())
  return puppeteerExtra
}

async function createStealthPage(browser: any) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })
  return page
}

// Extract property images by clicking through LoopNet's photo gallery
async function scrapeLoopNetImages(url: string): Promise<string[]> {
  const puppeteerExtra = launchPuppeteer()
  console.log(`[Scraper] Puppeteer image scrape for: ${url}`)
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1920,1080'],
  })
  try {
    const page = await createStealthPage(browser)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise(r => setTimeout(r, 2000))

    // Collect images from network requests (catches lazy-loaded CDN images)
    const networkImages = new Set<string>()
    page.on('response', (resp: any) => {
      const reqUrl = resp.url()
      if (reqUrl.match(/images1\.(loopnet|showcase)\.com\/i2\//i) && resp.status() === 200) {
        networkImages.add(reqUrl.split('?')[0])
      }
    })

    // Try to open the photo gallery by clicking the main image or "View Photos" button
    const galleryOpened = await page.evaluate(() => {
      // LoopNet gallery triggers: main hero image, "View All Photos", photo count badge
      const selectors = [
        '.mosaic-tile', '.gallery-hero', '[class*="photo-gallery"]', '[class*="PhotoGallery"]',
        '[class*="slide-image"]', '[data-testid*="photo"]', '[data-testid*="gallery"]',
        '.csgp-gallery-thumbnail', '.profile-hero-image', '.hero-image',
        'button[class*="photo"]', 'a[class*="photo"]',
        '[class*="image-gallery"]', '[class*="ImageGallery"]',
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement
        if (el) { el.click(); return true }
      }
      // Fallback: click the first large image on the page
      const imgs = Array.from(document.querySelectorAll('img'))
      const hero = imgs.find(img => img.offsetWidth > 300 && img.offsetHeight > 200)
      if (hero) { hero.click(); return true }
      return false
    })
    console.log(`[Scraper] Gallery opened: ${galleryOpened}`)
    await new Promise(r => setTimeout(r, 1500))

    // Click through gallery slides to trigger lazy loading of all images
    if (galleryOpened) {
      for (let i = 0; i < 30; i++) {
        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector(
            '[class*="next"], [class*="Next"], [aria-label*="next" i], [aria-label*="Next"], ' +
            'button[class*="arrow-right"], button[class*="right"], [class*="slick-next"], ' +
            '[class*="carousel-next"], [data-testid*="next"]'
          ) as HTMLElement
          if (nextBtn && nextBtn.offsetParent !== null) { nextBtn.click(); return true }
          // Try keyboard right arrow
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
          return false
        })
        await new Promise(r => setTimeout(r, 400))
        if (!hasNext && i > 3) break
      }
    }

    // Also scroll the full page to trigger any remaining lazy loads
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        window.scrollBy(0, 800)
        await new Promise(r => setTimeout(r, 300))
      }
      window.scrollTo(0, 0)
    })
    await new Promise(r => setTimeout(r, 1000))

    // Collect all image URLs from the DOM
    const domImages: string[] = await page.evaluate(() => {
      const urls = new Set<string>()
      // All img elements: src, data-src, srcset
      document.querySelectorAll('img, [data-src], source, [data-lazy]').forEach(el => {
        const candidates = [
          el.getAttribute('src'),
          el.getAttribute('data-src'),
          el.getAttribute('data-lazy'),
          el.getAttribute('data-original'),
          el.getAttribute('srcset')?.split(',').map(s => s.trim().split(' ')[0]).pop(),
        ]
        for (const c of candidates) {
          if (c && c.startsWith('http')) urls.add(c.split('?')[0])
        }
      })
      // Background images
      document.querySelectorAll('[style*="background-image"]').forEach(el => {
        const style = el.getAttribute('style') || ''
        const m = style.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/)
        if (m) urls.add(m[1].split('?')[0])
      })
      return Array.from(urls)
    })

    // Merge DOM + network images, filter to property CDN images only
    const allImages = new Set([...domImages, ...Array.from(networkImages)])
    const propertyImages = Array.from(allImages).filter(url => {
      if (!/images1\.(loopnet|showcase)\.com\/i2\//i.test(url)) return false
      if (/logo|icon|avatar|sprite|MapAvatar|Favorites|SS-Desktop|Share-Desktop|DR-Desktop|Header|Modules/i.test(url)) return false
      if (/\/105\//.test(url)) return false // broker headshots
      return true
    })

    console.log(`[Scraper] Puppeteer found ${propertyImages.length} property images (${domImages.length} DOM, ${networkImages.size} network)`)
    return propertyImages.slice(0, 30)
  } finally {
    await browser.close()
  }
}

// Use Browser Use (real browser with proxy) to extract property images from LoopNet/Showcase
interface BrowserUseResult {
  images: string[]
  units: { name: string; sqft: string; price: string; term: string; type: string; condition: string; available: string }[]
}
async function extractWithBrowserUse(loopnetUrl: string, onLiveUrl?: (url: string) => void): Promise<BrowserUseResult | null> {
  const apiKey = process.env.BROWSER_USE_API_KEY
  if (!apiKey) {
    console.log('[Scraper] BROWSER_USE_API_KEY not set, skipping Browser Use')
    return null
  }
  try {
    const runtimeRequire = eval('require') as NodeRequire
    const { BrowserUse } = runtimeRequire('browser-use-sdk/v3')

    const client = new BrowserUse({ apiKey })

    // Build Showcase URL (LoopNet blocks bots)
    const listingMatch = loopnetUrl.match(/\/[Ll]isting\/([^/]+)\/(\d+)/)
    const showcaseUrl = listingMatch
      ? `https://www.showcase.com/${listingMatch[1].toLowerCase()}/${listingMatch[2]}/`
      : null
    const slugMatch = loopnetUrl.match(/\/[Ll]isting\/([^/]+)\//)
    const addressSlug = slugMatch ? slugMatch[1].replace(/-/g, ' ') : ''

    console.log(`[Scraper] Browser Use: Showcase=${showcaseUrl}`)

    // NO schema — just get plain text output. Schemas cause silent failures.
    const runPromise = client.run(
      `Go to ${showcaseUrl || loopnetUrl} and extract data from this property listing.

If the page is blocked or shows "Access Denied", try google.com and search "${addressSlug} loopnet" then click the result.

Return your response in EXACTLY this format (no other text):
IMAGES:
[list each property photo URL on its own line - building photos, interiors, aerials, floor plans only - NO headshots, logos, maps, or icons]
UNITS:
[for each available space from "Space Availability" or "All Available Space" table, one per line in format: name | size | term | rental rate | space use | condition | available]
[IMPORTANT: Even for FOR SALE listings, there is often a Space Availability section - look for it and extract it. If there truly are no spaces listed, write: NONE]`,
      { model: 'bu-max', maxCostUsd: 1.00, proxyCountryCode: 'us', timeout: 160000 }
    )

    // Poll for the live URL while the task runs
    if (onLiveUrl) {
      const pollLiveUrl = async () => {
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const sessions = await client.sessions.list({ page: 1, page_size: 1 })
            const latest = sessions.sessions?.[0]
            if (latest?.liveUrl) {
              console.log(`[Scraper] Browser Use live URL: ${latest.liveUrl}`)
              onLiveUrl(latest.liveUrl)
              return
            }
          } catch {}
        }
      }
      pollLiveUrl().catch(() => {})
    }

    const result = await runPromise
    const raw = result.output || ''
    console.log(`[Scraper] Browser Use raw output (${raw.length} chars): ${raw.substring(0, 500)}`)

    // Parse the plain text response
    const images: string[] = []
    const units: BrowserUseResult['units'] = []

    // Extract image URLs
    const imgMatches = raw.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp|gif)[^\s"'<>]*/gi) || []
    for (const url of imgMatches) {
      if (!/logo|icon|avatar|headshot|MapAvatar/i.test(url)) {
        images.push(url.replace(/[)\]},]+$/, ''))
      }
    }
    // Also grab CDN URLs without extensions
    const cdnMatches = raw.match(/https:\/\/images1\.(loopnet|showcase)\.com\/i2\/[^\s"'<>]+/gi) || []
    for (const url of cdnMatches) {
      if (!/\/105\//.test(url)) images.push(url.replace(/[)\]},]+$/, ''))
    }

    // Parse units from pipe-delimited lines
    const unitSection = raw.split(/UNITS:/i)[1] || ''
    const unitLines = unitSection.split('\n').filter((l: string) => l.includes('|'))
    for (const line of unitLines) {
      const parts = line.split('|').map((s: string) => s.trim())
      if (parts.length >= 4) {
        units.push({
          name: parts[0] || 'Available Space',
          sqft: parts[1] || '',
          term: parts[2] || '',
          price: parts[3] || '',
          type: parts[4] || '',
          condition: parts[5] || '',
          available: parts[6] || 'Now',
        })
      }
    }

    // Deduplicate images
    const uniqueImages = Array.from(new Set(images))
    console.log(`[Scraper] Browser Use parsed ${uniqueImages.length} images, ${units.length} units (cost: $${result.totalCostUsd})`)
    return { images: uniqueImages, units }
  } catch (e: any) {
    console.log(`[Scraper] Browser Use failed: ${e.message}`)
    return null
  }
}

async function scrapeWithPuppeteer(url: string): Promise<string> {
  const puppeteerExtra = launchPuppeteer()
  console.log(`[Scraper] Puppeteer for: ${url}`)
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1920,1080'],
  })
  try {
    const page = await createStealthPage(browser)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 })
    // Scroll down to trigger lazy-loaded content
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, 600)
        await new Promise(r => setTimeout(r, 300))
      }
      window.scrollTo(0, 0)
    })
    // Wait briefly for lazy content
    await new Promise(r => setTimeout(r, 1000))

    const text = await page.evaluate(() => {
      // Collect all images including data-src and srcset
      const imgs = Array.from(document.querySelectorAll('img, [data-src], source')).map(el => {
        const src = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('srcset')?.split(' ')[0] || ''
        const alt = el.getAttribute('alt') || ''
        return src && src.startsWith('http') ? `![${alt}](${src})` : ''
      }).filter(Boolean).join('\n')
      // Also grab background images from CSS
      const bgImgs = Array.from(document.querySelectorAll('[style*="background-image"]')).map(el => {
        const style = el.getAttribute('style') || ''
        const urlMatch = style.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/)
        return urlMatch ? `![bg](${urlMatch[1]})` : ''
      }).filter(Boolean).join('\n')
      const body = document.body.innerText || ''
      return imgs + '\n' + bgImgs + '\n\n' + body
    })
    console.log(`[Scraper] Puppeteer got ${text.length} chars, first 500: ${text.substring(0, 500)}`)
    return text
  } finally {
    await browser.close()
  }
}

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY || ''

async function doScrape(address: string, directUrl: string, streamLiveUrl: (url: string) => void) {
    if (!address && !directUrl) {
      throw new Error('Address or LoopNet URL required')
    }

    if (!FIRECRAWL_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured')
    }

    const firecrawl = new FirecrawlClient({ apiKey: FIRECRAWL_KEY })

    let loopnetUrl = directUrl || null
    let cachedMd = ''

    // Start Browser Use in parallel when we have a direct LoopNet URL
    let browserUsePromise: Promise<BrowserUseResult | null> | null = null
    if (directUrl && directUrl.includes('loopnet.com')) {
      browserUsePromise = extractWithBrowserUse(directUrl, streamLiveUrl)
    }

    // Find LoopNet listing URL for address
    if (!loopnetUrl && address) {
      console.log(`[Scraper] Searching for: ${address}`)

      // Method 1: Firecrawl search API - try multiple query variations
      // Normalize street abbreviations to match LoopNet formatting
      const abbreviate = (s: string) => s
        .replace(/\bNorth\b/gi, 'N').replace(/\bSouth\b/gi, 'S')
        .replace(/\bEast\b/gi, 'E').replace(/\bWest\b/gi, 'W')
        .replace(/\bNortheast\b/gi, 'NE').replace(/\bNorthwest\b/gi, 'NW')
        .replace(/\bSoutheast\b/gi, 'SE').replace(/\bSouthwest\b/gi, 'SW')
        .replace(/\bStreet\b/gi, 'St').replace(/\bAvenue\b/gi, 'Ave')
        .replace(/\bBoulevard\b/gi, 'Blvd').replace(/\bDrive\b/gi, 'Dr')
        .replace(/\bLane\b/gi, 'Ln').replace(/\bRoad\b/gi, 'Rd')
        .replace(/\bCourt\b/gi, 'Ct').replace(/\bCircle\b/gi, 'Cir')
        .replace(/\bPlace\b/gi, 'Pl').replace(/\bParkway\b/gi, 'Pkwy')
        .replace(/\bHighway\b/gi, 'Hwy').replace(/\bTerrace\b/gi, 'Ter')
        .replace(/\bTrail\b/gi, 'Trl').replace(/\bWay\b/gi, 'Way')

      const streetAddr = address.split(',')[0]?.trim() || address
      const shortStreet = abbreviate(streetAddr)
      // Extract just the street name without house number for broader search
      const streetOnly = streetAddr.replace(/^\d+\s+/, '')
      // Get city from address
      const parts = address.split(',').map((s: string) => s.trim())
      const city = parts[1] || ''
      const state = parts[2]?.replace(/\d{5}.*/, '').trim() || ''

      const searchQueries = [
        `${shortStreet} ${city} site:loopnet.com`,
        `${address} site:loopnet.com`,
        `${abbreviate(streetOnly)} ${city} ${state} site:loopnet.com`,
      ]
      const candidateUrls: string[] = []
      for (const query of searchQueries) {
        if (candidateUrls.length >= 5) break
        try {
          console.log(`[Scraper] Search query: ${query}`)
          const searchResult = await firecrawl.search(query, { limit: 10 })
          const results = (searchResult as any)?.web || (searchResult as any)?.data || (searchResult as any)?.results || []
          for (const r of results) {
            const url = r.url || r.link || ''
            if (url.match(/loopnet\.com\/[Ll]isting\//) && !candidateUrls.includes(url)) {
              candidateUrls.push(url)
            }
          }
        } catch (e: any) {
          console.log(`[Scraper] Search failed: ${e.message}`)
        }
      }
      console.log(`[Scraper] Found ${candidateUrls.length} candidate URLs`)

      // Try candidates — pick the one with the most content
      let bestScore = 0
      for (const candidate of candidateUrls.slice(0, 5)) {
        try {
          console.log(`[Scraper] Trying: ${candidate}`)
          let testResult = await firecrawl.scrape(candidate, { formats: ['markdown'] })
          let testMd = testResult.markdown || ''
          // Detect Akamai block and fallback to Puppeteer
          if (testMd.length < 500 || testMd.match(/Akamai|Access\s+Denied/i)) {
            console.log(`[Scraper] Firecrawl blocked, trying Puppeteer for: ${candidate}`)
            try { testMd = await scrapeWithPuppeteer(candidate) } catch (pe: any) { console.log(`[Scraper] Puppeteer failed: ${pe.message}`) }
          }
          if (testMd.length > 500 && !testMd.match(/Access\s+Denied/i) && testMd.match(/SF|Space|Listing/i)) {
            // Score by content richness: spaces, facility facts, length
            const spaceMatches = (testMd.match(/Available\s+Spaces/i) ? 100 : 0)
            const factsMatches = (testMd.match(/Facility\s+Facts/i) ? 50 : 0)
            const score = testMd.length + spaceMatches * 1000 + factsMatches * 1000
            console.log(`[Scraper] Candidate score ${score}: ${candidate}`)
            if (score > bestScore) {
              bestScore = score
              loopnetUrl = candidate
              cachedMd = testMd
            }
            // If we found a really good one (has spaces + facts), stop early
            if (spaceMatches && factsMatches) break
          } else {
            console.log(`[Scraper] Skipping (no content or access denied): ${candidate}`)
          }
        } catch (e: any) {
          console.log(`[Scraper] Failed to scrape candidate: ${e.message}`)
        }
      }

      // Method 2: Scrape LoopNet search directly
      if (!loopnetUrl) {
        try {
          const shortAddr = address.split(',')[0]?.trim() || address
          const loopnetSearchUrl = `https://www.loopnet.com/search/commercial-real-estate/${encodeURIComponent(shortAddr)}/4/`
          console.log(`[Scraper] Trying LoopNet search: ${loopnetSearchUrl}`)
          const searchPage = await firecrawl.scrape(loopnetSearchUrl, { formats: ['markdown'] })
          const searchMd = searchPage.markdown || ''
          const urlMatch = searchMd.match(/https:\/\/www\.loopnet\.com\/[Ll]isting\/[^\s)\]"',]+/)
          if (urlMatch) {
            loopnetUrl = urlMatch[0].replace(/[)\]"',]+$/, '')
            console.log(`[Scraper] Found via LoopNet search: ${loopnetUrl}`)
          }
        } catch (e: any) {
          console.log(`[Scraper] LoopNet search failed: ${e.message}`)
        }
      }
    }

    if (!loopnetUrl) {
      return {
        id: Date.now().toString(), address: address || '', name: extractPropertyName(address || ''),
        type: 'Commercial', totalSqft: '', yearBuilt: '', images: [], units: [],
        highlights: [], features: {}, facilityFacts: {}, overview: '',
        source: 'manual', loopnetUrl: null,
        message: 'Property not found on LoopNet. Enter details manually.',
      }
    }

    let md = cachedMd
    const isBlockedContent = (s: string) => !s || s.length < 500 || /Akamai|Access\s+Denied/i.test(s)

    let scrapedHtml = ''

    // Step 1: Try Firecrawl on LoopNet
    if (isBlockedContent(md)) {
      console.log(`[Scraper] Scraping LoopNet with Firecrawl: ${loopnetUrl}`)
      try {
        const result = await firecrawl.scrape(loopnetUrl, { formats: ['markdown', 'html'] })
        md = result.markdown || ''
        scrapedHtml = result.html || ''
      } catch (e: any) { console.log(`[Scraper] Firecrawl error: ${e.message}`) }
    }

    // Step 2: If LoopNet blocked, try Showcase.com (mirrors LoopNet with same listing IDs)
    if (isBlockedContent(md)) {
      console.log(`[Scraper] LoopNet blocked — trying Showcase.com mirror`)
      const listingMatch = loopnetUrl.match(/\/[Ll]isting\/([^/]+)\/(\d+)/)
      if (listingMatch) {
        const slug = listingMatch[1].toLowerCase()
        const listingId = listingMatch[2]
        const showcaseUrls: string[] = [`https://www.showcase.com/${slug}/${listingId}/`]
        try {
          const addr = extractAddressFromUrl(loopnetUrl)
          const searchResult = await firecrawl.search(`"${addr}" site:showcase.com`, { limit: 3 })
          const results = (searchResult as any)?.data || (searchResult as any)?.results || []
          for (const r of results) {
            const url = r.url || r.link || ''
            if (url.includes('showcase.com') && url.includes(listingId) && !showcaseUrls.includes(url)) {
              showcaseUrls.unshift(url)
            }
          }
        } catch {}
        for (const scUrl of showcaseUrls.slice(0, 2)) {
          try {
            console.log(`[Scraper] Trying: ${scUrl}`)
            // Use both markdown (for text) and html (for images)
            const scResult = await firecrawl.scrape(scUrl, { formats: ['markdown', 'html'] })
            const scMd = scResult.markdown || ''
            scrapedHtml = scResult.html || ''
            if (!isBlockedContent(scMd) && !scMd.match(/404|not found/i)) {
              md = scMd
              console.log(`[Scraper] Got ${md.length} chars markdown, ${scrapedHtml.length} chars HTML from Showcase.com`)
              break
            }
          } catch (e: any) { console.log(`[Scraper] Showcase failed: ${e.message}`) }
        }
      }
    }

    // Treat blocked pages as empty
    const isBlocked = !md || md.length < 500 || md.match(/Akamai|Access\s+Denied/i)
    console.log(`[Scraper] Markdown length: ${md.length}, blocked: ${!!isBlocked}`)

    if (isBlocked) {
      const extractedAddr = address || extractAddressFromUrl(loopnetUrl)
      return {
        id: Date.now().toString(), address: extractedAddr,
        name: extractPropertyName(extractedAddr), type: 'Commercial', totalSqft: '', yearBuilt: '',
        images: [], units: [], highlights: [], features: {}, facilityFacts: {}, overview: '',
        source: 'loopnet', loopnetUrl,
        message: 'LoopNet blocked the scrape. Property added with basic info — you can add details manually.',
      }
    }

    // ── Property Name ──
    // Format: "# Cleveland Tech Center799 E 73rd St" or "# Name\n"
    let name = ''
    const h1Match = md.match(/^#\s+(.+)/m)
    if (h1Match) {
      name = h1Match[1].trim()
      // Clean up: collapse whitespace, remove " · Property For Lease/Sale" suffix
      name = name.replace(/\s+/g, ' ')
      name = name.replace(/\s*[·|]\s*Property\s+For\s+(?:Lease|Sale|Rent).*/i, '')
      // Name often has address/SF concatenated: "Cleveland Tech Center799 E 73rd St 489 - 78,191 SF..."
      // Try to extract just the property name before the street number
      const nameClean = name.match(/^([A-Za-z][A-Za-z\s&'.,-]+?)(?=\d{1,5}\s+(?:E|W|N|S|East|West|North|South)\s)/i)
      if (nameClean) {
        name = nameClean[1].trim()
      } else {
        // Fallback: cut at " SF of Space" or at a number followed by address
        name = name.split(/\d{3,}\s*[-–]\s*[\d,]+\s*SF/)[0].trim()
        name = name.split(/\d{3,}\s+SF/)[0].trim()
      }
    }
    // Fallback: try LoopNet title format "Property Name | Address" or "Property Name\nAddress"
    if (!name) {
      const titleMatch = md.match(/^([A-Za-z][A-Za-z\s&'.,-]+?)\s*[|]\s*\d+/m)
        || md.match(/^([A-Za-z][A-Za-z\s&'.,-]{3,}?)\n+\d+[\d,]+\s*SF/m)
        || md.match(/^([A-Za-z][A-Za-z\s&'.,-]{3,}?)\n/m)
      if (titleMatch) name = titleMatch[1].trim()
    }
    // Filter out blocked page junk
    const junkNames = ['Accessibility Links', 'Access Denied', 'Powered and protected', 'Akamai', 'Reference #']
    if (junkNames.some(j => name.includes(j))) name = ''
    if (!name) name = extractPropertyName(address || extractAddressFromUrl(loopnetUrl))

    // ── Images ──
    const imageSet = new Set<string>()
    // Find where property gallery ends — stop before contact/marketing/broker sections
    const cutoffPatterns = [
      /ASK\s+ABOUT\s+THIS/i, /Contact\s*\n/i, /Message\s+sent/i,
      /REQUEST\s+INFO/i, /Please\s+correct/i, /612-|651-|952-|763-/,
    ]
    let contentCutoff = md.length
    for (const pat of cutoffPatterns) {
      const idx = md.search(pat)
      if (idx >= 0 && idx < contentCutoff) contentCutoff = idx
    }

    const isJunkImage = (url: string, alt: string) => {
      const lurl = url.toLowerCase()
      const lalt = alt.toLowerCase()
      // Skip logos, icons, UI elements
      if (/logo|icon|avatar|sprite|MapAvatar|Favorites|SS-Desktop|Share-Desktop|DR-Desktop|Header|Modules/i.test(url)) return true
      // Skip small Showcase thumbnails (broker headshots)
      if (lurl.includes('/105/')) return true
      // Skip LoopNet notification/email screenshots
      if (lalt.includes('loopnet') || lalt.includes('new property matched')) return true
      // Skip images from email/notification domains
      if (lurl.includes('emlnk') || lurl.includes('email') || lurl.includes('newsletter') || lurl.includes('notification')) return true
      // Skip document/brochure screenshots (usually very wide or contain text markers)
      if (lalt.includes('brochure') || lalt.includes('flyer') || lalt.includes('offering memorandum')) return true
      return false
    }

    const mdImgPattern = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
    let m
    while ((m = mdImgPattern.exec(md)) !== null) {
      const alt = m[1]
      const url = m[2]
      if (m.index > contentCutoff) continue
      if (isJunkImage(url, alt)) continue
      if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.webp') || url.includes('/i2/')) {
        imageSet.add(url)
      }
    }
    // Also grab plain URLs for property images (only from property CDN paths, not marketing)
    const plainImgPatterns = [
      /https:\/\/images1\.loopnet\.com\/i2\/[^\s)"\]']+/gi,
      /https:\/\/images1\.showcase\.com\/i2\/[^\s)"\]']+/gi,
    ]
    for (const pat of plainImgPatterns) {
      while ((m = pat.exec(md)) !== null) {
        if (m.index > contentCutoff) continue
        const url = m[0]
        if (!isJunkImage(url, '')) imageSet.add(url)
      }
    }

    // Extract images from Showcase HTML (already fetched, has CDN image URLs)
    if (scrapedHtml) {
      const htmlImgPattern = /https:\/\/images1\.(loopnet|showcase)\.com\/i2\/[^"'\s<>]+/gi
      while ((m = htmlImgPattern.exec(scrapedHtml)) !== null) {
        const url = m[0].split('?')[0]
        if (!isJunkImage(url, '')) imageSet.add(url)
      }
      console.log(`[Scraper] After Showcase HTML extraction: ${imageSet.size} images`)
    }

    // Fallback: use Puppeteer to click through gallery if we still have no images
    if (imageSet.size === 0 && loopnetUrl) {
      console.log(`[Scraper] No images from markdown/HTML — trying Puppeteer gallery scrape`)
      try {
        // Try Showcase URL first (less likely to block), fall back to LoopNet
        const listingMatch = loopnetUrl.match(/\/[Ll]isting\/([^/]+)\/(\d+)/)
        const showcaseUrl = listingMatch
          ? `https://www.showcase.com/${listingMatch[1].toLowerCase()}/${listingMatch[2]}/`
          : null
        const puppeteerImages = await scrapeLoopNetImages(showcaseUrl || loopnetUrl)
        for (const img of puppeteerImages) imageSet.add(img)
        console.log(`[Scraper] Puppeteer gallery found ${puppeteerImages.length} images, total: ${imageSet.size}`)
      } catch (e: any) {
        console.log(`[Scraper] Puppeteer image scrape failed: ${e.message}`)
      }
    }

    // ── Property Type ──
    let propertyType = 'Commercial'
    // Check Property Facts table first for explicit type
    const explicitType = md.match(/Property\s+Type\s*\|\s*(\w[\w\s]*)/i)
    if (explicitType) {
      const et = explicitType[1].trim()
      if (['Industrial', 'Office', 'Retail', 'Flex', 'Mixed Use', 'Warehouse', 'Medical', 'Multifamily'].includes(et)) {
        propertyType = et
      }
    }
    const typeLabels = ['Industrial', 'Office', 'Retail', 'Flex', 'Mixed Use', 'Warehouse', 'Medical', 'Multifamily']
    if (propertyType === 'Commercial') {
      for (const t of typeLabels) {
        if (md.match(new RegExp(`Space Use[\\s\\S]{0,5}${t}`, 'i')) ||
            md.match(new RegExp(`${t}\\s+Space`, 'i')) ||
            md.match(new RegExp(`Property\\s+Type\\s*\\n+\\s*${t}`, 'i'))) {
          propertyType = t; break
        }
      }
    }

    // ── Highlights ──
    const highlights: string[] = []
    const hlSection = md.match(/###?\s*Highlights\s*\n([\s\S]*?)(?=\n###|\n\*\*Features|$)/i)
    if (hlSection) {
      const bullets = hlSection[1].match(/^-\s+(.+)/gm)
      if (bullets) {
        bullets.forEach(b => {
          const text = b.replace(/^-\s+/, '').trim()
          if (text.length > 15 && text.length < 500) highlights.push(text)
        })
      }
    }

    // ── Features ──
    const features: Record<string, string> = {}
    const featureSection = md.match(/###?\s*Features\s*\n([\s\S]*?)(?=\n###)/i)
    if (featureSection) {
      const content = featureSection[1]
      // Format: "Label\n\n\nValue" with double newlines
      const pairs = content.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
      for (let i = 0; i < pairs.length - 1; i++) {
        const label = pairs[i]
        const val = pairs[i + 1]
        if (['Clear Height', 'Drive In Bays', 'Exterior Dock Doors', 'Dock Doors',
             'Column Spacing', 'Ceiling Height', 'Parking', 'Loading'].includes(label)) {
          features[label] = val
          i++ // skip the value
        }
      }
    }
    // Fallback regex
    if (Object.keys(features).length === 0) {
      for (const label of ['Clear Height', 'Drive In Bays', 'Exterior Dock Doors', 'Dock Doors']) {
        const re = new RegExp(`${label}\\s*\\n+\\s*\\n+\\s*([^\\n]+)`, 'i')
        const match = md.match(re)
        if (match) features[label] = match[1].trim()
      }
    }

    // ── Facility Facts / Property Facts ──
    const facilityFacts: Record<string, string> = {}
    const factsSection = md.match(/(?:(?:Warehouse\s+)?Facility|Property)\s+Facts\s*\n([\s\S]*?)(?=\n###|$)/i)
    if (factsSection) {
      const content = factsSection[1]
      const factLabels = [
        'Building Size', 'Lot Size', 'Year Built/Renovated', 'Year Built', 'Year Renovated',
        'Construction', 'Sprinkler System', 'Water', 'Gas', 'Power Supply', 'Zoning',
        'Lighting', 'Sewer', 'Stories', 'Parking Ratio', 'Building Class',
        'Total Building Size', 'Total Available Space', 'Property Type', 'Property Sub-type',
        'Property Subtype', 'Building FAR', 'Tenancy', 'Building Height',
        'Gross Leasable Area', 'Rentable Building Area', 'Total Space Available',
      ]
      for (const label of factLabels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // Try multiple formats: "Label\n\nValue", "Label\nValue", "Label: Value", "| Label | Value |"
        const patterns = [
          new RegExp(`${escaped}\\s*\\n+\\s*\\n+\\s*([^\\n]+)`, 'i'),
          new RegExp(`${escaped}\\s*\\n\\s*([^\\n]+)`, 'i'),
          new RegExp(`${escaped}\\s*[:\\|]\\s*([^\\n\\|]+)`, 'i'),
          new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|\\n]+)\\s*\\|`, 'i'),
        ]
        for (const re of patterns) {
          const match = content.match(re)
          if (match && match[1].trim() && !factLabels.includes(match[1].trim())) {
            facilityFacts[label] = match[1].trim()
            break
          }
        }
      }
      console.log(`[Scraper] Facility facts found: ${JSON.stringify(facilityFacts)}`)
    } else {
      console.log(`[Scraper] No Facility Facts section found in markdown`)
    }
    // Fallback: try to find facts anywhere in the markdown if section wasn't found
    if (Object.keys(facilityFacts).length === 0) {
      const globalFactPatterns: [string, RegExp[]][] = [
        ['Building Size', [/Building\s+Size\s*[:\n|]+\s*([\d,]+\s*SF)/i, /Total\s+Building\s+Size\s*[:\n|]+\s*([\d,]+\s*SF)/i, /Gross\s+Leasable\s+Area\s*[:\n|]+\s*([\d,]+\s*SF)/i, /Rentable\s+Building\s+Area\s*[:\n|]+\s*([\d,]+\s*SF)/i]],
        ['Year Built', [/Year\s+Built(?:\/Renovated)?\s*[:\n|]+\s*(\d{4}(?:\s*\/\s*\d{4})?)/i]],
        ['Lot Size', [/Lot\s+Size\s*[:\n|]+\s*([\d,.]+\s*(?:AC|SF|Acres))/i, /Land\s+SF\s*\n\s*([\d,.]+\s*SF)/i]],
        ['Stories', [/Stories\s*[:\n|]+\s*(\d+)/i]],
        ['Zoning', [/Zoning\s*[:\n|]+\s*([^\n|]+)/i]],
        ['Building Class', [/Building\s+Class\s*[:\n|]+\s*([A-C])/i]],
        ['Parking Spaces', [/Parking\s+Spaces?\s*\n\s*(\d+)/i]],
        ['Lease Type', [/Lease\s+Type\s*\n\s*([^\n]+)/i]],
      ]
      for (const [label, patterns] of globalFactPatterns) {
        for (const re of patterns) {
          const match = md.match(re)
          if (match) { facilityFacts[label] = match[1].trim(); break }
        }
      }
    }

    // ── Total SF & Year Built from facility facts ──
    let totalSqft = facilityFacts['Building Size']?.replace(/\s*SF/, '') ||
                    facilityFacts['Total Building Size']?.replace(/\s*SF/, '') ||
                    facilityFacts['Gross Leasable Area']?.replace(/\s*SF/, '') ||
                    facilityFacts['Rentable Building Area']?.replace(/\s*SF/, '') ||
                    facilityFacts['Total Space Available']?.replace(/\s*SF/, '') || ''
    if (!totalSqft) {
      const sfPatterns = [
        /([\d,]+)\s*SF\s*of\s*Space\s*Available/i,
        /([\d,]+)\s*SF\s*(?:of\s+)?(?:total|building)/i,
        /(?:Total|Building)\s+(?:Size|SF)[:\s]*([\d,]+)\s*SF/i,
        /([\d,]+)\s*-\s*[\d,]+\s*SF/i,  // range like "489 - 78,191 SF"
      ]
      for (const re of sfPatterns) {
        const sfMatch = md.match(re)
        if (sfMatch) { totalSqft = sfMatch[1]; break }
      }
    }
    let yearBuilt = facilityFacts['Year Built/Renovated'] || facilityFacts['Year Built'] || ''
    if (!yearBuilt) {
      const ybMatch = md.match(/Year\s+Built(?:\/Renovated)?\s*[:\n|]+\s*(\d{4}(?:\s*\/\s*\d{4})?)/i)
      if (ybMatch) yearBuilt = ybMatch[1]
    }

    // ── Property Overview ──
    let overview = ''
    const ovSection = md.match(/###?\s*Property\s+Overview\s*\n([\s\S]*?)(?=\n###|$)/i)
    if (ovSection) {
      overview = ovSection[1].trim()
      if (overview.length > 2000) overview = overview.substring(0, 2000) + '...'
    }

    // ── Units / Spaces ──
    let units: any[] = []

    // Try multiple section header patterns
    const spacesSectionPatterns = [
      /All\s+Available\s+Spaces?\s*\(\d+\)([\s\S]*?)(?=###?\s*Property\s+Overview|###?\s*(?:Warehouse\s+)?Facility\s+Facts|$)/i,
      /(?:Spaces?\s+)?Available\s*\(\d+\)([\s\S]*?)(?=###?\s*Property\s+Overview|###?\s*(?:Warehouse\s+)?Facility\s+Facts|$)/i,
      /###?\s*(?:Available\s+)?Spaces?\s*\n([\s\S]*?)(?=###?\s*Property\s+Overview|###?\s*(?:Warehouse\s+)?Facility\s+Facts|$)/i,
      /(?:Space|Suite|Unit)\s+Name[\s|]+([\s\S]*?)(?=###?\s*Property\s+Overview|###?\s*(?:Warehouse\s+)?Facility\s+Facts|$)/i,
    ]

    let spacesText = ''
    for (const re of spacesSectionPatterns) {
      const match = md.match(re)
      if (match) {
        spacesText = match[1]
        console.log(`[Scraper] Spaces section found with pattern: ${re.source.substring(0, 40)}...`)
        break
      }
    }

    if (!spacesText) {
      console.log(`[Scraper] No spaces section found. Looking for inline unit data...`)
    }

    if (spacesText) {
      // ── Method 1: Pipe table format ──
      // | Space | SF | Rate | Type | ... |
      const tableRows = spacesText.match(/^\|.+\|$/gm)
      if (tableRows && tableRows.length > 1) {
        console.log(`[Scraper] Found ${tableRows.length} table rows`)
        // Find header row to determine column indices
        const headerRow = tableRows[0]
        const headers = headerRow.split('|').map(h => h.trim().toLowerCase()).filter(Boolean)
        const nameIdx = headers.findIndex(h => h.match(/space|suite|unit|name|floor|level/i))
        const sqftIdx = headers.findIndex(h => h.match(/sf|sqft|size|square/i))
        const rateIdx = headers.findIndex(h => h.match(/rate|price|rent|\$/i))
        const typeIdx = headers.findIndex(h => h.match(/type|use/i))
        const termIdx = headers.findIndex(h => h.match(/term|lease/i))
        const condIdx = headers.findIndex(h => h.match(/condition|build/i))
        const availIdx = headers.findIndex(h => h.match(/avail|date/i))

        for (const row of tableRows.slice(1)) {
          // Skip separator rows like |---|---|
          if (row.match(/^\|[\s-|]+\|$/)) continue
          const cols = row.split('|').map(c => c.trim()).filter(Boolean)
          if (cols.length < 2) continue

          const unitName = (nameIdx >= 0 ? cols[nameIdx] : cols[0]) || ''
          if (!unitName || unitName.match(/^-+$/) || unitName.toLowerCase().includes('display')) continue

          units.push({
            id: Date.now().toString() + units.length,
            name: unitName,
            sqft: (sqftIdx >= 0 ? cols[sqftIdx] : '').replace(/\s*SF.*/i, '').trim(),
            price: (rateIdx >= 0 ? cols[rateIdx] : '').trim(),
            term: (termIdx >= 0 ? cols[termIdx] : '').trim(),
            type: (typeIdx >= 0 ? cols[typeIdx] : '') || propertyType,
            condition: (condIdx >= 0 ? cols[condIdx] : '').trim(),
            available: (availIdx >= 0 ? cols[availIdx] : '') || 'Now',
            status: 'Available',
          })
        }
      }

      // ── Method 2: Bullet-list format ──
      if (units.length === 0) {
        const unitBlocks: string[] = []
        const lines = spacesText.split('\n')
        let currentBlock = ''

        // More relaxed unit name detection
        const isUnitNameLine = (line: string) => {
          if (!line.startsWith('- ')) return false
          const rest = line.substring(2).trim()
          // Definitely NOT a unit name:
          if (rest.match(/^[\d,]+\s*SF/i)) return false
          if (rest.match(/^\$/)) return false
          if (rest.match(/^\d+-\d+\s+Year/i)) return false
          if (rest.match(/^(?:Industrial|Office|Retail|Flex|Full|Shell|Now|Immediate|Negotiable|Rate\s+includes)/i)) return false
          if (rest.match(/^\[/)) return false
          // Likely a unit name if it has letters and any of these:
          if (rest.match(/[A-Za-z]/) && (
            rest.match(/(?:Level|Floor|Suite|Space|Unit|Building|Wing|Ground|Basement|Mezz|Penthouse|Lobby)/i) ||
            rest.match(/^(?:1st|2nd|3rd|\d+th|[A-Z])\s/i) ||
            rest.match(/^[A-Za-z]+\s+[-–]\s+/) ||  // "Name - 123"
            rest.match(/^[A-Za-z]+\s+\d/) ||  // "Floor 1" or "Suite 200"
            rest.match(/^#?\d+[A-Za-z]/) ||  // "101A" or "#3B"
            rest.match(/^[A-Z][a-z]+\s+[A-Z]/)  // "Lower Level"
          )) return true
          // If we have no units yet and this line has letters, it's probably a unit name
          if (unitBlocks.length === 0 && currentBlock === '' && rest.match(/^[A-Za-z]/)) return true
          return false
        }

        for (const line of lines) {
          const trimmed = line.trim()
          if (isUnitNameLine(trimmed)) {
            if (currentBlock) unitBlocks.push(currentBlock)
            currentBlock = trimmed + '\n'
          } else {
            currentBlock += trimmed + '\n'
          }
        }
        if (currentBlock) unitBlocks.push(currentBlock)

        for (const block of unitBlocks) {
          const blockLines = block.split('\n').map(l => l.trim()).filter(Boolean)
          if (blockLines.length < 2) continue

          const unitName = blockLines[0].replace(/^-\s+/, '').trim()
          if (!unitName || unitName.length > 100) continue
          if (unitName.toLowerCase().includes('display') || unitName.toLowerCase().includes('rental rate')) continue

          let sqft = '', term = '', rate = '', use = '', condition = '', available = ''

          for (const bl of blockLines.slice(1)) {
            const clean = bl.replace(/^-\s+/, '').trim()
            if (clean.match(/^\d+-\d+\s+Year/i) || clean.match(/^Negotiable/i)) {
              term = clean
            } else if (clean.match(/^[\d,]+\s*(?:-\s*[\d,]+\s*)?SF/i)) {
              sqft = clean.replace(/\s*SF.*/i, '').trim()
            } else if (clean.match(/^\$[\d,.]+/)) {
              rate = clean
            } else if (clean.match(/^(?:Industrial|Office|Retail|Flex|Medical|Warehouse|Mixed)/i)) {
              use = clean
            } else if (clean.match(/^(?:Full|Shell|Partial|Vanilla|Build|Turnkey)/i)) {
              condition = clean
            } else if (clean.match(/^(?:Now|Immediate|Within|\d+\/|\w+\s+\d{1,2},?\s+\d{4}|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr)/i)) {
              available = clean
            }
          }

          units.push({
            id: Date.now().toString() + units.length,
            name: unitName,
            sqft,
            price: rate,
            term,
            type: use || propertyType,
            condition,
            available: available || 'Now',
            status: 'Available',
          })
        }
      }

      // ── Method 3: Repeated pattern blocks (## or ### per unit) ──
      if (units.length === 0) {
        const unitHeaders = spacesText.match(/^#{2,4}\s+(.+)/gm)
        if (unitHeaders && unitHeaders.length > 0) {
          console.log(`[Scraper] Trying header-based unit parsing (${unitHeaders.length} headers)`)
          const headerSections = spacesText.split(/^#{2,4}\s+/m).slice(1)
          for (let i = 0; i < headerSections.length; i++) {
            const section = headerSections[i]
            const nameMatch = section.match(/^(.+?)[\n]/)
            if (!nameMatch) continue
            const unitName = nameMatch[1].trim()
            if (!unitName || unitName.length > 100) continue

            const sqftMatch = section.match(/([\d,]+(?:\s*-\s*[\d,]+)?)\s*SF/i)
            const rateMatch = section.match(/\$[\d,.]+\s*(?:\/SF)?/i)
            const typeMatch = section.match(/(?:Industrial|Office|Retail|Flex|Medical|Warehouse|Mixed)\s*(?:Space)?/i)

            units.push({
              id: Date.now().toString() + units.length,
              name: unitName,
              sqft: sqftMatch ? sqftMatch[1].trim() : '',
              price: rateMatch ? rateMatch[0].trim() : '',
              term: '',
              type: typeMatch ? typeMatch[0].trim() : propertyType,
              condition: '',
              available: 'Now',
              status: 'Available',
            })
          }
        }
      }
    }

    // ── Fallback: parse units from plain text (Puppeteer innerText) ──
    // Matches lines like: "1st Floor, Ste A120 (785)\t2,700 SF\tNegotiable\tUpon Request\tTBD"
    // or: "1st Floor, Ste A120 (785)  2,700 SF  Negotiable  Upon Request"
    if (units.length === 0) {
      // Look for "Space Availability" or "Space\tSize\tTerm" header
      const spaceAvailMatch = md.match(/Space\s+Availability\s*\(\d+\)([\s\S]*?)(?=Property\s+Overview|Facility\s+Facts|Property\s+Facts|Highlights|$)/i)
        || md.match(/Space\s+Size\s+Term\s+Rental\s+Rate([\s\S]*?)(?=Space\s+Use|Property\s+Overview|Facility\s+Facts|Property\s+Facts|Highlights|$)/i)
      if (spaceAvailMatch) {
        const section = spaceAvailMatch[1]
        // Match lines with SF values
        const unitLines = section.match(/^.+\d[\d,]*\s*SF.+$/gm)
        if (unitLines) {
          for (const line of unitLines) {
            // Split by tabs or 2+ spaces
            const parts = line.split(/\t|  +/).map(s => s.trim()).filter(Boolean)
            if (parts.length < 2) continue
            const unitName = parts[0]
            if (unitName.match(/^(Space|Size|Term|Rental|Rent\s+Type|---|Display)/i)) continue
            const sqftPart = parts.find(p => p.match(/[\d,]+\s*SF/i))
            const ratePart = parts.find(p => p.match(/\$[\d,.]+|Upon\s+Request|Negotiable/i))
            const termPart = parts.find(p => p.match(/Negotiable|\d+-?\d*\s*Year/i))
            units.push({
              id: Date.now().toString() + units.length,
              name: unitName,
              sqft: sqftPart ? sqftPart.replace(/\s*SF.*/i, '').trim() : '',
              price: ratePart || '',
              term: termPart || '',
              type: propertyType,
              condition: '',
              available: 'Now',
              status: 'Available',
            })
          }
        }
      }
    }

    // ── Fallback: Showcase.com key-value format ──
    // SPACE AVAILABLE\n750-3,000 SF\n# OF SPACES\n1\nRENT RATE (MO)\n$0.50...\nRENT RATE (YR)\n$6.00...
    if (units.length === 0) {
      const scSpaceMatch = md.match(/SPACE\s+AVAILABLE\s*\n\s*([\d,]+-?[\d,]*\s*SF)/i)
      const scRateYr = md.match(/RENT\s+RATE\s*\(YR\)\s*\n\s*(\$[\d,.]+[^\n]*)/i)
      const scRateMo = md.match(/RENT\s+RATE\s*\(MO\)\s*\n\s*(\$[\d,.]+[^\n]*)/i)
      const scLeaseType = md.match(/LEASE\s+TYPE\s*\n\s*([^\n]+)/i)
      const scLeaseLen = md.match(/LEASE\s+LENGTH\s*\n\s*([^\n]+)/i)
      if (scSpaceMatch) {
        const addr = extractAddressFromUrl(loopnetUrl)
        units.push({
          id: Date.now().toString() + '0',
          name: addr.split(',')[0] || 'Available Space',
          sqft: scSpaceMatch[1].replace(/\s*SF.*/i, '').trim(),
          price: scRateYr ? scRateYr[1].trim() : (scRateMo ? scRateMo[1].trim() : ''),
          term: scLeaseLen ? scLeaseLen[1].trim() : '',
          type: propertyType,
          condition: '',
          available: 'Now',
          status: 'Available',
        })
      }
    }

    // ── Fallback: extract SF from page text like "2,700 SF of Retail Space" ──
    if (!totalSqft) {
      const sfTextMatch = md.match(/([\d,]+)\s*SF\s+of\s+\w+\s+Space/i)
      if (sfTextMatch) totalSqft = sfTextMatch[1]
    }

    console.log(`[Scraper] Parsed ${units.length} units`)

    // Use Browser Use (real browser) to get images and better unit data
    // If we started it in parallel, await that. Otherwise start now.
    if (loopnetUrl) {
      if (!browserUsePromise) {
        browserUsePromise = extractWithBrowserUse(loopnetUrl, streamLiveUrl)
      }
      console.log(`[Scraper] Waiting for Browser Use results...`)
      const buResult = await browserUsePromise
      if (buResult) {
        // Merge images
        for (const img of buResult.images) imageSet.add(img)
        console.log(`[Scraper] After Browser Use: ${imageSet.size} total images`)
        // Use Browser Use units if they have better data (condition, pricing, etc.)
        if (buResult.units.length > 0) {
          const buUnits = buResult.units.map((u, i) => ({
            id: Date.now().toString() + i,
            name: u.name || 'Available Space',
            sqft: u.sqft.replace(/\s*SF.*/i, '').trim(),
            price: u.price || '',
            term: u.term || '',
            type: u.type || propertyType,
            condition: u.condition || '',
            available: u.available || 'Now',
            status: 'Available',
          }))
          // Replace scraped units if Browser Use got more detail
          if (units.length === 0 || buUnits.some(u => u.condition && u.condition !== '—')) {
            units = buUnits
            console.log(`[Scraper] Using Browser Use units: ${units.length}`)
          }
        }
      }
    }

    // Deduplicate images that are the same photo at different resolutions
    // CDN URLs look like: images1.loopnet.com/i2/<hash>/<size>/image.jpg
    // Keep only the highest resolution version of each unique image
    const deduped = new Map<string, string>() // imageKey -> best URL
    for (const url of Array.from(imageSet)) {
      // Extract a key that identifies the unique image (hash + filename, ignoring size)
      const cdnMatch = url.match(/\/i2\/([^/]+)\/(\d+)\/(.+)$/)
      if (cdnMatch) {
        const key = `${cdnMatch[1]}/${cdnMatch[3]}` // hash/filename
        const size = parseInt(cdnMatch[2], 10)
        const existing = deduped.get(key)
        if (existing) {
          const existingSize = parseInt(existing.match(/\/i2\/[^/]+\/(\d+)\//)?.[1] || '0', 10)
          if (size > existingSize) deduped.set(key, url)
        } else {
          deduped.set(key, url)
        }
      } else {
        // Non-CDN image, keep as-is
        deduped.set(url, url)
      }
    }
    const images = Array.from(deduped.values()).slice(0, 30)

    console.log(`[Scraper] Result: ${name}`)
    console.log(`  Images: ${images.length}, Units: ${units.length}, Highlights: ${highlights.length}`)
    console.log(`  Features: ${Object.keys(features).length}, Facts: ${Object.keys(facilityFacts).length}`)
    console.log(`  Overview: ${overview.length} chars`)

    return {
      id: Date.now().toString(),
      address: address || extractAddressFromUrl(loopnetUrl),
      name: name || extractPropertyName(address || ''),
      type: propertyType,
      totalSqft,
      yearBuilt,
      images,
      units,
      highlights,
      features,
      facilityFacts,
      overview,
      source: 'loopnet',
      loopnetUrl,
      message: `Found on LoopNet! ${images.length} images, ${units.length} spaces, ${Object.keys(facilityFacts).length} facility facts.`,
    }
  }

export async function POST(req: NextRequest) {
  // Wrap the scrape in a streaming response so we can send the Browser Use live_url early
  const { address, loopnetUrl: directUrl } = await req.json()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(new TextEncoder().encode(`event:${event}\ndata:${JSON.stringify(data)}\n\n`))
      }

      const streamLiveUrl = (url: string) => send('liveUrl', { liveUrl: url })

      try {
        const result = await doScrape(address, directUrl, streamLiveUrl)
        send('result', result)
      } catch (error: any) {
        console.error('[Scraper] Error:', error.message)
        send('error', { error: 'Scrape failed: ' + error.message })
      }
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

function extractPropertyName(address: string): string {
  return address.split(',')[0]?.trim() || address
}

function extractAddressFromUrl(url: string): string {
  try {
    const match = url.match(/\/[Ll]isting\/([^/]+)/)
    if (match) {
      // "1912-NE-Broadway-St-Minneapolis-MN" → "1912 NE Broadway St, Minneapolis, MN"
      const parts = match[1].split('-')
      // Find state abbreviation (last part, 2 letters)
      const stateIdx = parts.findIndex((p, i) => i > 2 && p.length === 2 && p.match(/^[A-Z]{2}$/))
      if (stateIdx > 0) {
        const street = parts.slice(0, stateIdx - 1).join(' ')
        const city = parts[stateIdx - 1]
        const state = parts[stateIdx]
        return `${street}, ${city}, ${state}`
      }
      return parts.join(' ')
    }
  } catch {}
  return url
}
