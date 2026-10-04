/**
 * Addresses and network failures, said the same way by both APIs' clients:
 * the MIDI Bridge's Client API and each app's `/ctl/v1/` endpoint.
 *
 * Today every app listens on its own Mac only, so the address is usually
 * 127.0.0.1. It can also be another machine: a tunnel's far end now, and
 * the apps' own LAN access later (#106). Messages say "this Mac" only when
 * the address is this machine.
 */

/** `host:port`, with an IPv6 literal in brackets. */
export function hostPort(host: string, port: number): string {
	return `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`
}

/** `http://host:port`, with an IPv6 literal in brackets. */
export function httpOrigin(host: string, port: number): string {
	return `http://${hostPort(host, port)}`
}

/** True when the address is this machine. */
export function isLoopback(host: string): boolean {
	const h = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
	return h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

/**
 * Why a request failed, in a few words. fetch() itself only says "fetch
 * failed"; the socket error under it says what an operator can act on.
 */
export function netReason(e: unknown): string {
	const err = e as { name?: unknown; message?: unknown; cause?: { code?: unknown } } | null
	if (err?.name === 'TimeoutError') return 'no answer'
	switch (err?.cause?.code) {
		case 'ECONNREFUSED':
			return 'connection refused'
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
		case 'EHOSTDOWN':
			return 'unreachable'
		case 'ENOTFOUND':
		case 'EAI_AGAIN':
			return 'address not found'
		case 'ECONNRESET':
		case 'UND_ERR_SOCKET':
			return 'connection dropped'
	}
	return typeof err?.message === 'string' ? err.message : String(e)
}
