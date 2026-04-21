/**
 * Reusable SSE (Server-Sent Events) response builder.
 *
 * Wraps a ReadableStream with a `send(event, data)` helper and returns
 * a standard Response with the correct headers. The `send` function
 * silently swallows errors when the client disconnects so server-side
 * work can continue without throwing.
 */

export interface SSESender {
  send: (event: string, data: any) => void
  close: () => void
  /** True while the stream is still writable. */
  readonly open: boolean
}

export function createSSEStream(
  handler: (sse: SSESender) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      let streamOpen = true

      const sse: SSESender = {
        send(event: string, data: any) {
          if (!streamOpen) return
          try {
            controller.enqueue(
              new TextEncoder().encode(
                `event:${event}\ndata:${JSON.stringify(data)}\n\n`,
              ),
            )
          } catch {
            streamOpen = false
          }
        },
        close() {
          if (!streamOpen) return
          streamOpen = false
          try { controller.close() } catch {}
        },
        get open() {
          return streamOpen
        },
      }

      try {
        await handler(sse)
      } finally {
        sse.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
