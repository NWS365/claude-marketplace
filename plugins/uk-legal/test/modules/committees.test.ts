import { describe, it, expect, vi } from "vitest";
import { registerCommittees } from "../../src/modules/committees/index.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";
import {
  isObj,
  optStr,
  reqStr,
  pickNum,
  parseHouse,
  extractItems,
  mapMember,
  mapOral,
  mapWritten,
} from "../../src/modules/committees/parsers.js";

/** jsonGet stub that returns a JSON body for any URL matching one of the branches. */
function jsonRouter(routes: Array<{ match: string; payload: unknown; over?: Partial<import("../../src/shared/http.js").Fetched> }>) {
  return vi.fn(async (url: string) => {
    for (const r of routes) {
      if (url.includes(r.match)) {
        return fetched(JSON.stringify(r.payload), { contentType: "application/json", ...(r.over ?? {}) });
      }
    }
    throw new Error(`no route matched url: ${url}`);
  });
}

// =====================================================================================
// parsers (pure)
// =====================================================================================
describe("committees/parsers", () => {
  it("isObj distinguishes plain objects from null and arrays", () => {
    expect(isObj({})).toBe(true);
    expect(isObj({ a: 1 })).toBe(true);
    expect(isObj(null)).toBe(false);
    expect(isObj([])).toBe(false);
    expect(isObj("x")).toBe(false);
    expect(isObj(3)).toBe(false);
  });

  it("optStr trims strings and nulls anything else", () => {
    expect(optStr("  hi ")).toBe("hi");
    expect(optStr(5)).toBeNull();
    expect(optStr(null)).toBeNull();
    expect(optStr(undefined)).toBeNull();
  });

  it("reqStr trims present strings, else falls back", () => {
    expect(reqStr({ name: "  Ann " }, "name", "Unknown")).toBe("Ann");
    expect(reqStr({ name: 42 }, "name", "Unknown")).toBe("Unknown"); // present but non-string
    expect(reqStr({}, "name", "Unknown")).toBe("Unknown"); // absent
  });

  it("pickNum returns numbers, else falls back", () => {
    expect(pickNum({ id: 7 }, "id", 0)).toBe(7);
    expect(pickNum({ id: "7" }, "id", 0)).toBe(0); // present but non-number
    expect(pickNum({}, "id", 0)).toBe(0); // absent
  });

  it("parseHouse maps int codes, strings, objects, and null-otherwise", () => {
    expect(parseHouse(1)).toBe("Commons");
    expect(parseHouse(2)).toBe("Lords");
    expect(parseHouse(0)).toBe("Joint");
    expect(parseHouse(99)).toBeNull(); // unmapped code
    expect(parseHouse("  Commons ")).toBe("Commons");
    expect(parseHouse({ name: "  Lords " })).toBe("Lords");
    expect(parseHouse({ name: 5 })).toBeNull(); // object, name non-string
    expect(parseHouse({})).toBeNull(); // object, no name
    expect(parseHouse(null)).toBeNull();
    expect(parseHouse([])).toBeNull(); // array is not isObj
    expect(parseHouse(true)).toBeNull();
  });

  it("extractItems unwraps items/results/dict/list and defaults to []", () => {
    expect(extractItems({ items: [1, 2] })).toEqual([1, 2]);
    expect(extractItems({ results: [3] })).toEqual([3]);
    expect(extractItems({ foo: "bar" })).toEqual([]); // dict without items/results, not an array
    expect(extractItems([4, 5])).toEqual([4, 5]); // bare list
    expect(extractItems("nope")).toEqual([]); // non-obj non-array
    expect(extractItems({ items: "not-an-array" })).toEqual([]); // items present but not array
  });

  it("mapMember shapes roles/party across branches", () => {
    // role object with a name
    expect(mapMember({ name: "A", memberInfo: { party: " Lab " }, roles: [{ role: { name: " Member " } }] })).toEqual({
      name: "A",
      party: "Lab",
      role: "Member",
    });
    // isChair overrides the role name
    expect(mapMember({ name: "B", roles: [{ role: { name: "Member", isChair: true } }] })).toMatchObject({
      role: "Chair",
    });
    // roles present but empty → role null
    expect(mapMember({ name: "C", roles: [] }).role).toBeNull();
    // roles not an array → role null
    expect(mapMember({ name: "D", roles: "nope" }).role).toBeNull();
    // first role element not an object → roleObj defaults to {}, role null
    expect(mapMember({ name: "E", roles: ["str"] }).role).toBeNull();
    // first role's `role` is a non-object → isObj(roleObj) false, role null
    expect(mapMember({ name: "F", roles: [{ role: "scalar" }] }).role).toBeNull();
    // memberInfo not an object → party null; name falls back to Unknown
    expect(mapMember({ roles: [] })).toEqual({ name: "Unknown", party: null, role: null });
  });

  it("mapOral shapes titles, dates, witnesses and url", () => {
    const cap = (t: string) => t;
    // evidenceDate preferred, string + object witnesses, title present
    const a = mapOral(
      {
        id: 11,
        evidenceDate: "2024-05-01T09:00:00",
        witnesses: ["Dr Who", { name: "Jane Doe" }, { rank: 1 }],
        title: "  Session on X  ",
        url: " http://e/1 ",
      },
      cap,
    );
    expect(a).toEqual({
      id: 11,
      type: "oral",
      title: "Session on X",
      date: "2024-05-01",
      witnesses: ["Dr Who", "Jane Doe", "[object Object]"],
      url: "http://e/1",
    });
    // falls back to `date`, sessionTitle used, witnesses missing → null
    const b = mapOral({ date: "2023-01-02", sessionTitle: "Fallback title" }, cap);
    expect(b.date).toBe("2023-01-02");
    expect(b.title).toBe("Fallback title");
    expect(b.witnesses).toBeNull();
    expect(b.id).toBe(0);
    // neither title nor sessionTitle → default label; no date → null
    const c = mapOral({}, cap);
    expect(c.title).toBe("Oral evidence session");
    expect(c.date).toBeNull();
    // title present but non-string → String()
    const d = mapOral({ title: 123 }, cap);
    expect(d.title).toBe("123");
    // title present but null → String(null ?? "") = ""
    const e = mapOral({ title: null }, cap);
    expect(e.title).toBe("");
    // more than 10 witnesses → capped at 10
    const many = Array.from({ length: 15 }, (_, i) => `W${i}`);
    const f = mapOral({ witnesses: many }, cap);
    expect(f.witnesses).toHaveLength(10);
  });

  it("mapWritten shapes titles, dates and url", () => {
    const cap = (t: string) => t;
    const a = mapWritten({ id: 22, dateReceived: "2024-06-07T00:00:00", title: " Written A ", url: " http://w/2 " }, cap);
    expect(a).toEqual({ id: 22, type: "written", title: "Written A", date: "2024-06-07", witnesses: null, url: "http://w/2" });
    // date fallback, default title, non-string url → null
    const b = mapWritten({ date: "2022-02-02" }, cap);
    expect(b.date).toBe("2022-02-02");
    expect(b.title).toBe("Written evidence");
    expect(b.url).toBeNull();
    // title non-string → String()
    expect(mapWritten({ title: 9 }, cap).title).toBe("9");
    // no date at all → null
    expect(mapWritten({}, cap).date).toBeNull();
  });

  it("capTitle truncation is applied by the map functions via a cap fn", () => {
    const cap = (t: string) => (t.length > 5 ? t.slice(0, 5) + "…" : t);
    expect(mapOral({ title: "abcdefgh" }, cap).title).toBe("abcde…");
    expect(mapWritten({ title: "abcdefgh" }, cap).title).toBe("abcde…");
  });
});

