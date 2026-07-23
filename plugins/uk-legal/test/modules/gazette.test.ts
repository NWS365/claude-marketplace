import { describe, it, expect, vi } from "vitest";
import { registerGazette } from "../../src/modules/gazette/index.js";
import { parseGazetteFeed, parseGazetteNotice } from "../../src/modules/gazette/parsers.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";

// --- Fixtures ---------------------------------------------------------------

const NS = 'xmlns="http://www.w3.org/2005/Atom" xmlns:f="https://www.thegazette.co.uk/facets"';

// Two-entry feed. Entry 1 has every field plus both self and alternate links
// (alternate is preferred). Entry 2 drops notice-code and content and carries
// only a self link.
const SEARCH_FEED = `<feed ${NS}>
  <f:total>42</f:total>
  <entry>
    <id>1111</id>
    <title>ACME TRADING LTD</title>
    <published>2024-01-05T00:00:00Z</published>
    <updated>2024-01-06T00:00:00Z</updated>
    <content>Notice of a members' voluntary liquidation.</content>
    <f:notice-code>2450</f:notice-code>
    <link rel="self" href="https://www.thegazette.co.uk/notice/1111/self"/>
    <link rel="alternate" href="https://www.thegazette.co.uk/notice/1111"/>
  </entry>
  <entry>
    <id>2222</id>
    <title>BETA HOLDINGS LLP</title>
    <published>2024-02-10T00:00:00Z</published>
    <updated>2024-02-10T00:00:00Z</updated>
    <link rel="self" href="https://www.thegazette.co.uk/notice/2222"/>
  </entry>
</feed>`;

// A feed with no <f:total> and no entries.
const EMPTY_FEED = `<feed ${NS}></feed>`;

// A feed with entries but no <f:total> — total falls back to the entry count.
const FEED_NO_TOTAL = `<feed ${NS}>
  <entry><id>7</id><title>Solo</title><published>2024-03-01T00:00:00Z</published><updated>2024-03-01T00:00:00Z</updated></entry>
</feed>`;

// A single notice returned as a bare <entry> at the root, with only a
// non-alternate/non-self link (exercises the first-link fallback).
const BARE_ENTRY = `<entry ${NS}>
  <id>3333</id>
  <title>GAMMA LIMITED</title>
  <published>2024-04-04T00:00:00Z</published>
  <content>Appointment of administrators.</content>
  <f:notice-code>2401</f:notice-code>
  <link rel="related" href="https://www.thegazette.co.uk/notice/3333/related"/>
</entry>`;

// A single notice returned as a <feed> wrapping one <entry>.
const FEED_WRAPPED = `<feed ${NS}>
  <entry>
    <id>4444</id>
    <title>DELTA PLC</title>
    <published>2024-05-05T00:00:00Z</published>
    <content>Notice to creditors.</content>
    <f:notice-code>2410</f:notice-code>
  </entry>
</feed>`;

// A document with no Atom entry at all.
const NO_ENTRY = `<other ${NS}></other>`;

// --- parseGazetteFeed -------------------------------------------------------

describe("gazette/parsers — parseGazetteFeed", () => {
  it("extracts fields, notice-code, best link, and total", () => {
    const { total, results } = parseGazetteFeed(SEARCH_FEED, 10);
    expect(total).toBe(42);
    expect(results).toHaveLength(2);

    const acme = results[0]!;
    expect(acme.id).toBe("1111");
    expect(acme.title).toBe("ACME TRADING LTD");
    expect(acme.notice_code).toBe("2450");
    expect(acme.published).toBe("2024-01-05T00:00:00Z");
    expect(acme.updated).toBe("2024-01-06T00:00:00Z");
    expect(acme.summary).toBe("Notice of a members' voluntary liquidation.");
    expect(acme.url).toBe("https://www.thegazette.co.uk/notice/1111"); // alternate preferred over self
  });

  it("yields null for absent optional fields and uses the self link", () => {
    const { results } = parseGazetteFeed(SEARCH_FEED, 10);
    const beta = results[1]!;
    expect(beta.notice_code).toBeNull();
    expect(beta.summary).toBeNull();
    expect(beta.url).toBe("https://www.thegazette.co.uk/notice/2222");
  });

  it("slices results to the limit but leaves total untouched", () => {
    const { total, results } = parseGazetteFeed(SEARCH_FEED, 1);
    expect(total).toBe(42);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1111");
  });

  it("falls back to the entry count when <f:total> is absent", () => {
    const { total, results } = parseGazetteFeed(FEED_NO_TOTAL, 10);
    expect(total).toBe(1);
    expect(results).toHaveLength(1);
  });

  it("returns zero and no results for an empty feed", () => {
    const { total, results } = parseGazetteFeed(EMPTY_FEED, 10);
    expect(total).toBe(0);
    expect(results).toEqual([]);
  });

  it("returns an empty result on unparseable XML", () => {
    expect(parseGazetteFeed("<feed", 10)).toEqual({ total: 0, results: [] });
  });
});

// --- parseGazetteNotice -----------------------------------------------------

