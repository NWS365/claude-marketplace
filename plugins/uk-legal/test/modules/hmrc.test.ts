import { describe, it, expect, vi, afterEach } from "vitest";
import { registerHmrc } from "../../src/modules/hmrc/index.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";
import {
  lookupVat,
  isoDateOrNull,
  parseMtdStatus,
  parseGuidanceResults,
  EFFECTIVE_DATE,
} from "../../src/modules/hmrc/parsers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// A fake fetch Response for the OAuth token endpoint.
function tokenResp(over: Partial<{ ok: boolean; status: number; body: unknown }> = {}) {
  const { ok = true, status = 200, body = { access_token: "tok-123" } } = over;
  return { ok, status, json: async () => body } as any;
}

// --------------------------------------------------------------------- parsers
describe("hmrc/parsers lookupVat", () => {
  it("matches a table key via key.includes(k) (first hit wins, shadowing later rows)", () => {
    const r = lookupVat("food");
    expect(r).toMatchObject({ commodity_code: "food", rate: "zero", rate_percentage: 0, effective_from: EFFECTIVE_DATE });
    expect(r.notes).toMatch(/basic foods/);
    // "hot food" contains "food", so the earlier "food" row shadows it.
    expect(lookupVat("hot food").rate).toBe("zero");
  });

  it("reaches a later row when the earlier shorter key does not match", () => {
    // "hot" does not match "food" (neither contains the other) but matches "hot food".
    expect(lookupVat("hot").rate).toBe("standard");
    expect(lookupVat("hot").notes).toMatch(/immediate consumption/);
  });

  it("matches via k.includes(key) when input is a substring of a table key", () => {
    // "med" is a substring of "medicine"; no earlier row matches "med".
    const r = lookupVat("med");
    expect(r.rate).toBe("zero");
    expect(r.notes).toMatch(/medicines/);
  });

  it("trims and lower-cases the input", () => {
    const r = lookupVat("  SOFTWARE  ");
    expect(r.commodity_code).toBe("SOFTWARE");
    expect(r.rate).toBe("standard");
  });

  it("covers exempt and reduced categories", () => {
    expect(lookupVat("financial services").rate).toBe("exempt");
    expect(lookupVat("domestic fuel").rate).toBe("reduced");
    expect(lookupVat("domestic fuel").rate_percentage).toBe(5);
  });

  it("falls back to standard 20% with the original input embedded on no match", () => {
    const r = lookupVat("  quantum widget xyz  ");
    expect(r).toMatchObject({ commodity_code: "quantum widget xyz", rate: "standard", rate_percentage: 20 });
    // notes embed the ORIGINAL (untrimmed) argument, per the port comment.
    expect(r.notes).toMatch(/No specific exemption found for '  quantum widget xyz  '/);
    expect(r.notes).toMatch(/gov\.uk/);
  });
});

describe("hmrc/parsers isoDateOrNull", () => {
  it("returns null for falsy / nullish input", () => {
    expect(isoDateOrNull(null)).toBeNull();
    expect(isoDateOrNull(undefined)).toBeNull();
    expect(isoDateOrNull("")).toBeNull();
  });

  it("returns the YYYY-MM-DD prefix for a real date", () => {
    expect(isoDateOrNull("2024-01-15T09:30:00Z")).toBe("2024-01-15");
    expect(isoDateOrNull("2020-05-01")).toBe("2020-05-01");
  });

  it("returns null when the first 10 chars are not date-shaped", () => {
    expect(isoDateOrNull("not-a-date")).toBeNull();
    expect(isoDateOrNull("2024/01/15")).toBeNull();
  });

  it("returns null for a well-formed but non-calendar date (rollover)", () => {
    expect(isoDateOrNull("2024-13-45")).toBeNull();
    expect(isoDateOrNull("2024-02-30")).toBeNull();
  });
});

