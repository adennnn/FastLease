import { NextRequest, NextResponse } from 'next/server'

function extractFileId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/open\?id=([a-zA-Z0-9_-]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

function extractFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function toImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=s1600`
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing url' }, { status: 400 })
    }

    // Individual file link
    const fileId = extractFileId(url)
    if (fileId && !url.includes('/folders/')) {
      return NextResponse.json({ images: [toImageUrl(fileId)] })
    }

    // Folder link
    const folderId = extractFolderId(url)
    if (folderId) {
      const res = await fetch(`https://drive.google.com/drive/folders/${folderId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      })
      const html = await res.text()

      const fileIds = new Set<string>()

      // Pattern 1: data-id attributes
      const dataIdRegex = /data-id="([\w-]{20,})"/g
      let match
      while ((match = dataIdRegex.exec(html)) !== null) {
        fileIds.add(match[1])
      }

      // Pattern 2: JSON arrays with file IDs and image extensions
      const jsonRegex = /\["([\w-]{20,})","([^"]*\.(jpe?g|png|gif|webp|bmp|svg|heic|tiff?))"[^\]]*\]/gi
      while ((match = jsonRegex.exec(html)) !== null) {
        fileIds.add(match[1])
      }

      // Pattern 3: /file/d/ID patterns in the page
      const linkRegex = /\/file\/d\/([\w-]{20,})/g
      while ((match = linkRegex.exec(html)) !== null) {
        fileIds.add(match[1])
      }

      // Remove the folder ID itself if it got picked up
      fileIds.delete(folderId)

      if (fileIds.size === 0) {
        return NextResponse.json(
          { error: 'No images found. Make sure the folder is publicly shared.' },
          { status: 404 }
        )
      }

      const images = Array.from(fileIds).map(toImageUrl)
      return NextResponse.json({ images })
    }

    return NextResponse.json({ error: 'Could not parse Google Drive URL' }, { status: 400 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
