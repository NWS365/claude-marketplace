import { describe, it, expect, vi } from "vitest";
import { registerBills } from "../../src/modules/bills/index.js";
import { parseBillSummary, parseBillDetail, HOUSE_MAP, STAGE_ID_MAP, BILLS_BASE } from "../../src/modules/bills/parsers.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";

const json = (obj: unknown) => fetched(JSON.stringify(obj), { contentType: "application/json" });

// ------------------------------------------------------------------ parsers
describe("bills/parsers — parseBillSummary", () => {
  it("maps a full item with an object currentStage (description)", () => {
    const s = parseBillSummary({
      billId: 42,
      shortTitle: "  Online Safety Bill  ",
      longTitle: " A Bill to make provision ",
      currentHouse: { name: "Commons" },
      currentStage: { description: "Second reading", stageName: "2R" },
      isAct: false,
    });
    expect(s).toEqual({
      id: 42,
      short_title: "Online Safety Bill",
      long_title: "A Bill to make provision",
      current_house: "Commons",
      current_stage: "Second reading",
      is_act: false,
      url: "https://bills.parliament.uk/bills/42",
    });
  });

  it("falls back to stageName, string house, and defaults", () => {
    const s = parseBillSummary({
      shortTitle: "X",
      currentHouse: "Lords",
      currentStage: { stageName: "Committee" },
    });
    expect(s.id).toBe(0); // billId missing -> 0
    expect(s.current_house).toBe("Lords");
    expect(s.current_stage).toBe("Committee");
    expect(s.is_act).toBe(false);
    expect(s.long_title).toBeNull();
  });

  it("handles a missing/short title and a non-object currentStage", () => {
    const s = parseBillSummary({ currentStage: "not-an-object" });
    expect(s.short_title).toBe("Unknown");
    expect(s.current_stage).toBeNull();
    expect(s.current_house).toBeNull();
  });
});

describe("bills/parsers — parseBillDetail", () => {
  it("maps sponsors (member.name, sponsor.name, and Unknown fallbacks)", () => {
    const d = parseBillDetail(
      {
        billId: 7,
        shortTitle: "Finance Bill",
        sponsors: [
          { member: { name: "  Jane MP  ", party: " Lab ", house: { name: "Commons" } } },
          { name: "Top-level Name" }, // no member object -> sponsor.name
          { member: {} }, // neither -> "Unknown"
          { member: { name: null } }, // null name -> "Unknown"
        ],
      },
      5000,
    );
    expect(d.sponsors[0]).toEqual({ name: "Jane MP", party: "Lab", house: "Commons" });
    expect(d.sponsors[1]!.name).toBe("Top-level Name");
    expect(d.sponsors[2]!.name).toBe("Unknown");
    expect(d.sponsors[3]!.name).toBe("Unknown");
    expect(d.royal_assent_date).toBeNull();
  });

  it("maps currentStage with a valid sitting date", () => {
    const d = parseBillDetail(
      {
        billId: 8,
        currentStage: {
          description: "Report stage",
          house: "Commons",
          stageSittings: [{ date: "2024-05-05T10:00:00" }],
        },
      },
      5000,
    );
    expect(d.stages[0]).toMatchObject({ name: "Report stage", house: "Commons", date: "2024-05-05", is_current: true });
    expect(d.current_stage).toBe("Report stage");
  });

  it("ignores an invalid sitting date and falls back to stageName / Unknown", () => {
    const bad = parseBillDetail(
      { currentStage: { stageName: "Committee", stageSittings: [{ date: "2024-13-45" }] } },
      5000,
    );
    expect(bad.stages[0]!.date).toBeNull();
    expect(bad.stages[0]!.name).toBe("Committee");

    const noNames = parseBillDetail({ currentStage: { stageSittings: [] } }, 5000);
    expect(noNames.stages[0]!.name).toBe("Unknown");

    const nonStringDate = parseBillDetail({ currentStage: { description: "X", stageSittings: [{ date: 123 }] } }, 5000);
    expect(nonStringDate.stages[0]!.date).toBeNull();
  });

  it("truncates a long summary and reports the original length", () => {
    const long = "a".repeat(6000);
    const d = parseBillDetail({ summary: long }, 5000);
    expect(d.summary_truncated).toBe(true);
    expect(d.summary_original_length).toBe(6000);
    expect(d.summary!.endsWith("…[truncated]")).toBe(true);
  });

  it("keeps a short summary and handles a missing summary", () => {
    const kept = parseBillDetail({ summary: "  short  " }, 5000);
    expect(kept.summary_truncated).toBe(false);
    expect(kept.summary).toBe("short");

    const none = parseBillDetail({}, 5000);
    expect(none.summary).toBeNull();
    expect(none.summary_original_length).toBe(0);
    expect(none.stages).toEqual([]);
  });
});

