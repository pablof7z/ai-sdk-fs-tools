/**
 * Read tracker for concurrency protection.
 * Tracks file mtimes per-agent to detect modifications by other agents.
 * 
 * Key design:
 * - Each agent has its own view of file state (agentId + path)
 * - After read: track the mtime
 * - After write: UPDATE mtime to new value (same agent can keep editing)
 * - Other agents fail because their tracked mtime doesn't match current file
 */

interface TrackedRead {
    mtime: number; // milliseconds since epoch
    trackedAt: number; // when we recorded this
}

// Key: "agentId:path" -> TrackedRead
const readTracker = new Map<string, TrackedRead>();

function makeKey(agentId: string, path: string): string {
    return `${agentId}:${path}`;
}

/**
 * Record that a file was read/written with its current mtime.
 */
export function trackRead(agentId: string, path: string, mtime: Date | number): void {
    const mtimeMs = typeof mtime === "number" ? mtime : mtime.getTime();
    readTracker.set(makeKey(agentId, path), {
        mtime: mtimeMs,
        trackedAt: Date.now(),
    });
}

/**
 * Get the tracked mtime for a file for a specific agent.
 */
export function getTrackedMtime(agentId: string, path: string): number | undefined {
    return readTracker.get(makeKey(agentId, path))?.mtime;
}

/**
 * Check if a file has been read by a specific agent.
 */
export function hasBeenRead(agentId: string, path: string): boolean {
    return readTracker.has(makeKey(agentId, path));
}

/**
 * Update tracking after successful write (same agent can keep editing).
 */
export function updateTracking(agentId: string, path: string, newMtime: Date | number): void {
    trackRead(agentId, path, newMtime);
}

/**
 * Clean up stale tracker entries older than maxAge.
 */
export function cleanupReadTracker(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [key, entry] of readTracker) {
        if (entry.trackedAt < cutoff) {
            readTracker.delete(key);
            removed++;
        }
    }

    return removed;
}

/**
 * Get the number of tracked entries (for testing/debugging).
 */
export function getTrackerSize(): number {
    return readTracker.size;
}

/**
 * Clear all tracking (for testing).
 */
export function clearAllTracking(): void {
    readTracker.clear();
}
