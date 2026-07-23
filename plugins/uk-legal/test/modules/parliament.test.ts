import { describe, it, expect, vi } from "vitest";
import { registerParliament } from "../../src/modules/parliament/index.js";
import { registerModule, callTool, resultJson, isErr, resourceByTemplate, fetched } from "../_harness.js";
import {
  stripHtml, slugify, safeInt, pyIntOr0, isoDate, pyRepr, formatHttpError, mostCommon, normHouse,
  hansardContributionUrl, extractColumnNumbers, assignColumns, itemIsContribution, hansardSourceLabel,
  parseHansardContributions, parseDebateItemAsContribution, computeSearchFacets, parseTopDebatesPreview,
  parseDivisionMatch, parseTopDivisionsPreview, populateVotesIds,
} from "../../src/modules/parliament/parsers.js";
import { UpstreamHttpError } from "../../src/shared/envelope.js";
import { makeDeps } from "../_harness.js";

const j = (obj: unknown) => fetched(JSON.stringify(obj), { contentType: "application/json" });
const isFetched = (v: any) => v && typeof v === "object" && "ok" in v && "text" in v;
/** Route jsonGet by URL substring (first match wins). Values: plain object -> JSON 200, or a Fetched. */
function router(pairs: Array<[string, any]>) {
  return vi.fn(async (url: string) => {
    for (const [m, v] of pairs) if (url.includes(m)) return isFetched(v) ? v : j(v);
    throw new Error(`unrouted jsonGet: ${url}`);
  });
}

// ============================================================ parsers
describe("parliament/parsers — string & number helpers", () => {
  it("stripHtml removes tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello   <b>world</b></p>\n\nx")).toBe("Hello world x");
    expect(stripHtml("")).toBe("");
  });
  it("slugify normalises and falls back to 'debate'", () => {
    expect(slugify("  Renters' Rights Bill!! ")).toBe("renters-rights-bill");
    expect(slugify("---")).toBe("debate");
  });
  it("safeInt parses ints, truncates floats, rejects junk", () => {
    expect(safeInt(5)).toBe(5);
    expect(safeInt(5.9)).toBe(5);
    expect(safeInt("42")).toBe(42);
    expect(safeInt("  -7 ")).toBe(-7);
    expect(safeInt("x", 99)).toBe(99);
    expect(safeInt(NaN, 3)).toBe(3);
  });
  it("pyIntOr0 treats falsy as 0", () => {
    expect(pyIntOr0(0)).toBe(0);
    expect(pyIntOr0("")).toBe(0);
    expect(pyIntOr0("12")).toBe(12);
  });
  it("isoDate defaults on falsy, slices, and throws on malformed", () => {
    expect(isoDate(null)).toBe("1970-01-01");
    expect(isoDate("2024-05-05T10:00:00")).toBe("2024-05-05");
    expect(() => isoDate("not-a-date")).toThrow(/invalid isoformat/);
  });
  it("pyRepr picks quotes and escapes", () => {
    expect(pyRepr("simple")).toBe("'simple'");
    expect(pyRepr("it's")).toBe(`"it's"`); // has single, no double -> double quotes
    expect(pyRepr(`he said "hi" it's`)).toBe(`'he said "hi" it\\'s'`); // both -> single, escape single
    expect(pyRepr("tab\tnew\nline\\x")).toContain("\\t");
  });
  it("mostCommon sorts by count desc", () => {
    const m = new Map([["a", 1], ["b", 3], ["c", 2]]);
    expect(mostCommon(m).map(([k]) => k)).toEqual(["b", "c", "a"]);
  });
  it("normHouse defaults to Commons", () => {
    expect(normHouse("Lords")).toBe("Lords");
    expect(normHouse("Commons")).toBe("Commons");
    expect(normHouse("Weird")).toBe("Commons");
    expect(normHouse(null)).toBe("Commons");
  });
});

