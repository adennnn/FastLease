import { NextRequest } from 'next/server'
import { getImage } from '../../../store'

export async function GET(_req: NextRequest, { params }: { params: { token: string; file: string } }) {
  const entry = getImage(params.token, params.file)
  if (!entry) return new Response('not found or expired', { status: 404 })
  return new Response(entry.buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': entry.contentType,
      'Content-Length': entry.buffer.length.toString(),
      'Cache-Control': 'no-store',
    },
  })
}