describe("hmrc/parsers parseMtdStatus", () => {
  it("treats a null body as no obligations", () => {
    expect(parseMtdStatus("123456789", null)).toEqual({
      vrn: "123456789",
      mandated: false,
      effective_date: null,
      trading_name: null,
    });
  });

  it("sets mandated + effective_date from the first obligation and trading name", () => {
    const out = parseMtdStatus("123456789", {
      obligations: [{ start: "2023-04-01" }, { start: "2023-07-01" }],
      tradingName: "Acme Ltd",
    });
    expect(out).toEqual({
      vrn: "123456789",
      mandated: true,
      effective_date: "2023-04-01",
      trading_name: "Acme Ltd",
    });
  });

  it("mandated but null effective_date when the first obligation lacks a start", () => {
    const out = parseMtdStatus("123456789", { obligations: [{}] });
    expect(out.mandated).toBe(true);
    expect(out.effective_date).toBeNull();
    expect(out.trading_name).toBeNull();
  });

  it("ignores a non-array obligations field", () => {
    const out = parseMtdStatus("123456789", { obligations: "nope" });
    expect(out.mandated).toBe(false);
    expect(out.effective_date).toBeNull();
  });

  it("handles a null first obligation entry", () => {
    const out = parseMtdStatus("123456789", { obligations: [null] });
    expect(out.mandated).toBe(true);
    expect(out.effective_date).toBeNull();
  });
});

describe("hmrc/parsers parseGuidanceResults", () => {
  it("returns an empty result set for a null body", () => {
    expect(parseGuidanceResults("vat", null)).toEqual({ query: "vat", total: 0, results: [] });
  });

  it("shapes each result, prefixing gov.uk and normalising the timestamp", () => {
    const out = parseGuidanceResults("vat", {
      results: [
        { title: "VAT rates", link: "/guidance/vat-rates", description: "About VAT", public_timestamp: "2024-03-02T00:00:00Z" },
      ],
    });
    expect(out).toEqual({
      query: "vat",
      total: 1,
      results: [
        { title: "VAT rates", url: "https://www.gov.uk/guidance/vat-rates", summary: "About VAT", updated: "2024-03-02" },
      ],
    });
  });

  it("applies defaults for missing fields and a null entry", () => {
    const out = parseGuidanceResults("vat", { results: [{}, null] });
    expect(out.total).toBe(2);
    for (const r of out.results) {
      expect(r).toEqual({ title: "Unknown", url: "https://www.gov.uk", summary: null, updated: null });
    }
  });

  it("ignores a non-array results field", () => {
    const out = parseGuidanceResults("vat", { results: 42 });
    expect(out).toEqual({ query: "vat", total: 0, results: [] });
  });
});

// -------------------------------------------------------------- hmrc_get_vat_rate
describe("hmrc_get_vat_rate", () => {
  it("returns the looked-up VAT rate (happy path, no network)", async () => {
    const reg = registerModule(registerHmrc);
    const out = resultJson(await callTool(reg, "hmrc_get_vat_rate", { commodity_code: "software" }));
    expect(out).toMatchObject({ commodity_code: "software", rate: "standard", rate_percentage: 20 });
  });

  it("returns the standard-rate fallback for an unknown commodity", async () => {
    const reg = registerModule(registerHmrc);
    const out = resultJson(await callTool(reg, "hmrc_get_vat_rate", { commodity_code: "flux capacitor" }));
    expect(out.rate).toBe("standard");
    expect(out.notes).toMatch(/No specific exemption/);
  });

  it("wraps an unexpected exception as a structured tool error", async () => {
    // Call the handler directly (bypassing the harness's schema parse) with a
    // non-string arg so lookupVat's .trim() throws — exercising the catch branch.
    const reg = registerModule(registerHmrc);
    const handler = reg.tools.get("hmrc_get_vat_rate")!.handler;
    const r = await handler({ commodity_code: 12345 as any });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false });
  });
});

