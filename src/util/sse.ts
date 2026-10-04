/**
 * Server-Sent Events, framed from a fetch() body.
 *
 * Both dylanmaudio APIs this module speaks stream the same way — the MIDI
 * Bridge's Client API and each app's `/ctl/v1/` control endpoint: `id:`,
 * `event:` and `data:` lines, a blank line between frames, and `:` comment
 * lines as keepalives.
 */

export interface SseFrame {
	/** the `event:` field — "message" when absent, as the SSE spec says */
	event: string
	/** every `data:` line of the frame, joined with newlines */
	data: string
	/** the `id:` field, if the frame carried one */
	id?: string
}

/** Parse the text of one frame. Null for a frame holding only comments. */
export function parseSseFrame(raw: string): SseFrame | null {
	let event = 'message'
	const data: string[] = []
	let id: string | undefined
	for (const line of raw.split('\n')) {
		if (line === '' || line.startsWith(':')) continue
		const colon = line.indexOf(':')
		const field = colon < 0 ? line : line.slice(0, colon)
		let value = colon < 0 ? '' : line.slice(colon + 1)
		if (value.startsWith(' ')) value = value.slice(1)
		if (field === 'event') event = value
		else if (field === 'data') data.push(value)
		else if (field === 'id') id = value
	}
	if (data.length === 0 && id === undefined) return null
	return { event, data: data.join('\n'), id }
}

/**
 * Yield frames as they arrive; returns when the server closes the stream.
 * `onBytes` hears every read, keepalive comments included, so a watchdog
 * can tell a quiet stream from a dead one.
 */
export async function* sseFrames(body: ReadableStream<Uint8Array>, onBytes?: () => void): AsyncGenerator<SseFrame> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buf = ''
	try {
		for (;;) {
			const { value, done } = await reader.read()
			if (done) return
			onBytes?.()
			buf += decoder.decode(value, { stream: true })
			let idx: number
			while ((idx = buf.indexOf('\n\n')) >= 0) {
				const frame = parseSseFrame(buf.slice(0, idx))
				buf = buf.slice(idx + 2)
				if (frame) yield frame
			}
		}
	} finally {
		try {
			reader.releaseLock()
		} catch {
			// already released by an abort
		}
	}
}