describe("bills/parsers — constants", () => {
  it("exposes house and stage maps", () => {
    expect(HOUSE_MAP).toMatchObject({ Commons: 1, Lords: 2 });
    expect(STAGE_ID_MAP.committee).toContain(48);
  });
});

// -------------------------------------------------------------- bills_search_bills
describe("bills_search_bills", () => {
  const FEED = {
    totalResults: 3,
    items: [
      { billId: 1, shortTitle: "Bill One", currentStage: { description: "1R" } },
      { billId: 2, shortTitle: "Bill Two", isAct: true },
    ],
  };

  it("returns a page and computes has_more from totalResults", async () => {
    const jsonGet = vi.fn(async () => json(FEED));
    const reg = registerModule(registerBills, { jsonGet });
    const out = resultJson(await callTool(reg, "bills_search_bills", { query: "  safety  ", limit: 20, offset: 0 }));
    expect(out.query).toBe("safety");
    expect(out.returned).toBe(2);
    expect(out.total).toBe(3);
    expect(out.has_more).toBe(true); // 0 + 2 < 3
    expect(out.bills[1]).toMatchObject({ id: 2, is_act: true });
  });

  it("forwards SearchTerm/Take/Skip/Session/CurrentHouse/BillStage params", async () => {
    const jsonGet = vi.fn(async () => json(FEED));
    const reg = registerModule(registerBills, { jsonGet });
    await callTool(reg, "bills_search_bills", {
      query: "financial services", session: 40, house: "Commons", stage: "committee", offset: 5, limit: 10,
    });
    const url = jsonGet.mock.calls[0]![0] as string;
    expect(url.startsWith(`${BILLS_BASE}/Bills?`)).toBe(true);
    expect(url).toContain("SearchTerm=financial+services");
    expect(url).toContain("Take=10");
    expect(url).toContain("Skip=5");
    expect(url).toContain("Session=40");
    expect(url).toContain("CurrentHouse=1");
    expect(url).toContain("BillStage=8"); // committee -> [8,3,48,49]
    expect(url).toContain("BillStage=49");
  });

  it("omits CurrentHouse when house is 'All'", async () => {
    const jsonGet = vi.fn(async () => json(FEED));
    const reg = registerModule(registerBills, { jsonGet });
    await callTool(reg, "bills_search_bills", { query: "x", house: "All" });
    expect(jsonGet.mock.calls[0]![0]).not.toContain("CurrentHouse");
  });

  it("falls back to length===limit when total is absent, and empty items", async () => {
    const jsonGet = vi.fn(async () => json({ items: "not-an-array" }));
    const reg = registerModule(registerBills, { jsonGet });
    const out = resultJson(await callTool(reg, "bills_search_bills", { query: "x", limit: 20 }));
    expect(out.total).toBeNull();
    expect(out.returned).toBe(0);
    expect(out.has_more).toBe(false); // 0 !== 20
  });

  it("surfaces an upstream error", async () => {
    const jsonGet = vi.fn(async () => json({}));
    const reg = registerModule(registerBills, { jsonGet: vi.fn(async () => fetched("nope", { status: 500, ok: false })) });
    void jsonGet;
    const r = await callTool(reg, "bills_search_bills", { query: "x" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r).error_category).toBe("unknown");
  });
});

// ----------------------------------------------------------------- bills_get_bill
describe("bills_get_bill", () => {
  it("returns full bill detail", async () => {
    const jsonGet = vi.fn(async () => json({ billId: 9, shortTitle: "Finance Bill", summary: "text", isAct: true }));
    const reg = registerModule(registerBills, { jsonGet });
    const out = resultJson(await callTool(reg, "bills_get_bill", { bill_id: 9 }));
    expect(out).toMatchObject({ id: 9, short_title: "Finance Bill", is_act: true, url: "https://bills.parliament.uk/bills/9" });
    expect(jsonGet.mock.calls[0]![0]).toBe(`${BILLS_BASE}/Bills/9`);
  });

  it("surfaces an upstream error", async () => {
    const reg = registerModule(registerBills, { jsonGet: vi.fn(async () => fetched("no", { status: 404, ok: false })) });
    const r = await callTool(reg, "bills_get_bill", { bill_id: 999 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r).error_category).toBe("not_found");
  });
});