describe("parliament/parsers — formatHttpError", () => {
  it("maps HTTP statuses", () => {
    expect(formatHttpError(new UpstreamHttpError(404, "u"))).toMatch(/404/);
    expect(formatHttpError(new UpstreamHttpError(403, "u"))).toMatch(/403/);
    expect(formatHttpError(new UpstreamHttpError(429, "u"))).toMatch(/429/);
    expect(formatHttpError(new UpstreamHttpError(503, "u"))).toMatch(/503/);
    expect(formatHttpError(new UpstreamHttpError(500, "u"))).toMatch(/unexpected status/);
  });
  it("maps timeout and connect and generic errors", () => {
    expect(formatHttpError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toMatch(/timed out/);
    expect(formatHttpError(new Error("ECONNREFUSED"))).toMatch(/connect/);
    expect(formatHttpError(new Error("weird"))).toMatch(/Unexpected error/);
    expect(formatHttpError("string-err")).toMatch(/Unexpected error/);
  });
});

describe("parliament/parsers — columns & contributions", () => {
  it("hansardContributionUrl builds a public URL, defaulting the house segment", () => {
    expect(hansardContributionUrl("Lords", "2024-01-01", "D1", "C1", "My Debate")).toContain("/lords/2024-01-01/debates/D1/my-debate#contribution-C1");
    expect(hansardContributionUrl("Weird", "2024-01-01", "D1", "C1", "T")).toContain("/commons/");
  });
  it("extractColumnNumbers reads data-column-number off marker spans", () => {
    const html = `<span class="column-number" data-column-number="200">x</span><span>skip</span><span class="column-number" data-column-number="201">y</span>`;
    expect(extractColumnNumbers(html)).toEqual([200, 201]);
    expect(extractColumnNumbers("")).toEqual([]);
  });
  it("assignColumns carries the current column forward", () => {
    const items = [
      { Value: `<span class="column-number" data-column-number="10">a</span>` },
      { Value: "no markers" },
      { Value: `<span class="column-number" data-column-number="12">c</span>` },
    ];
    expect(assignColumns(items)).toEqual([[10, 10], [10, 10], [12, 12]]);
  });
  it("itemIsContribution filters non-speech items", () => {
    expect(itemIsContribution({ ItemType: "Contribution", Value: "hi" })).toBe(true);
    expect(itemIsContribution({ ItemType: "Contribution", HRSTag: "hs_ColumnNumber", Value: "x" })).toBe(false);
    expect(itemIsContribution({ ItemType: "Other", Value: "x" })).toBe(false);
    expect(itemIsContribution({ ItemType: "Contribution", Value: "" })).toBe(false);
  });
  it("hansardSourceLabel maps codes", () => {
    expect(hansardSourceLabel(1)).toBe("RollingHansard");
    expect(hansardSourceLabel(99)).toMatch(/Unknown source code 99/);
    expect(hansardSourceLabel(null)).toBeNull();
    expect(hansardSourceLabel(undefined)).toBeNull();
  });

  it("parseHansardContributions extracts party, url, and honours text_mode", () => {
    const data = {
      Contributions: [
        {
          MemberName: "Jane MP", AttributedTo: "Jane MP (Labour)", MemberId: 5,
          ContributionText: "<p>short</p>", ContributionTextFull: "<p>full text</p>",
          SittingDate: "2024-02-02T00:00:00", House: "Commons",
          DebateSectionExtId: "D1", ContributionExtId: "C1", DebateSection: "Housing", DebateSectionId: "77",
          HansardSection: "col 5", Section: "Chamber", Rank: 1,
        },
        { badItem: true, SittingDate: "bad-date" }, // isoDate throws -> skipped
      ],
    };
    const preview = parseHansardContributions(data, "preview");
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({ party: "Labour", member_id: 5, debate_id: 77, text: "short", house: "Commons" });
    expect(preview[0]!.url).toContain("#contribution-C1");
    const full = parseHansardContributions(data, "full");
    expect(full[0]!.text).toBe("full text");
  });

  it("parseHansardContributions handles missing ids and unknown house", () => {
    const out = parseHansardContributions({ Contributions: [{ SittingDate: "2024-01-01", House: "Scotland" }] });
    expect(out[0]).toMatchObject({ member_name: "Unknown", house: "Commons", url: "", party: null });
  });

  it("parseDebateItemAsContribution parses attribution and columns", () => {
    const overview = { Date: "2024-03-03", House: "Lords", ExtId: "D9", Id: "12", Title: "Debate T", Location: "Grand Committee" };
    const cols: Array<[number | null, number | null]> = [[100, 101]];
    const c = parseDebateItemAsContribution(
      { AttributedTo: "Lord Smith (Crossbench)", Value: "<p>words</p>", ExternalId: "C9", MemberId: 3, HansardSection: "col 100" },
      overview, cols, 0,
    );
    expect(c).toMatchObject({ member_name: "Lord Smith", party: "Crossbench", column_start: 100, column_end: 101, house: "Lords" });
    expect(c!.url).toContain("#contribution-C9");
  });

  it("parseDebateItemAsContribution returns null for empty attr or empty text", () => {
    const ov = { Date: "2024-01-01" };
    expect(parseDebateItemAsContribution({ AttributedTo: "" }, ov, [], 0)).toBeNull();
    expect(parseDebateItemAsContribution({ AttributedTo: "Someone", Value: "<p></p>" }, ov, [], 0)).toBeNull();
  });

  it("parseDebateItemAsContribution defaults chamber_section and handles no columns", () => {
    const c = parseDebateItemAsContribution(
      { AttributedTo: "Mr X", Value: "hi", ExternalId: "" }, { Date: "2024-01-01", House: "Commons" }, [], 0,
    );
    expect(c!.chamber_section).toBe("Commons Chamber");
    expect(c!.url).toBe(""); // no ext ids
    expect(c!.column_start).toBeNull();
  });

  it("computeSearchFacets tallies party/house and date range", () => {
    const contribs = [
      { party: "Lab", house: "Commons", date: "2024-02-02" },
      { party: null, house: "Lords", date: "2024-01-01" },
    ] as any;
    const f = computeSearchFacets(contribs);
    expect(f.party).toEqual({ Lab: 1, Unknown: 1 });
    expect(f.house).toEqual({ Commons: 1, Lords: 1 });
    expect(f.dateRange).toEqual(["2024-01-01", "2024-02-02"]);
    expect(computeSearchFacets([]).dateRange).toBeNull();
  });

  it("parseTopDebatesPreview and parseDivisionMatch/parseTopDivisionsPreview", () => {
    expect(parseTopDebatesPreview({ Debates: [{ DebateSectionExtId: "D1", SittingDate: "2024-01-01", Title: "T", Rank: 3 }] })[0])
      .toMatchObject({ debate_ext_id: "D1", relevance_rank: 3 });
    expect(parseTopDebatesPreview({ Debates: [{ DebateSectionExtId: "" }] })).toEqual([]); // no extId -> skip
    expect(parseTopDebatesPreview({ Debates: [{ DebateSectionExtId: "D2", SittingDate: "bad" }] })).toEqual([]); // isoDate throws -> skip

    const div = parseDivisionMatch({ ExternalId: "E1", Date: "2024-01-01", House: "Commons", Time: "2024-01-01T14:30:00", Number: 3, AyesCount: 10, NoesCount: 2 });
    expect(div).toMatchObject({ external_id: "E1", time: "14:30:00", ayes_count: 10, number: "3" });
    expect(parseDivisionMatch({ ExternalId: "E2", Date: "2024-01-01", Time: "None" })!.time).toBeNull();
    expect(parseDivisionMatch({ ExternalId: "E3", Date: "2024-01-01", Time: "09:00" })!.time).toBe("09:00");
    expect(parseDivisionMatch({ ExternalId: "" })).toBeNull();
    expect(parseDivisionMatch({ ExternalId: "E4", Date: "bad-date" })).toBeNull();

    expect(parseTopDivisionsPreview({ Divisions: [{ ExternalId: "E1", Date: "2024-01-01" }, "not-object", null] })).toHaveLength(1);
  });
});

describe("parliament/parsers — populateVotesIds", () => {
  it("returns early for an empty list", async () => {
    await expect(populateVotesIds(makeDeps(), [])).resolves.toBeUndefined();
  });
  it("cross-resolves Commons and Lords votes ids and tolerates errors", async () => {
    const divisions: any[] = [
      { number: "3", date: "2024-01-01", house: "Commons", votes_id: null },
      { number: "5", date: "2024-02-02", house: "Lords", votes_id: null },
      { number: "9", date: "2024-03-03", house: "Commons", votes_id: null }, // upstream error -> left null
    ];
    const jsonGet = vi.fn(async (url: string) => {
      if (url.includes("commonsvotes-api") && url.includes("2024-01-01")) return j([{ Number: 3, DivisionId: 3392 }]);
      if (url.includes("lordsvotes-api")) return j([{ number: 5, divisionId: 77 }, { number: null }, "bad", { number: 6, divisionId: "x" }]);
      throw new UpstreamHttpError(500, url);
    });
    const deps = makeDeps({ jsonGet });
    await populateVotesIds(deps, divisions as any);
    expect(divisions[0].votes_id).toBe(3392);
    expect(divisions[1].votes_id).toBe(77);
    expect(divisions[2].votes_id).toBeNull();
  });
  it("skips a non-array payload", async () => {
    const jsonGet = vi.fn(async () => j({ not: "an array" }));
    const divisions: any[] = [{ number: "1", date: "2024-01-01", house: "Commons", votes_id: null }];
    await populateVotesIds(makeDeps({ jsonGet }), divisions as any);
    expect(divisions[0].votes_id).toBeNull();
  });
});

// ============================================================ tools
describe("parliament_search_hansard", () => {
  const contribs = { TotalResultCount: 42, Results: [{ MemberName: "A", AttributedTo: "A (Lab)", SittingDate: "2024-01-01", House: "Commons", DebateSectionExtId: "D1", ContributionExtId: "C1", DebateSection: "T" }] };
  const envelope = { TotalContributions: 42, TotalDebates: 5, Debates: [{ DebateSectionExtId: "D1", SittingDate: "2024-01-01", Title: "T", Rank: 1 }], Divisions: [{ ExternalId: "E1", Date: "2024-01-01" }] };

  it("returns contributions, facets, corpus totals, and previews", async () => {
    const jsonGet = router([["contributions/", contribs], ["search.json", envelope]]);
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_search_hansard", { query: "housing", limit: 1 }));
    expect(out.total).toBe(1);
    expect(out.total_corpus).toBe(42);
    expect(out.total_debates).toBe(5);
    expect(out.top_debates[0].debate_ext_id).toBe("D1");
    expect(out.top_divisions).toHaveLength(1);
    expect(out.has_more).toBe(true); // 1 === limit 1
    expect(out.party_breakdown).toMatchObject({ Lab: 1 });
  });

  it("forwards date/house/member filters", async () => {
    const jsonGet = router([["contributions/", contribs], ["search.json", envelope]]);
    const reg = registerModule(registerParliament, { jsonGet });
    await callTool(reg, "parliament_search_hansard", {
      query: "x", from_date: "2020-01-01", to_date: "2024-01-01", house: "Lords", member_id: 7, contribution_type: "Written", limit: 20,
    });
    const url = jsonGet.mock.calls.find((c) => (c[0] as string).includes("contributions/"))![0] as string;
    expect(url).toContain("contributions/Written.json");
    expect(url).toContain("startDate=2020-01-01");
    expect(url).toContain("house=Lords");
    expect(url).toContain("memberId=7");
  });

  it("surfaces an upstream error", async () => {
    const jsonGet = vi.fn(async () => fetched("nope", { status: 500, ok: false }));
    const reg = registerModule(registerParliament, { jsonGet });
    expect(isErr(await callTool(reg, "parliament_search_hansard", { query: "x" }))).toBe(true);
  });
});

describe("parliament_policy_position_summary", () => {
  const envelope = { TotalContributions: 100, TotalDebates: 10 };
  const debatesPage = (n: number) => ({ Results: Array.from({ length: n }, (_, i) => ({ DebateSectionExtId: `D${i}`, SittingDate: "2024-05-05", House: "Commons", DebateSection: "Housing", Title: `T${i}`, Rank: i })) });

  it("aggregates facets across paginated debates", async () => {
    let calls = 0;
    const jsonGet = vi.fn(async (url: string) => {
      if (url.includes("search.json")) return j(envelope);
      if (url.includes("Debates.json")) { calls++; return calls === 1 ? j(debatesPage(50)) : j(debatesPage(3)); }
      throw new Error("unrouted " + url);
    });
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_policy_position_summary", { topic: "housing", max_debates_scanned: 200 }));
    expect(out.total_contributions).toBe(100);
    expect(out.debates_scanned).toBe(53); // 50 (full page) + 3 (short page -> stop)
    expect(out.by_house[0]).toMatchObject({ key: "Commons" });
    expect(out.by_year[0]).toMatchObject({ key: "2024" });
    expect(out.top_debates.length).toBeLessThanOrEqual(20);
  });

  it("skips debates with malformed dates and stops on empty page", async () => {
    const jsonGet = vi.fn(async (url: string) => {
      if (url.includes("search.json")) return j(envelope);
      if (url.includes("Debates.json")) return j({ Results: [{ DebateSectionExtId: "D1", SittingDate: "bad" }, { DebateSectionExtId: "", SittingDate: "2024-01-01" }] });
      throw new Error("unrouted");
    });
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_policy_position_summary", { topic: "xx", max_debates_scanned: 50 }));
    expect(out.debates_scanned).toBe(2);
    expect(out.top_debates).toEqual([]); // one bad date skipped, one empty extId skipped
  });

  it("throws when the first debates page errors, breaks when a later page errors", async () => {
    const errFirst = vi.fn(async (url: string) => {
      if (url.includes("search.json")) return j(envelope);
      throw new UpstreamHttpError(503, url);
    });
    expect(isErr(await callTool(registerModule(registerParliament, { jsonGet: errFirst }), "parliament_policy_position_summary", { topic: "xx", max_debates_scanned: 50 }))).toBe(true);

    let n = 0;
    const errLater = vi.fn(async (url: string) => {
      if (url.includes("search.json")) return j(envelope);
      if (url.includes("Debates.json")) { n++; if (n === 1) return j(debatesPage(50)); throw new UpstreamHttpError(503, url); }
      throw new Error("unrouted");
    });
    const out = resultJson(await callTool(registerModule(registerParliament, { jsonGet: errLater }), "parliament_policy_position_summary", { topic: "xx", max_debates_scanned: 200 }));
    expect(out.debates_scanned).toBe(50); // first page kept, later error breaks the loop
  });
});

describe("parliament_find_member", () => {
  it("maps members, house id, and defaults", async () => {
    const jsonGet = vi.fn(async () => j({ items: [
      { value: { id: 1, nameDisplayAs: "Jane", latestParty: { name: "Lab" }, latestHouseMembership: { house: 1, membershipFrom: "Leeds", membershipStatus: { statusIsActive: true } } } },
      { id: 2, nameDisplayAs: "Lord P", latestHouseMembership: { house: 2 } }, // item without .value; house 2 -> Lords
    ] }));
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_find_member", { name: "smith" }));
    expect(out.total).toBe(2);
    expect(out.members[0]).toMatchObject({ id: 1, house: "Commons", constituency: "Leeds", is_current: true });
    expect(out.members[1]).toMatchObject({ id: 2, house: "Lords", party: "Unknown", is_current: false });
  });
  it("surfaces an error", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 404, ok: false })) });
    expect(isErr(await callTool(reg, "parliament_find_member", { name: "xx" }))).toBe(true);
  });
});

