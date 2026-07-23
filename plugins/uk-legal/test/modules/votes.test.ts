import { describe, it, expect, vi, afterEach } from "vitest";
import { registerVotes } from "../../src/modules/votes/index.js";
import {
  COMMONS_VOTES_BASE,
  LORDS_VOTES_BASE,
  MAX_VOTERS_PER_SIDE,
  searchUrl,
  detailUrl,
  asDict,
  firstOf,
  parseCommonsSummary,
  parseLordsSummary,
  parseVoters,
  detailDate,
  detailTitle,
  nullableBool,
} from "../../src/modules/votes/parsers.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";

afterEach(() => vi.useRealTimers());

/** A JSON `Fetched` carrying the given payload. */
const jsonFetched = (payload: unknown) =>
  fetched(JSON.stringify(payload), { contentType: "application/json" });

// ---------------------------------------------------------------- parsers (pure)
describe("votes/parsers — URL builders", () => {
  it("searchUrl branches on house", () => {
    expect(searchUrl("Lords")).toBe(`${LORDS_VOTES_BASE}/data/Divisions/search`);
    expect(searchUrl("Commons")).toBe(`${COMMONS_VOTES_BASE}/data/divisions.json/search`);
    expect(searchUrl("anything-else")).toBe(`${COMMONS_VOTES_BASE}/data/divisions.json/search`);
  });

  it("detailUrl branches on house", () => {
    expect(detailUrl("Lords", 42)).toBe(`${LORDS_VOTES_BASE}/data/Divisions/42`);
    expect(detailUrl("Commons", 42)).toBe(`${COMMONS_VOTES_BASE}/data/division/42.json`);
  });
});

describe("votes/parsers — asDict / firstOf", () => {
  it("asDict returns plain objects and {} for everything else", () => {
    expect(asDict({ a: 1 })).toEqual({ a: 1 });
    expect(asDict([1, 2])).toEqual({}); // arrays are not dicts
    expect(asDict(null)).toEqual({});
    expect(asDict(undefined)).toEqual({});
    expect(asDict("string")).toEqual({});
    expect(asDict(7)).toEqual({});
  });

  it("firstOf returns the first present key, else the default", () => {
    const obj = { b: 2, c: 3 };
    expect(firstOf(obj, ["a", "b"], "def")).toBe(2); // b present (a absent)
    expect(firstOf(obj, ["a", "z"], "def")).toBe("def"); // none present
    // a present key holding null/undefined still wins over the default
    expect(firstOf({ a: null }, ["a"], "def")).toBeNull();
  });
});

describe("votes/parsers — summaries", () => {
  it("parseCommonsSummary normalises PascalCase fields", () => {
    const s = parseCommonsSummary({
      DivisionId: 101,
      Title: "  Rwanda Bill  ",
      Date: "2024-01-15T00:00:00",
      AyeCount: 300,
      NoCount: 250,
    });
    expect(s).toEqual({
      id: 101,
      title: "Rwanda Bill",
      date: "2024-01-15",
      house: "Commons",
      ayes: 300,
      noes: 250,
      passed: true,
      is_government_win: null,
    });
  });

  it("parseCommonsSummary falls back to defaults and coerces non-string title", () => {
    const s = parseCommonsSummary({ Title: 12345 });
    expect(s).toMatchObject({
      id: 0,
      title: "12345", // non-string coerced via String(v).trim()
      date: "1970-01-01",
      ayes: 0,
      noes: 0,
      passed: false, // 0 > 0 is false
    });
  });

  it("parseLordsSummary reads camelCase keys and a boolean government-win", () => {
    const s = parseLordsSummary({
      divisionId: 202,
      title: "Lords Amendment",
      date: "2024-02-01",
      authoritativeContentCount: 120,
      authoritativeNotContentCount: 100,
      isGovernmentWin: true,
    });
    expect(s).toEqual({
      id: 202,
      title: "Lords Amendment",
      date: "2024-02-01",
      house: "Lords",
      ayes: 120,
      noes: 100,
      passed: true,
      is_government_win: true,
    });
  });

  it("parseLordsSummary also reads PascalCase keys and a falsey government-win", () => {
    const s = parseLordsSummary({
      DivisionId: 203,
      Title: "X",
      Date: "2024-03-01",
      AuthoritativeContentCount: 5,
      AuthoritativeNotContentCount: 9,
      IsGovernmentWin: false,
    });
    expect(s).toMatchObject({ id: 203, ayes: 5, noes: 9, passed: false, is_government_win: false });
  });

  it("parseLordsSummary leaves is_government_win null when absent", () => {
    const s = parseLordsSummary({ divisionId: 204 });
    expect(s.is_government_win).toBeNull();
  });
});

