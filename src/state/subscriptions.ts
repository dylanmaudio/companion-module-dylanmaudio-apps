/**
 * SubscriptionRegistry — which placed feedbacks depend on which state paths.
 *
 * Companion's 2.x API has no feedback `subscribe` hook; the callback *is*
 * the subscription (it runs with the feedback's id whenever Companion
 * evaluates it) and `unsubscribe` tells us it went away. So every feedback
 * callback calls `touch(feedbackId, paths)` and every unsubscribe calls
 * `remove(feedbackId)`. The registry then answers two questions:
 *
 *   - which feedback ids to re-check when these paths changed
 *     (`checkFeedbacksById()` on exactly those, never `checkAllFeedbacks()`)
 *   - which paths anybody is looking at at all (drives background polling)
 */

export class SubscriptionRegistry {
	private readonly byFeedback = new Map<string, Set<string>>()
	private readonly byPath = new Map<string, Set<string>>()
	private generation = 0

	/**
	 * Record that feedback `id` currently depends on `paths` (replaces its
	 * previous set). True when that set actually changed: a newly placed
	 * feedback, one whose options were edited, or any of them after a
	 * reconnect, which clears the registry. That is the moment — and the only
	 * moment — to prime the value behind a path with a Get.
	 */
	touch(id: string, paths: Iterable<string>): boolean {
		const next = new Set(paths)
		const prev = this.byFeedback.get(id)
		if (prev) {
			let same = prev.size === next.size
			if (same)
				for (const p of next)
					if (!prev.has(p)) {
						same = false
						break
					}
			if (same) return false
			for (const p of prev) this.unlink(p, id)
		}
		this.byFeedback.set(id, next)
		for (const p of next) {
			let set = this.byPath.get(p)
			if (!set) this.byPath.set(p, (set = new Set()))
			set.add(id)
		}
		this.generation++
		return true
	}

	remove(id: string): void {
		const prev = this.byFeedback.get(id)
		if (!prev) return
		for (const p of prev) this.unlink(p, id)
		this.byFeedback.delete(id)
		this.generation++
	}

	clear(): void {
		this.byFeedback.clear()
		this.byPath.clear()
		this.generation++
	}

	private unlink(path: string, id: string): void {
		const set = this.byPath.get(path)
		if (!set) return
		set.delete(id)
		if (set.size === 0) this.byPath.delete(path)
	}

	/** Feedback ids that watch any of `paths`. */
	feedbacksFor(paths: Iterable<string>): string[] {
		const out = new Set<string>()
		for (const p of paths) {
			const set = this.byPath.get(p)
			if (set) for (const id of set) out.add(id)
		}
		return [...out]
	}

	/** Every path some feedback watches. */
	watchedPaths(): string[] {
		return [...this.byPath.keys()]
	}

	isWatched(path: string): boolean {
		return this.byPath.has(path)
	}

	/** Changes whenever the watched set changes — lets a poller rebuild its rota lazily. */
	get version(): number {
		return this.generation
	}

	get size(): number {
		return this.byFeedback.size
	}
}
