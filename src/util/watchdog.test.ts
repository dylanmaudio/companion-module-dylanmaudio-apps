import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamWatchdog } from './watchdog.js'

describe('StreamWatchdog', () => {
	let probes: number
	let dead: number
	let answer: () => Promise<boolean>

	const make = (idleMs = 15_000) =>
		new StreamWatchdog({
			idleMs,
			tickMs: 1000,
			probe: async () => {
				probes++
				return answer()
			},
			onDead: () => dead++,
		})

	beforeEach(() => {
		vi.useFakeTimers()
		probes = 0
		dead = 0
		answer = async () => true
	})
	afterEach(() => vi.useRealTimers())

	it('never asks while bytes keep arriving — a server with keepalives is left alone', async () => {
		const w = make()
		w.start()
		for (let i = 0; i < 12; i++) {
			await vi.advanceTimersByTimeAsync(10_000)
			w.feed()
		}
		expect(probes).toBe(0)
		w.stop()
	})

	it('asks once the stream has been quiet for idleMs; an answer keeps the stream', async () => {
		const w = make()
		w.start()
		await vi.advanceTimersByTimeAsync(14_000)
		expect(probes).toBe(0)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(probes).toBe(1)
		// answered: quiet again for a full idleMs before the next question
		await vi.advanceTimersByTimeAsync(14_000)
		expect(probes).toBe(1)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(probes).toBe(2)
		expect(dead).toBe(0)
		w.stop()
	})

	it('no answer ends the stream, once', async () => {
		answer = async () => {
			throw new Error('no answer')
		}
		const w = make()
		w.start()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(probes).toBe(1)
		expect(dead).toBe(1)
	})

	it('a failed request elsewhere (a lost press) asks on the next tick', async () => {
		answer = async () => false
		const w = make()
		w.start()
		await vi.advanceTimersByTimeAsync(2_000)
		w.suspect()
		await vi.advanceTimersByTimeAsync(1_000)
		expect(probes).toBe(1)
		expect(dead).toBe(1)
	})

	it('stopped while asking: the answer is ignored', async () => {
		let settle: (v: boolean) => void = () => undefined
		answer = async () => new Promise<boolean>((r) => (settle = r))
		const w = make()
		w.start()
		await vi.advanceTimersByTimeAsync(15_000)
		expect(probes).toBe(1)
		w.stop()
		settle(false)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(dead).toBe(0)
	})
})
