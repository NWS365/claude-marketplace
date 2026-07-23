/**
 * Tiny in-memory TTL cache, keyed by fetched URL.
 *
 * Load-bearing WITHIN a single stdio session: the judgment header/index/para
 * drill-down (tools + resources) all fetch the same underlying document, and
 * without this each call re-downloads it and burns upstream rate-limit budget.
 *
 * Per-endpoint TTLs: legislation 24h, votes 24h, hmrc 90d, everything else 1h.
 */
export const TTL = {
    HOUR: 3_600_000,
    DAY: 86_400_000,
    NINETY_DAYS: 7_776_000_000,
};
export class TtlCache {
    store = new Map();
    now;
    constructor(now = () => Date.now()) {
        this.now = now;
    }
    get(key) {
        const e = this.store.get(key);
        if (!e)
            return undefined;
        if (e.expiresAt <= this.now()) {
            this.store.delete(key);
            return undefined;
        }
        return e.value;
    }
    set(key, value, ttlMs) {
        this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    }
    /** Return the cached value for `key`, or run `fn`, cache its result, and return it. */
    async getOrFetch(key, ttlMs, fn) {
        const hit = this.get(key);
        if (hit !== undefined)
            return hit;
        const value = await fn();
        this.set(key, value, ttlMs);
        return value;
    }
}
