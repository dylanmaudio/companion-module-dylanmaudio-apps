import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { hostPort, httpOrigin, isLoopback, netReason } from './net.js'

describe('net', () => {
	it('brackets an IPv6 literal, once', () => {
		expect(httpOrigin('127.0.0.1', 8765)).toBe('http://127.0.0.1:8765')
		expect(httpOrigin('studio-mac.local', 8765)).toBe('http://studio-mac.local:8765')
		expect(httpOrigin('::1', 8765)).toBe('http://[::1]:8765')
		expect(httpOrigin('[fe80::1]', 8770)).toBe('http://[fe80::1]:8770')
		expect(hostPort('fd00::5', 8770)).toBe('[fd00::5]:8770')
	})

	it('knows this machine from another', () => {
		for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]', ' 127.0.0.1 '])
			expect(isLoopback(h), h).toBe(true)
		for (const h of ['192.168.1.20', 'studio-mac.local', '10.0.0.1', 'fe80::1', '127.0.0.1.example.com'])
			expect(isLoopback(h), h).toBe(false)
	})

	it('says why a request failed in words an operator can act on', async () => {
		expect(netReason(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('no answer')
		const failed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
		expect(netReason(failed('ECONNREFUSED'))).toBe('connection refused')
		expect(netReason(failed('EHOSTUNREACH'))).toBe('unreachable')
		expect(netReason(failed('ENOTFOUND'))).toBe('address not found')
		expect(netReason(failed('UND_ERR_SOCKET'))).toBe('connection dropped')
		expect(netReason(new Error('stream closed'))).toBe('stream closed')
		// the real thing: a port nothing listens on
		const e = await fetch(`http://127.0.0.1:${await closedPort()}/`).catch((err: unknown) => err)
		expect(netReason(e)).toBe('connection refused')
	})
})

async function closedPort(): Promise<number> {
	const s = createServer()
	await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
	const p = (s.address() as { port: number }).port
	await new Promise<void>((r) => s.close(() => r()))
	return p
}