describe("parliament_member_debates", () => {
  it("returns member contributions and forwards the topic", async () => {
    const jsonGet = vi.fn(async () => j({ Contributions: [{ MemberName: "A", SittingDate: "2024-01-01", House: "Commons" }] }));
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_member_debates", { member_id: 5, topic: "housing", limit: 20 }));
    expect(out.member_id).toBe(5);
    expect(out.topic).toBe("housing");
    expect(out.total).toBe(1);
    expect(jsonGet.mock.calls[0]![0]).toContain("searchTerm=housing");
  });
  it("omits searchTerm when no topic and surfaces errors", async () => {
    const jsonGet = vi.fn(async () => j({ Contributions: [] }));
    const reg = registerModule(registerParliament, { jsonGet });
    await callTool(reg, "parliament_member_debates", { member_id: 5 });
    expect(jsonGet.mock.calls[0]![0]).not.toContain("searchTerm");
    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad, "parliament_member_debates", { member_id: 5 }))).toBe(true);
  });
});

describe("parliament_member_interests", () => {
  it("maps interests, category name, description cap, and category filter", async () => {
    const jsonGet = vi.fn(async () => j({ items: [
      { category: { name: "Donations" }, summary: "x".repeat(80), registrationDate: "2024-01-01T00:00:00" },
      { category: "PlainString", publishedDate: "2024-02-02" },
    ] }));
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_member_interests", { member_id: 5, category: "donations", limit: 20, max_description_chars: 50 }));
    expect(out.interests[0].category).toBe("Donations");
    expect(out.interests[0].description.endsWith("…[truncated]")).toBe(true);
    expect(out.interests[0].date_created).toBe("2024-01-01");
    expect(out.interests[1].category).toBe("PlainString");
    expect(jsonGet.mock.calls[0]![0]).toContain("CategoryId=3");
  });
  it("reads from .results and surfaces errors", async () => {
    const jsonGet = vi.fn(async () => j({ results: [{ category: {}, summary: "" }] }));
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_member_interests", { member_id: 5 }));
    expect(out.interests[0].category).toBe("Unknown");
    expect(out.interests[0].date_created).toBeNull();
    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad, "parliament_member_interests", { member_id: 5 }))).toBe(true);
  });
});