describe("gazette/parsers — parseGazetteNotice", () => {
  it("parses a bare <entry> and uses the first-link fallback", () => {
    const n = parseGazetteNotice(BARE_ENTRY)!;
    expect(n.id).toBe("3333");
    expect(n.title).toBe("GAMMA LIMITED");
    expect(n.notice_code).toBe("2401");
    expect(n.published).toBe("2024-04-04T00:00:00Z");
    expect(n.summary).toBe("Appointment of administrators.");
    expect(n.url).toBe("https://www.thegazette.co.uk/notice/3333/related");
  });

  it("parses a <feed>-wrapped entry", () => {
    const n = parseGazetteNotice(FEED_WRAPPED)!;
    expect(n.id).toBe("4444");
    expect(n.title).toBe("DELTA PLC");
    expect(n.notice_code).toBe("2410");
  });

  it("returns null when the document has no Atom entry", () => {
    expect(parseGazetteNotice(NO_ENTRY)).toBeNull();
  });

  it("returns null on unparseable XML", () => {
    expect(parseGazetteNotice("<entry")).toBeNull();
  });
});

// --- gazette_search_notices -------------------------------------------------

describe("gazette_search_notices", () => {
  it("returns parsed results and forwards all filter params", async () => {
    const xmlGet = vi.fn(async () => fetched(SEARCH_FEED));
    const reg = registerModule(registerGazette, { xmlGet });
    const out = resultJson(
      await callTool(reg, "gazette_search_notices", {
        query: "insolvency",
        edition: "London",
        notice_type: "2450+2451",
        category_code: "24",
        from_date: "2024-01-01",
        to_date: "2024-12-31",
        limit: 10,
      }),
    );
    expect(out.query).toBe("insolvency");
    expect(out.total).toBe(42);
    expect(out.results.length).toBe(2);

    const url = xmlGet.mock.calls[0]![0] as string;
    expect(url).toContain("/all-notices/notice/data.feed?");
    expect(url).toContain("text=insolvency");
    expect(url).toContain("edition=London");
    expect(url).toContain("categorycode=24");
    expect(url).toContain("start-publish-date=2024-01-01");
    expect(url).toContain("end-publish-date=2024-12-31");
    expect(url).toContain("noticetype="); // '+' is percent-encoded in the value
  });

  it("respects the limit", async () => {
    const reg = registerModule(registerGazette, { xmlGet: vi.fn(async () => fetched(SEARCH_FEED)) });
    const out = resultJson(await callTool(reg, "gazette_search_notices", { query: "x", limit: 1 }));
    expect(out.results.length).toBe(1);
    expect(out.total).toBe(42);
  });

  it("surfaces a transient upstream error on 429", async () => {
    const reg = registerModule(registerGazette, {
      xmlGet: vi.fn(async () => fetched("slow down", { status: 429, ok: false })),
    });
    const r = await callTool(reg, "gazette_search_notices", { query: "x", limit: 10 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });

  it("surfaces an unknown upstream error on 500", async () => {
    const reg = registerModule(registerGazette, {
      xmlGet: vi.fn(async () => fetched("boom", { status: 500, ok: false })),
    });
    const r = await callTool(reg, "gazette_search_notices", { query: "x", limit: 10 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "unknown" });
  });
});

// --- gazette_get_notice -----------------------------------------------------

describe("gazette_get_notice", () => {
  it("returns the notice with constructed urls (feed-wrapped)", async () => {
    const xmlGet = vi.fn(async () => fetched(FEED_WRAPPED));
    const reg = registerModule(registerGazette, { xmlGet });
    const out = resultJson(await callTool(reg, "gazette_get_notice", { id: "4444" }));
    expect(out.id).toBe("4444");
    expect(out.title).toBe("DELTA PLC");
    expect(out.notice_code).toBe("2410");
    expect(out.html_url).toBe("https://www.thegazette.co.uk/notice/4444");
    expect(out.json_url).toBe("https://www.thegazette.co.uk/notice/4444.json");
    expect(xmlGet.mock.calls[0]![0]).toBe("https://www.thegazette.co.uk/notice/4444");
  });

  it("returns null fields but still constructs urls when no entry is present", async () => {
    const reg = registerModule(registerGazette, { xmlGet: vi.fn(async () => fetched(NO_ENTRY)) });
    const out = resultJson(await callTool(reg, "gazette_get_notice", { id: "9999" }));
    expect(out.id).toBe("9999");
    expect(out.title).toBeNull();
    expect(out.notice_code).toBeNull();
    expect(out.published).toBeNull();
    expect(out.summary).toBeNull();
    expect(out.html_url).toBe("https://www.thegazette.co.uk/notice/9999");
    expect(out.json_url).toBe("https://www.thegazette.co.uk/notice/9999.json");
  });

  it("surfaces a not_found upstream error on 404", async () => {
    const reg = registerModule(registerGazette, {
      xmlGet: vi.fn(async () => fetched("no", { status: 404, ok: false })),
    });
    const r = await callTool(reg, "gazette_get_notice", { id: "1" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "not_found" });
  });
});

// --- registration -----------------------------------------------------------

describe("gazette registration", () => {
  it("registers exactly the two Gazette tools and no resources/prompts", () => {
    const reg = registerModule(registerGazette);
    expect([...reg.tools.keys()].sort()).toEqual(["gazette_get_notice", "gazette_search_notices"]);
    expect(reg.resources).toHaveLength(0);
    expect(reg.prompts.size).toBe(0);
  });
});