describe("votes/parsers — parseVoters", () => {
  it("parses mixed-case voter dicts and normalises party", () => {
    const voters = parseVoters([
      { MemberId: 1, Name: "  Alice  ", Party: "  Labour  " },
      { memberId: 2, name: "Bob", party: null },
      { memberId: 3, name: "Carol" }, // party absent → null
    ]);
    expect(voters).toEqual([
      { member_id: 1, name: "Alice", party: "Labour" },
      { member_id: 2, name: "Bob", party: null },
      { member_id: 3, name: "Carol", party: null },
    ]);
  });

  it("coerces non-dict entries to defaults", () => {
    const voters = parseVoters(["not-a-dict", 42, null]);
    expect(voters).toEqual([
      { member_id: 0, name: "Unknown", party: null },
      { member_id: 0, name: "Unknown", party: null },
      { member_id: 0, name: "Unknown", party: null },
    ]);
  });
});

describe("votes/parsers — small helpers", () => {
  it("detailDate slices to a date string", () => {
    expect(detailDate("2024-05-06T12:34:56Z")).toBe("2024-05-06");
  });

  it("detailTitle trims strings and defaults when absent", () => {
    expect(detailTitle("  Hello  ")).toBe("Hello");
    expect(detailTitle(null)).toBe("Unknown");
    expect(detailTitle(99)).toBe("99");
  });

  it("nullableBool maps null→null and truthiness→boolean", () => {
    expect(nullableBool(null)).toBeNull();
    expect(nullableBool(undefined)).toBeNull();
    expect(nullableBool(true)).toBe(true);
    expect(nullableBool(0)).toBe(false);
    expect(nullableBool("yes")).toBe(true);
  });
});