describe("parliament_search_petitions", () => {
  it("maps petitions and computes the page number", async () => {
    const jsonGet = vi.fn(async () => j({ data: [
      { id: 101, attributes: { action: "Ban X", state: "open", signature_count: 1234, created_at: "2024-01-01T00:00:00", government_response_at: "2024-02-02", scheduled_debate_date: "2024-03-03" } },
    ] }));
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_search_petitions", { query: "ban", state: "open", offset: 40, limit: 20 }));
    expect(out.petitions[0]).toMatchObject({ id: 101, action: "Ban X", signature_count: 1234, created_at: "2024-01-01" });
    expect(jsonGet.mock.calls[0]![0]).toContain("page=3"); // floor(40/20)+1
    expect(jsonGet.mock.calls[0]![0]).toContain("state=open");
  });
  it("handles missing attributes/ids and surfaces errors", async () => {
    const jsonGet = vi.fn(async () => j({ data: [{}] }));
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_search_petitions", { query: "xx" }));
    expect(out.petitions[0]).toMatchObject({ id: 0, action: "Unknown", state: "unknown" });
    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad, "parliament_search_petitions", { query: "xx" }))).toBe(true);
  });
});

describe("parliament_get_debate_divisions", () => {
  it("parses divisions and cross-resolves votes ids", async () => {
    const jsonGet = vi.fn(async (url: string) => {
      if (url.includes("debates/divisions/")) return j([{ ExternalId: "E1", Date: "2024-01-01", House: "Commons", Number: 3 }]);
      if (url.includes("commonsvotes-api")) return j([{ Number: 3, DivisionId: 555 }]);
      throw new Error("unrouted " + url);
    });
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_get_debate_divisions", { debate_ext_id: "DEBATE-1" }));
    expect(out.divisions[0]).toMatchObject({ external_id: "E1", votes_id: 555 });
  });
  it("returns an empty list for a non-array payload and surfaces errors", async () => {
    const jsonGet = vi.fn(async () => j({ not: "array" }));
    const reg = registerModule(registerParliament, { jsonGet });
    expect(resultJson(await callTool(reg, "parliament_get_debate_divisions", { debate_ext_id: "DEBATE-1" })).divisions).toEqual([]);
    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad, "parliament_get_debate_divisions", { debate_ext_id: "DEBATE-1" }))).toBe(true);
  });
});

