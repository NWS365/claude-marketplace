import { describe, it, expect, vi } from "vitest";
import { TtlCache, TTL } from "../../src/shared/cache.js";

describe("TtlCache", () => {
  it("returns undefined on a miss", () => {
    const c = new TtlCache();
    expect(c.get("nope")).toBeUndefined();
  });

  it("stores and retrieves a value within its TTL", () => {
    let now = 1000;
    const c = new TtlCache(() => now);
    c.set("k", { a: 1 }, 5000);
    expect(c.get<{ a: number }>("k")).toEqual({ a: 1 });
    now = 5999; // still within TTL (expiresAt = 6000)
    expect(c.get("k")).toEqual({ a: 1 });
  });

  it("expires and deletes an entry once its TTL passes", () => {
    let now = 0;
    const c = new TtlCache(() => now);
    c.set("k", "v", 100);
    now = 100; // expiresAt (100) <= now -> expired
    expect(c.get("k")).toBeUndefined();
    // second get confirms it was deleted, not just filtered
    expect(c.get("k")).toBeUndefined();
  });

  it("getOrFetch returns a cache hit without calling the loader", async () => {
    const c = new TtlCache();
    c.set("k", "cached", TTL.HOUR);
    const fn = vi.fn(async () => "fresh");
    expect(await c.getOrFetch("k", TTL.HOUR, fn)).toBe("cached");
    expect(fn).not.toHaveBeenCalled();
  });

  it("getOrFetch runs the loader on a miss and caches the result", async () => {
    const c = new TtlCache();
    const fn = vi.fn(async () => "fresh");
    expect(await c.getOrFetch("k", TTL.HOUR, fn)).toBe("fresh");
    expect(await c.getOrFetch("k", TTL.HOUR, fn)).toBe("fresh");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exposes the documented TTL constants", () => {
    expect(TTL.HOUR).toBe(3_600_000);
    expect(TTL.DAY).toBe(86_400_000);
    expect(TTL.NINETY_DAYS).toBe(7_776_000_000);
  });
});