// =====================================================================================
// committees_search_committees
// =====================================================================================
describe("committees_search_committees", () => {
  const COMMITTEES = {
    items: [
      { id: 1, name: "Defence Committee", house: 1 },
      { id: 2, name: "Treasury Committee", house: { name: "Commons" } },
      { id: "bad", name: "No-Id Committee", house: "Lords" }, // non-number id → 0
      { name: "Nameless" }, // missing name → "Unknown"
      "not-an-object", // skipped
    ],
  };

  it("lists all committees, defaults active_only, sets CommitteeStatus", async () => {
    const jsonGet = jsonRouter([{ match: "/Committees?", payload: COMMITTEES }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(await callTool(reg, "committees_search_committees", {}));

    expect(out.query).toBeNull();
    expect(out.house).toBeNull();
    expect(out.active_only).toBe(true);
    expect(out.total).toBe(4); // the string entry is skipped
    // active_only true → is_active true for every row
    expect(out.committees.every((c: any) => c.is_active === true)).toBe(true);
    // id coercion + url
    const byName = Object.fromEntries(out.committees.map((c: any) => [c.name, c]));
    expect(byName["Defence Committee"]).toMatchObject({ id: 1, house: "Commons", url: "https://committees.parliament.uk/committee/1/" });
    expect(byName["Treasury Committee"].house).toBe("Commons"); // house object → name
    expect(byName["No-Id Committee"]).toMatchObject({ id: 0, house: "Lords" }); // bad id → 0
    expect(byName["Nameless"].name).toBe("Nameless"); // reqStr fallback not hit here

    // request params: Take default 100, CommitteeStatus=Current, no House
    const url = jsonGet.mock.calls[0][0] as string;
    expect(url).toContain("Take=100");
    expect(url).toContain("CommitteeStatus=Current");
    expect(url).not.toContain("House=");
  });

  it("filters client-side by query (case-insensitive) and trims it in the echo", async () => {
    const jsonGet = jsonRouter([{ match: "/Committees?", payload: COMMITTEES }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(await callTool(reg, "committees_search_committees", { query: "  DEFENCE  " }));
    // NB: query is echoed trimmed, but the include() filter uses the raw (untrimmed) value.
    // "  defence  " is not a substring of "defence committee", so nothing matches.
    expect(out.query).toBe("DEFENCE");
    expect(out.total).toBe(0);
  });

  it("matches a query substring without surrounding whitespace", async () => {
    const jsonGet = jsonRouter([{ match: "/Committees?", payload: COMMITTEES }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(await callTool(reg, "committees_search_committees", { query: "committee" }));
    // "committee" is a substring of Defence/Treasury/No-Id Committee names, but not "Nameless".
    expect(out.total).toBe(3);
  });

  it("active_only=false sets is_active null and omits CommitteeStatus; house filter adds House code", async () => {
    const jsonGet = jsonRouter([{ match: "/Committees?", payload: COMMITTEES }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_committees", { active_only: false, house: "Lords", limit: 50 }),
    );
    expect(out.active_only).toBe(false);
    expect(out.house).toBe("Lords");
    expect(out.committees.every((c: any) => c.is_active === null)).toBe(true);

    const url = jsonGet.mock.calls[0][0] as string;
    expect(url).toContain("Take=50");
    expect(url).not.toContain("CommitteeStatus");
    expect(url).toContain("House=2"); // Lords → 2
  });

  it("handles Joint house code and Commons", async () => {
    const jsonGet = jsonRouter([{ match: "/Committees?", payload: { items: [] } }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    await callTool(reg, "committees_search_committees", { house: "Joint" });
    expect((jsonGet.mock.calls[0][0] as string)).toContain("House=0");

    const jsonGet2 = jsonRouter([{ match: "/Committees?", payload: { items: [] } }]);
    const reg2 = registerModule(registerCommittees, { jsonGet: jsonGet2 });
    await callTool(reg2, "committees_search_committees", { house: "Commons" });
    expect((jsonGet2.mock.calls[0][0] as string)).toContain("House=1");
  });

  it("empty upstream item set yields total 0", async () => {
    const jsonGet = jsonRouter([{ match: "/Committees?", payload: { items: [] } }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(await callTool(reg, "committees_search_committees", {}));
    expect(out.total).toBe(0);
    expect(out.committees).toEqual([]);
  });

  it("surfaces an upstream error with query=null in attempted", async () => {
    const jsonGet = vi.fn(async () => fetched("boom", { status: 500, ok: false }));
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_search_committees", {});
    expect(isErr(r)).toBe(true);
    const p = resultJson(r);
    expect(p.error_category).toBe("unknown"); // 500 → unknown per taxonomy
    expect(p.attempted).toBe("committees_search_committees(query=null)");
  });

  it("surfaces an upstream error with the quoted query in attempted (429 transient)", async () => {
    const jsonGet = vi.fn(async () => fetched("rate", { status: 429, ok: false }));
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_search_committees", { query: "tax" });
    expect(isErr(r)).toBe(true);
    const p = resultJson(r);
    expect(p).toMatchObject({ error_category: "transient", is_retryable: true });
    expect(p.attempted).toBe("committees_search_committees(query='tax')");
  });
});

// =====================================================================================
// committees_get_committee
// =====================================================================================
describe("committees_get_committee", () => {
  const DETAIL = { name: " Defence Committee ", house: 1, phone: " 020 ", email: " a@b " };
  const MEMBERS = {
    items: [
      { name: "Chair Person", memberInfo: { party: "Lab" }, roles: [{ role: { name: "Member", isChair: true } }] },
      { name: "Ordinary", memberInfo: { party: "Con" }, roles: [{ role: { name: "Member" } }] },
      "skip-me", // non-object → skipped
    ],
  };

  it("fetches detail + members in parallel and shapes the result", async () => {
    const jsonGet = jsonRouter([
      { match: "/Committees/5/Members", payload: MEMBERS },
      { match: "/Committees/5", payload: DETAIL },
    ]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(await callTool(reg, "committees_get_committee", { committee_id: 5 }));
    expect(out).toMatchObject({
      id: 5,
      name: "Defence Committee",
      house: "Commons",
      phone: "020",
      email: "a@b",
      url: "https://committees.parliament.uk/committee/5/",
    });
    expect(out.members).toHaveLength(2); // string member skipped
    expect(out.members[0]).toMatchObject({ name: "Chair Person", party: "Lab", role: "Chair" });
    expect(out.members[1]).toMatchObject({ role: "Member" });
  });

  it("defaults name/phone/email when the detail body is not an object", async () => {
    const jsonGet = jsonRouter([
      { match: "/Committees/9/Members", payload: { items: [] } },
      { match: "/Committees/9", payload: "not-an-object" },
    ]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(await callTool(reg, "committees_get_committee", { committee_id: 9 }));
    expect(out.name).toBe("Unknown");
    expect(out.phone).toBeNull();
    expect(out.email).toBeNull();
    expect(out.house).toBeNull();
    expect(out.members).toEqual([]);
  });

  it("errors (404 not_found) when detail fetch fails", async () => {
    const jsonGet = vi.fn(async (url: string) =>
      url.includes("/Members")
        ? fetched(JSON.stringify({ items: [] }), { contentType: "application/json" })
        : fetched("missing", { status: 404, ok: false }),
    );
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_get_committee", { committee_id: 404 });
    expect(isErr(r)).toBe(true);
    const p = resultJson(r);
    expect(p.error_category).toBe("not_found");
    expect(p.attempted).toBe("committees_get_committee(committee_id=404)");
  });

  it("errors when the members fetch fails", async () => {
    const jsonGet = vi.fn(async (url: string) =>
      url.includes("/Members")
        ? fetched("boom", { status: 500, ok: false })
        : fetched(JSON.stringify(DETAIL), { contentType: "application/json" }),
    );
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_get_committee", { committee_id: 7 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r).error_category).toBe("unknown");
  });
});

// =====================================================================================
// committees_search_evidence
// =====================================================================================
describe("committees_search_evidence", () => {
  const ORAL = {
    items: [
      { id: 1, title: "Oral one", evidenceDate: "2024-01-01", witnesses: ["W1"], url: "http://o/1" },
      { id: 2, title: "Oral two", evidenceDate: "2024-02-02", url: "http://o/2" },
    ],
  };
  const WRITTEN = {
    items: [{ id: 10, title: "Written one", dateReceived: "2024-03-03", url: "http://w/10" }],
  };

  it("evidence_type=oral returns only oral, has_more false when raw < limit", async () => {
    const jsonGet = jsonRouter([{ match: "/OralEvidence", payload: ORAL }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 3, evidence_type: "oral", limit: 20 }),
    );
    expect(out.evidence_type).toBe("oral");
    expect(out.returned).toBe(2);
    expect(out.has_more).toBe(false); // 2 raw !== 20 limit
    expect(out.evidence.every((e: any) => e.type === "oral")).toBe(true);
    // Skip/Take params
    const url = jsonGet.mock.calls[0][0] as string;
    expect(url).toContain("CommitteeId=3");
    expect(url).toContain("Skip=0");
    expect(url).toContain("Take=20");
  });

  it("evidence_type=oral flags has_more when raw === limit", async () => {
    const jsonGet = jsonRouter([{ match: "/OralEvidence", payload: ORAL }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 3, evidence_type: "oral", limit: 2 }),
    );
    expect(out.has_more).toBe(true); // 2 raw === 2 limit
    expect(out.offset).toBe(0);
  });

  it("evidence_type=written returns only written and honours offset", async () => {
    const jsonGet = jsonRouter([{ match: "/WrittenEvidence", payload: WRITTEN }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 4, evidence_type: "written", limit: 5, offset: 10 }),
    );
    expect(out.evidence_type).toBe("written");
    expect(out.returned).toBe(1);
    expect(out.has_more).toBe(false);
    expect(out.evidence[0].type).toBe("written");
    expect((jsonGet.mock.calls[0][0] as string)).toContain("Skip=10");
  });

  it("evidence_type=both splits the limit across oral and written", async () => {
    const jsonGet = jsonRouter([
      { match: "/OralEvidence", payload: ORAL },
      { match: "/WrittenEvidence", payload: WRITTEN },
    ]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 6, evidence_type: "both", limit: 20 }),
    );
    expect(out.returned).toBe(3); // 2 oral + 1 written
    expect(out.evidence.map((e: any) => e.type)).toEqual(["oral", "oral", "written"]);
    // oralTake = floor(21/2)=10, writtenTake = floor(20/2)=10; neither raw hits its take
    expect(out.has_more).toBe(false);

    const oralUrl = jsonGet.mock.calls.find((c) => (c[0] as string).includes("/OralEvidence"))![0] as string;
    const writtenUrl = jsonGet.mock.calls.find((c) => (c[0] as string).includes("/WrittenEvidence"))![0] as string;
    expect(oralUrl).toContain("Take=10");
    expect(writtenUrl).toContain("Take=10");
  });

  it("evidence_type=both flags has_more when the oral page fills its take", async () => {
    const twoOral = { items: [ORAL.items[0], ORAL.items[1]] };
    const jsonGet = jsonRouter([
      { match: "/OralEvidence", payload: twoOral },
      { match: "/WrittenEvidence", payload: { items: [] } },
    ]);
    const reg = registerModule(registerCommittees, { jsonGet });
    // limit 4 → oralTake = floor(5/2)=2, writtenTake = floor(4/2)=2; oral raw 2 === 2 → has_more
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 6, evidence_type: "both", limit: 4 }),
    );
    expect(out.has_more).toBe(true);
  });

  it("evidence_type=both flags has_more when only the written page fills its take", async () => {
    const twoWritten = { items: [WRITTEN.items[0], { id: 11, title: "Written two", dateReceived: "2024-04-04" }] };
    const jsonGet = jsonRouter([
      { match: "/OralEvidence", payload: { items: [] } },
      { match: "/WrittenEvidence", payload: twoWritten },
    ]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 6, evidence_type: "both", limit: 4 }),
    );
    expect(out.has_more).toBe(true); // written raw 2 === writtenTake 2
  });

  it("caps long titles at max_title_chars with a truncation marker", async () => {
    const longTitle = "x".repeat(400);
    const jsonGet = jsonRouter([{ match: "/OralEvidence", payload: { items: [{ id: 1, title: longTitle }] } }]);
    const reg = registerModule(registerCommittees, { jsonGet });
    const out = resultJson(
      await callTool(reg, "committees_search_evidence", { committee_id: 3, evidence_type: "oral", max_title_chars: 50 }),
    );
    expect(out.evidence[0].title).toBe("x".repeat(50) + " …[truncated]");
  });

  it("wraps an oral upstream failure with the oral attempted context", async () => {
    const jsonGet = vi.fn(async (url: string) =>
      url.includes("/OralEvidence") ? fetched("boom", { status: 500, ok: false }) : fetched(JSON.stringify(WRITTEN), { contentType: "application/json" }),
    );
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_search_evidence", { committee_id: 3, evidence_type: "oral" });
    expect(isErr(r)).toBe(true);
    const p = resultJson(r);
    expect(p.error_category).toBe("unknown");
    expect(p.attempted).toBe("committees_search_evidence(committee_id=3, evidence_type='oral')");
  });

  it("wraps a written upstream failure with the written attempted context (404)", async () => {
    const jsonGet = vi.fn(async () => fetched("missing", { status: 404, ok: false }));
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_search_evidence", { committee_id: 8, evidence_type: "written" });
    expect(isErr(r)).toBe(true);
    const p = resultJson(r);
    expect(p.error_category).toBe("not_found");
    expect(p.attempted).toBe("committees_search_evidence(committee_id=8, evidence_type='written')");
  });

  it("propagates a non-EvidenceFetchError (malformed JSON body) through the generic catch", async () => {
    // 200 OK but body is not valid JSON → jsonOf() throws OUTSIDE the inner try,
    // so it is not wrapped as an EvidenceFetchError and hits the generic branch.
    const jsonGet = vi.fn(async () => fetched("<<<not json>>>", { status: 200, ok: true, contentType: "application/json" }));
    const reg = registerModule(registerCommittees, { jsonGet });
    const r = await callTool(reg, "committees_search_evidence", { committee_id: 2, evidence_type: "oral" });
    expect(isErr(r)).toBe(true);
    const p = resultJson(r);
    expect(p.attempted).toBe("committees_search_evidence(committee_id=2)"); // generic, non-branch-specific attempted
  });

  it("registers all three tools", () => {
    const reg = registerModule(registerCommittees);
    expect([...reg.tools.keys()].sort()).toEqual([
      "committees_get_committee",
      "committees_search_committees",
      "committees_search_evidence",
    ]);
    expect(reg.resources).toHaveLength(0);
    expect(reg.prompts.size).toBe(0);
  });
});