describe("parliament_get_debate_contributions", () => {
  const debate = { Overview: { Date: "2024-01-01", House: "Commons", ExtId: "D1", Id: 12, Title: "T" }, Items: [
    { ItemType: "Contribution", Value: "<p>one</p>", AttributedTo: "A (Lab)", ExternalId: "C1", MemberId: 5 },
    { ItemType: "Contribution", Value: "<p>two</p>", AttributedTo: "B", ExternalId: "C2", MemberId: 6 },
    { ItemType: "Contribution", HRSTag: "hs_ColumnNumber", Value: "col" }, // skipped
  ] };

  it("returns all contributions, then filters by member_id", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => j(debate)) });
    const all = resultJson(await callTool(reg, "parliament_get_debate_contributions", { debate_ext_id: "DEBATE-1" }));
    expect(all.total).toBe(2);
    expect(all.member_id).toBe(0);

    const reg2 = registerModule(registerParliament, { jsonGet: vi.fn(async () => j(debate)) });
    const one = resultJson(await callTool(reg2, "parliament_get_debate_contributions", { debate_ext_id: "DEBATE-1", member_id: 5 }));
    expect(one.total).toBe(1);
    expect(one.member_id).toBe(5);
  });
  it("handles an empty body and surfaces errors", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("", { contentType: "application/json" })) });
    expect(resultJson(await callTool(reg, "parliament_get_debate_contributions", { debate_ext_id: "DEBATE-1" })).total).toBe(0);
    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad, "parliament_get_debate_contributions", { debate_ext_id: "DEBATE-1" }))).toBe(true);
  });
});

