/**
 * Shared SSE stream reader for client components.
 *
 * All three SSE consumers (WarmAccountsTab, SignInAccountsTab, dashboard page)
 * had their own copy of the buffer-splitting + event-parsing loop. This
 * utility provides a single `readSSEStream` function they all use.
 */

export interface SSEEvent {
  event: string
  data: any
}

/**
 * Read an SSE response body and call `onEvent` for each parsed event.
 * Handles buffering, line splitting, and JSON parsing.
 */
export async function readSSEStream(
  response: Response,
  onEvent: (evt: SSEEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      let event = 'message'
      let payload = ''

      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) payload = line.slice(5).trim()
      }

      if (!payload) continue

      try {
        const data = JSON.parse(payload)
        onEvent({ event, data })
      } catch {
        // Incomplete JSON chunk — skip
      }
    }
  }
}