// ---------------------------------------------------------- hmrc_check_mtd_status
describe("hmrc_check_mtd_status", () => {
  it("returns a configuration error when OAuth credentials are unset", async () => {
    // Force-unset via empty strings so ambient env cannot leak in.
    vi.stubEnv("HMRC_CLIENT_ID", "");
    vi.stubEnv("HMRC_CLIENT_SECRET", "");
    const reg = registerModule(registerHmrc);
    const r = await callTool(reg, "hmrc_check_mtd_status", { vrn: "123456789" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({
      error_category: "configuration",
      is_retryable: false,
      attempted: "hmrc_check_mtd_status",
    });
    expect(resultJson(r).description).toMatch(/HMRC_CLIENT_ID/);
  });

  it("fetches a token then obligations and returns MTD status (sandbox default base)", async () => {
    vi.stubEnv("HMRC_CLIENT_ID", "cid");
    vi.stubEnv("HMRC_CLIENT_SECRET", "secret");
    // Ensure no ambient production base leaks.
    vi.stubEnv("HMRC_API_BASE", "");
    const fetchMock = vi.fn(async () => tokenResp());
    vi.stubGlobal("fetch", fetchMock);

    const jsonGet = vi.fn(async () =>
      fetched(JSON.stringify({ obligations: [{ start: "2023-04-01" }], tradingName: "Acme Ltd" }), {
        contentType: "application/json",
      })
    );
    const reg = registerModule(registerHmrc, { jsonGet });

    const out = resultJson(await callTool(reg, "hmrc_check_mtd_status", { vrn: "123456789" }));
    expect(out).toEqual({
      vrn: "123456789",
      mandated: true,
      effective_date: "2023-04-01",
      trading_name: "Acme Ltd",
    });

    // Token request hit the sandbox default base.
    const tokenUrl = fetchMock.mock.calls[0]![0] as string;
    expect(tokenUrl).toBe("https://test-api.service.hmrc.gov.uk/oauth/token");
    // Obligations request carried the bearer token and the status=O filter.
    const [obUrl, obOpts] = jsonGet.mock.calls[0]! as [string, any];
    expect(obUrl).toBe("https://test-api.service.hmrc.gov.uk/organisations/vat/123456789/obligations?status=O");
    expect(obOpts.headers.Authorization).toBe("Bearer tok-123");
  });

  it("uses HMRC_API_BASE override and strips a GB prefix from the VRN", async () => {
    vi.stubEnv("HMRC_CLIENT_ID", "cid");
    vi.stubEnv("HMRC_CLIENT_SECRET", "secret");
    vi.stubEnv("HMRC_API_BASE", "https://api.service.hmrc.gov.uk");
    const fetchMock = vi.fn(async () => tokenResp());
    vi.stubGlobal("fetch", fetchMock);
    const jsonGet = vi.fn(async () => fetched(JSON.stringify({ obligations: [] }), { contentType: "application/json" }));
    const reg = registerModule(registerHmrc, { jsonGet });

    const out = resultJson(await callTool(reg, "hmrc_check_mtd_status", { vrn: "GB123456789" }));
    expect(out).toMatchObject({ vrn: "123456789", mandated: false, effective_date: null });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.service.hmrc.gov.uk/oauth/token");
    expect((jsonGet.mock.calls[0]! as [string, any])[0]).toBe(
      "https://api.service.hmrc.gov.uk/organisations/vat/123456789/obligations?status=O"
    );
  });

  it("surfaces a token-endpoint failure as an upstream error", async () => {
    vi.stubEnv("HMRC_CLIENT_ID", "cid");
    vi.stubEnv("HMRC_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp({ ok: false, status: 500 })));
    // jsonGet must never be reached.
    const jsonGet = vi.fn();
    const reg = registerModule(registerHmrc, { jsonGet });

    const r = await callTool(reg, "hmrc_check_mtd_status", { vrn: "123456789" });
    expect(isErr(r)).toBe(true);
    // 500 on the OAuth token → UpstreamHttpError → "unknown" (only 429/503 are transient).
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false });
    expect(jsonGet).not.toHaveBeenCalled();
  });

  it("classifies a 429 token failure as a retryable transient error", async () => {
    vi.stubEnv("HMRC_CLIENT_ID", "cid");
    vi.stubEnv("HMRC_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp({ ok: false, status: 429 })));
    const reg = registerModule(registerHmrc, { jsonGet: vi.fn() });
    const r = await callTool(reg, "hmrc_check_mtd_status", { vrn: "123456789" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });

  it("surfaces an obligations 404 as not_found", async () => {
    vi.stubEnv("HMRC_CLIENT_ID", "cid");
    vi.stubEnv("HMRC_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp()));
    const jsonGet = vi.fn(async () => fetched("not found", { status: 404, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerHmrc, { jsonGet });
    const r = await callTool(reg, "hmrc_check_mtd_status", { vrn: "123456789" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "not_found", is_retryable: false });
  });

  it("handles a token body without an access_token (bearer undefined)", async () => {
    vi.stubEnv("HMRC_CLIENT_ID", "cid");
    vi.stubEnv("HMRC_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp({ body: {} })));
    const jsonGet = vi.fn(async () => fetched(JSON.stringify({ obligations: [] }), { contentType: "application/json" }));
    const reg = registerModule(registerHmrc, { jsonGet });
    const out = resultJson(await callTool(reg, "hmrc_check_mtd_status", { vrn: "123456789" }));
    expect(out.mandated).toBe(false);
    expect((jsonGet.mock.calls[0]! as [string, any])[1].headers.Authorization).toBe("Bearer undefined");
  });
});

// --------------------------------------------------------- hmrc_search_guidance
describe("hmrc_search_guidance", () => {
  it("searches GOV.UK and shapes the results (happy path)", async () => {
    const jsonGet = vi.fn(async () =>
      fetched(
        JSON.stringify({
          results: [
            { title: "VAT guidance", link: "/vat", description: "d", public_timestamp: "2024-01-02T00:00:00Z" },
          ],
        }),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerHmrc, { jsonGet });
    const out = resultJson(await callTool(reg, "hmrc_search_guidance", { query: "vat digital", limit: 10 }));
    expect(out).toMatchObject({ query: "vat digital", total: 1 });
    expect(out.results[0]).toEqual({
      title: "VAT guidance",
      url: "https://www.gov.uk/vat",
      summary: "d",
      updated: "2024-01-02",
    });

    // The GOV.UK query string carries the HMRC org filter, fields, count and query.
    const url = (jsonGet.mock.calls[0]! as [string, any])[0] as string;
    expect(url).toContain("https://www.gov.uk/api/search.json?");
    expect(url).toContain("filter_organisations=hm-revenue-customs");
    expect(url).toContain("count=10");
    expect(url).toContain("q=vat+digital");
    expect(url).toContain("fields%5B%5D=title");
  });

  it("returns an empty result set when GOV.UK has no matches", async () => {
    const jsonGet = vi.fn(async () => fetched(JSON.stringify({ results: [] }), { contentType: "application/json" }));
    const reg = registerModule(registerHmrc, { jsonGet });
    const out = resultJson(await callTool(reg, "hmrc_search_guidance", { query: "obscure topic", limit: 5 }));
    expect(out).toEqual({ query: "obscure topic", total: 0, results: [] });
  });

  it("surfaces an upstream 500 as a structured error", async () => {
    const jsonGet = vi.fn(async () => fetched("boom", { status: 500, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerHmrc, { jsonGet });
    const r = await callTool(reg, "hmrc_search_guidance", { query: "vat rates", limit: 10 });
    expect(isErr(r)).toBe(true);
    // 500 → UpstreamHttpError → "unknown" (per toolErrorFromException).
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false, attempted: "hmrc_search_guidance(query='vat rates')" });
  });

  it("surfaces an upstream 429 as a retryable transient error", async () => {
    const jsonGet = vi.fn(async () => fetched("slow down", { status: 429, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerHmrc, { jsonGet });
    const r = await callTool(reg, "hmrc_search_guidance", { query: "vat rates", limit: 10 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});

// --------------------------------------------------------------- registration
describe("hmrc registration", () => {
  it("registers exactly the three HMRC tools and no resources/prompts", () => {
    const reg = registerModule(registerHmrc);
    expect([...reg.tools.keys()].sort()).toEqual(["hmrc_check_mtd_status", "hmrc_get_vat_rate", "hmrc_search_guidance"]);
    expect(reg.resources).toHaveLength(0);
    expect(reg.prompts.size).toBe(0);
  });
});
