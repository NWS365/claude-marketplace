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
} as const;

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, Entry>();
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get<T>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** Return the cached value for `key`, or run `fn`, cache its result, and return it. */
  async getOrFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }
}