describe("parliament_lookup_by_column", () => {
  it("resolves matches with a secondary debate fetch", async () => {
    const jsonGet = vi.fn(async (url: string) => {
      if (url.includes("debatebycolumn.json")) return j({ TotalResultCount: 1, Results: [{ DebateSectionExtId: "D1", SittingDate: "2024-01-01", House: "Lords", Title: "T" }] });
      if (url.includes("debates/Debate/")) return j({ Overview: { Source: 2, Id: 99 }, Items: [{ ItemType: "Contribution", Value: "x" }] });
      throw new Error("unrouted " + url);
    });
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_lookup_by_column", { column_number: "200", volume_number: 849, house: "Lords" }));
    expect(out.matches[0]).toMatchObject({ debate_ext_id: "D1", contribution_count: 1, source_code: 2, source: "DailyHansard", debate_id: 99 });
    expect(out.total_results).toBe(1);
  });
  it("keeps defaults when the secondary fetch fails, skips empty extIds", async () => {
    const jsonGet = vi.fn(async (url: string) => {
      if (url.includes("debatebycolumn.json")) return j({ Results: [{ DebateSectionExtId: "D1", SittingDate: "2024-01-01" }, { DebateSectionExtId: "" }] });
      throw new UpstreamHttpError(500, url); // secondary debate fetch fails
    });
    const reg = registerModule(registerParliament, { jsonGet });
    const out = resultJson(await callTool(reg, "parliament_lookup_by_column", { column_number: "200", volume_number: 849 }));
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]).toMatchObject({ contribution_count: null, source_code: null, debate_id: 0 });
  });
  it("surfaces a primary error and handles empty body", async () => {
    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad, "parliament_lookup_by_column", { column_number: "1", volume_number: 1 }))).toBe(true);
    const empty = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("", { contentType: "application/json" })) });
    expect(resultJson(await callTool(empty, "parliament_lookup_by_column", { column_number: "1", volume_number: 1 })).matches).toEqual([]);
  });
});