// ---------------------------------------------------------- votes_search_divisions
describe("votes_search_divisions", () => {
  it("forwards all params and parses a Commons array response", async () => {
    const jsonGet = vi.fn(async () =>
      jsonFetched([
        { DivisionId: 1, Title: "A", Date: "2024-01-01", AyeCount: 5, NoCount: 3 },
        { DivisionId: 2, Title: "B", Date: "2024-01-02", AyeCount: 1, NoCount: 9 },
      ]),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(
      await callTool(reg, "votes_search_divisions", {
        query: "  online safety  ",
        house: "Commons",
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        member_id: 4321,
        offset: 10,
        limit: 25,
      }),
    );
    expect(out.house).toBe("Commons");
    expect(out.query).toBe("online safety"); // trimmed
    expect(out.offset).toBe(10);
    expect(out.limit).toBe(25);
    expect(out.total).toBe(2);
    expect(out.has_more).toBe(false); // 2 !== 25
    expect(out.divisions[0]).toMatchObject({ id: 1, passed: true });
    expect(out.divisions[1]).toMatchObject({ id: 2, passed: false });

    const url = jsonGet.mock.calls[0]![0] as string;
    expect(url.startsWith(`${COMMONS_VOTES_BASE}/data/divisions.json/search?`)).toBe(true);
    expect(url).toContain("queryParameters.take=25");
    expect(url).toContain("queryParameters.skip=10");
    expect(url).toContain("queryParameters.searchTerm=");
    expect(url).toContain("queryParameters.startDate=2024-01-01");
    expect(url).toContain("queryParameters.endDate=2024-01-31");
    expect(url).toContain("queryParameters.memberId=4321");
  });

  it("omits optional query params and reports query=null when absent", async () => {
    const jsonGet = vi.fn(async () => jsonFetched([]));
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(
      await callTool(reg, "votes_search_divisions", {
        house: "Commons",
        offset: 0,
        limit: 25,
      }),
    );
    expect(out.query).toBeNull();
    expect(out.total).toBe(0);
    expect(out.has_more).toBe(false);

    const url = jsonGet.mock.calls[0]![0] as string;
    expect(url).not.toContain("searchTerm");
    expect(url).not.toContain("startDate");
    expect(url).not.toContain("endDate");
    expect(url).not.toContain("memberId");
  });

  it("parses a Lords wrapped {results:[...]} response and hits the Lords URL", async () => {
    const jsonGet = vi.fn(async () =>
      jsonFetched({
        results: [
          {
            divisionId: 9,
            title: "Lords vote",
            date: "2024-02-02",
            authoritativeContentCount: 50,
            authoritativeNotContentCount: 40,
            isGovernmentWin: true,
          },
        ],
      }),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(
      await callTool(reg, "votes_search_divisions", { house: "Lords", offset: 0, limit: 1 }),
    );
    expect(out.house).toBe("Lords");
    expect(out.divisions[0]).toMatchObject({ id: 9, house: "Lords", is_government_win: true });
    expect(out.has_more).toBe(true); // 1 === limit 1
    expect((jsonGet.mock.calls[0]![0] as string)).toContain(`${LORDS_VOTES_BASE}/data/Divisions/search`);
  });

  it("reads the `items` key when `results` is absent", async () => {
    const jsonGet = vi.fn(async () =>
      jsonFetched({ items: [{ DivisionId: 7, Title: "C", Date: "2024-01-03", AyeCount: 2, NoCount: 2 }] }),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(
      await callTool(reg, "votes_search_divisions", { house: "Commons", offset: 0, limit: 25 }),
    );
    expect(out.total).toBe(1);
    expect(out.divisions[0]).toMatchObject({ id: 7, passed: false }); // 2 > 2 false
  });

  it("yields zero divisions when the body has neither results nor items", async () => {
    const jsonGet = vi.fn(async () => jsonFetched({ unexpected: true }));
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(
      await callTool(reg, "votes_search_divisions", { house: "Commons", offset: 0, limit: 25 }),
    );
    expect(out.total).toBe(0);
    expect(out.divisions).toEqual([]);
  });

  it("surfaces an upstream 500 as an unknown tool error (query present → repr breadcrumb)", async () => {
    const jsonGet = vi.fn(async () => jsonFetched({}));
    (jsonGet as any).mockResolvedValueOnce(fetched("boom", { status: 500, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerVotes, { jsonGet });
    const r = await callTool(reg, "votes_search_divisions", { query: "x", house: "Commons", offset: 0, limit: 25 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false });
    expect(resultJson(r).attempted).toContain("query='x'");
  });

  it("surfaces an upstream 429 as a retryable transient (query absent → None breadcrumb)", async () => {
    const jsonGet = vi.fn(async () => fetched("slow", { status: 429, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerVotes, { jsonGet });
    const r = await callTool(reg, "votes_search_divisions", { house: "Commons", offset: 0, limit: 25 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
    expect(resultJson(r).attempted).toContain("query=None");
  });
});

// ------------------------------------------------------------- votes_get_division
describe("votes_get_division", () => {
  it("returns the full Commons voter record and computes passed", async () => {
    const jsonGet = vi.fn(async () =>
      jsonFetched({
        Title: "  Second Reading  ",
        Date: "2024-01-15T00:00:00",
        Ayes: [
          { MemberId: 1, Name: "Alice", Party: "Lab" },
          { MemberId: 2, Name: "Bob", Party: "Con" },
        ],
        Noes: [{ MemberId: 3, Name: "Carol", Party: "LD" }],
      }),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(await callTool(reg, "votes_get_division", { division_id: 555, house: "Commons" }));
    expect(out).toMatchObject({
      id: 555,
      title: "Second Reading",
      date: "2024-01-15",
      house: "Commons",
      ayes_count: 2,
      noes_count: 1,
      passed: true,
      is_government_win: null,
      truncated: false,
      total_aye_voters: 2,
      total_noe_voters: 1,
    });
    expect(out.aye_voters).toHaveLength(2);
    expect(out.noe_voters).toHaveLength(1);
    expect((jsonGet.mock.calls[0]![0] as string)).toBe(`${COMMONS_VOTES_BASE}/data/division/555.json`);
  });

  it("returns a Lords record with camelCase fields and a government win", async () => {
    const jsonGet = vi.fn(async () =>
      jsonFetched({
        title: "Lords Division",
        date: "2024-02-01",
        contents: [{ memberId: 10, name: "Lord A", party: "Crossbench" }],
        notContents: [
          { memberId: 11, name: "Lord B", party: "Con" },
          { memberId: 12, name: "Lord C", party: "Lab" },
        ],
        isGovernmentWin: true,
      }),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(await callTool(reg, "votes_get_division", { division_id: 77, house: "Lords" }));
    expect(out).toMatchObject({
      id: 77,
      title: "Lords Division",
      date: "2024-02-01",
      house: "Lords",
      ayes_count: 1,
      noes_count: 2,
      passed: false,
      is_government_win: true,
    });
    expect((jsonGet.mock.calls[0]![0] as string)).toBe(`${LORDS_VOTES_BASE}/data/Divisions/77`);
  });

  it("reads Lords PascalCase fields too", async () => {
    const jsonGet = vi.fn(async () =>
      jsonFetched({
        Title: "Lords P",
        Date: "2024-03-03",
        Contents: [{ MemberId: 20, Name: "Lord X" }],
        NotContents: [],
        IsGovernmentWin: false,
      }),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(await callTool(reg, "votes_get_division", { division_id: 88, house: "Lords" }));
    expect(out).toMatchObject({
      title: "Lords P",
      date: "2024-03-03",
      ayes_count: 1,
      noes_count: 0,
      passed: true,
      is_government_win: false,
    });
    expect(out.aye_voters[0]).toEqual({ member_id: 20, name: "Lord X", party: null });
  });

  it("truncates voter lists to MAX_VOTERS_PER_SIDE but keeps accurate totals", async () => {
    const many = Array.from({ length: MAX_VOTERS_PER_SIDE + 5 }, (_, i) => ({
      MemberId: i + 1,
      Name: `M${i}`,
      Party: "Lab",
    }));
    const jsonGet = vi.fn(async () =>
      jsonFetched({ Title: "Big", Date: "2024-04-04", Ayes: many, Noes: [] }),
    );
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(await callTool(reg, "votes_get_division", { division_id: 1, house: "Commons" }));
    expect(out.truncated).toBe(true);
    expect(out.aye_voters).toHaveLength(MAX_VOTERS_PER_SIDE);
    expect(out.ayes_count).toBe(MAX_VOTERS_PER_SIDE + 5);
    expect(out.total_aye_voters).toBe(MAX_VOTERS_PER_SIDE + 5);
  });

  it("defaults gracefully when Commons voter lists are missing/non-array", async () => {
    const jsonGet = vi.fn(async () => jsonFetched({ Title: "Empty", Date: "2024-01-01", Ayes: "nope" }));
    const reg = registerModule(registerVotes, { jsonGet });
    const out = resultJson(await callTool(reg, "votes_get_division", { division_id: 2, house: "Commons" }));
    expect(out).toMatchObject({ ayes_count: 0, noes_count: 0, passed: false, truncated: false });
  });

  it("surfaces an upstream 404 as a not_found tool error", async () => {
    const jsonGet = vi.fn(async () => fetched("missing", { status: 404, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerVotes, { jsonGet });
    const r = await callTool(reg, "votes_get_division", { division_id: 999, house: "Commons" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "not_found", is_retryable: false });
    expect(resultJson(r).attempted).toContain("division_id=999");
    expect(resultJson(r).attempted).toContain("house='Commons'");
  });

  it("surfaces an upstream 503 as a retryable transient tool error", async () => {
    const jsonGet = vi.fn(async () => fetched("down", { status: 503, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerVotes, { jsonGet });
    const r = await callTool(reg, "votes_get_division", { division_id: 3, house: "Lords" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});