// ============================================================ resources
describe("hansard:// resources", () => {
  const debate = { Overview: { Id: 12, ExtId: "D1", Title: " T ", Date: "2024-01-01T00:00:00", House: "Commons", Location: "Chamber", VolumeNo: 849, Source: 1, PreviousDebateTitle: " Prev ", NextDebateTitle: "" }, Items: [
    { ItemType: "Contribution", Value: `<span class="column-number" data-column-number="5">x</span><p>hello</p>`, ExternalId: "C1", MemberId: 3, AttributedTo: "A", OrderInSection: 1, HansardSection: "col 5" },
  ] };

  it("header resource returns overview + contribution index", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => j(debate)) });
    const res = resourceByTemplate(reg, "hansard://debate/{debate_ext_id}/header");
    const out = await res.handler(new URL("hansard://debate/D1/header"), { debate_ext_id: "D1" });
    const body = JSON.parse(out.contents[0].text);
    expect(body.title).toBe("T");
    expect(body.contribution_count).toBe(1);
    expect(body.contributions_index[0]).toMatchObject({ order: 1, contribution_ext_id: "C1", column_start: 5 });
    expect(body.next_debate_title).toBeNull();
    expect(body.source).toBe("RollingHansard");
  });

  it("header resource returns an error envelope on upstream failure", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 404, ok: false })) });
    const res = resourceByTemplate(reg, "hansard://debate/{debate_ext_id}/header");
    const body = JSON.parse((await res.handler(new URL("hansard://debate/D1/header"), { debate_ext_id: "D1" })).contents[0].text);
    expect(body.error).toMatch(/404/);
  });

  it("contribution resource returns the matched contribution", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => j(debate)) });
    const res = resourceByTemplate(reg, "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}");
    const body = JSON.parse((await res.handler(new URL("hansard://debate/D1/contribution/C1"), { debate_ext_id: "D1", contribution_ext_id: "C1" })).contents[0].text);
    expect(body.text).toBe("xhello"); // adjacent tags -> no space after stripHtml
    expect(body.column_start).toBe(5);
  });

  it("contribution resource returns not-found and error envelopes", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => j(debate)) });
    const res = resourceByTemplate(reg, "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}");
    const nf = JSON.parse((await res.handler(new URL("hansard://debate/D1/contribution/CX"), { debate_ext_id: "D1", contribution_ext_id: "CX" })).contents[0].text);
    expect(nf.status).toBe("not_found");

    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 503, ok: false })) });
    const res2 = resourceByTemplate(bad, "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}");
    const err = JSON.parse((await res2.handler(new URL("hansard://debate/D1/contribution/C1"), { debate_ext_id: "D1", contribution_ext_id: "C1" })).contents[0].text);
    expect(err.error).toMatch(/503/);
  });

  it("header/contribution resources default missing overview fields to null/empty", async () => {
    // Minimal payload: no Overview, no Items -> exercises the `?? null` / `|| ""` fallbacks.
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => j({})) });
    const header = resourceByTemplate(reg, "hansard://debate/{debate_ext_id}/header");
    const hb = JSON.parse((await header.handler(new URL("hansard://debate/D9/header"), { debate_ext_id: "D9" })).contents[0].text);
    expect(hb).toMatchObject({ debate_ext_id: "D9", title: "", house: null, location: null, source: null, contribution_count: 0 });
    expect(hb.previous_debate_title).toBeNull();
    expect(hb.next_debate_title).toBeNull();

    const reg2 = registerModule(registerParliament, { jsonGet: vi.fn(async () => j({})) });
    const contrib = resourceByTemplate(reg2, "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}");
    const cb = JSON.parse((await contrib.handler(new URL("hansard://debate/D9/contribution/CX"), { debate_ext_id: "D9", contribution_ext_id: "CX" })).contents[0].text);
    expect(cb.status).toBe("not_found"); // empty Items -> no match
  });

  it("biography resource returns the member biography and error envelope", async () => {
    const reg = registerModule(registerParliament, { jsonGet: vi.fn(async () => j({ value: { nameDisplayAs: "Jane", posts: [] } })) });
    const res = resourceByTemplate(reg, "hansard://member/{member_id}/biography");
    const body = JSON.parse((await res.handler(new URL("hansard://member/5/biography"), { member_id: "5" })).contents[0].text);
    expect(body).toMatchObject({ member_id: 5, nameDisplayAs: "Jane" });

    const bad = registerModule(registerParliament, { jsonGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    const res2 = resourceByTemplate(bad, "hansard://member/{member_id}/biography");
    const err = JSON.parse((await res2.handler(new URL("hansard://member/5/biography"), { member_id: "5" })).contents[0].text);
    expect(err.member_id).toBe(5);
    expect(err.error).toBeTruthy();
  });
});

// ============================================================ prompts
describe("parliament prompts", () => {
  it("policy_reception_review builds a user message referencing the topic", () => {
    const reg = registerModule(registerParliament);
    const p = reg.prompts.get("parliament_policy_reception_review")!;
    const msg = p.handler({ policy_description: "A new policy", topic: "housing" });
    expect(msg.messages[0].role).toBe("user");
    expect(msg.messages[0].content.text).toContain("'housing'");
    expect(msg.messages[0].content.text).toContain("A new policy");
  });
  it("member_record_on_topic builds a user message referencing member and topic", () => {
    const reg = registerModule(registerParliament);
    const p = reg.prompts.get("parliament_member_record_on_topic")!;
    const msg = p.handler({ member_name: "Jane MP", topic: "housing" });
    expect(msg.messages[0].content.text).toContain("Jane MP");
    expect(msg.messages[0].content.text).toContain("'housing'");
  });
});
