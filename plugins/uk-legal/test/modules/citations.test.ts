import { describe, it, expect, vi, afterEach } from "vitest";
import { registerCitations } from "../../src/modules/citations/index.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";
import {
  compilePatterns,
  normaliseDivision,
  courtIsAmbiguous,
  resolveNeutralCitation,
  resolveSi,
  resolveLegislation,
  buildOscola,
  parseCitationFromMatch,
  extractAllCitations,
  TNA_BASE,
  LEGISLATION_BASE,
} from "../../src/modules/citations/parsers.js";

afterEach(() => vi.useRealTimers());

// --------------------------------------------------------------- parsers (pure)
describe("citations/parsers", () => {
  it("normaliseDivision keeps acronym divisions upper-cased and title-cases word divisions", () => {
    // Acronyms must not be mangled (the old titleCase turned KB -> "Kb").
    expect(normaliseDivision("kb")).toBe("KB");
    expect(normaliseDivision("IPEC")).toBe("IPEC");
    expect(normaliseDivision("tcc")).toBe("TCC");
    expect(normaliseDivision("iac")).toBe("IAC");
    // Word divisions title-case.
    expect(normaliseDivision("comm")).toBe("Comm");
    expect(normaliseDivision("ADMIN")).toBe("Admin");
    // Unknown tokens fall back to upper-case.
    expect(normaliseDivision("xyz")).toBe("XYZ");
  });

  it("courtIsAmbiguous flags bare EWHC/UKUT/UKFTT", () => {
    expect(courtIsAmbiguous("EWHC")).toBe(true);
    expect(courtIsAmbiguous(" ewhc ")).toBe(true);
    expect(courtIsAmbiguous("EWHC (KB)")).toBe(false);
    expect(courtIsAmbiguous("UKSC")).toBe(false);
  });

  it("resolveNeutralCitation maps known courts and returns null otherwise", () => {
    expect(resolveNeutralCitation(2024, "UKSC", 12)).toBe(`${TNA_BASE}/uksc/2024/12`);
    expect(resolveNeutralCitation(2024, "EWHC (KB)", 1)).toBe(`${TNA_BASE}/ewhc/kb/2024/1`);
    expect(resolveNeutralCitation(2024, "EWHC", 1)).toBeNull();
  });

  it("resolveSi and resolveLegislation build the expected URLs", () => {
    expect(resolveSi(2018, 1234)).toBe(`${LEGISLATION_BASE}/uksi/2018/1234`);
    expect(resolveLegislation("Companies Act 2006")).toBe(`${LEGISLATION_BASE}/search?title=Companies+Act+2006`);
  });

  it("buildOscola formats each citation type", () => {
    expect(buildOscola("neutral", 2024, "UKSC", 12, null, null, null, null, null, null, null, null)).toBe("[2024] UKSC 12");
    // unmapped court falls back to the raw key
    expect(buildOscola("neutral", 2024, "EWHC", 5, null, null, null, null, null, null, null, null)).toBe("[2024] EWHC 5");
    // Parenthetical divisions follow the number in OSCOLA, and acronyms keep their case.
    expect(buildOscola("neutral", 2024, "EWHC (KB)", 123, null, null, null, null, null, null, null, null)).toBe("[2024] EWHC 123 (KB)");
    expect(buildOscola("neutral", 2024, "EWHC (CH)", 7, null, null, null, null, null, null, null, null)).toBe("[2024] EWHC 7 (Ch)");
    expect(buildOscola("neutral", 2024, "UKUT (IAC)", 42, null, null, null, null, null, null, null, null)).toBe("[2024] UKUT 42 (IAC)");
    // EWCA Civ/Crim is not parenthetical — division stays before the number.
    expect(buildOscola("neutral", 2023, "EWCA CIV", 450, null, null, null, null, null, null, null, null)).toBe("[2023] EWCA Civ 450");
    expect(buildOscola("law_report", 2024, null, null, "WLR", 1, 100, null, null, null, null, null)).toBe("[2024] 1 WLR 100");
    expect(buildOscola("law_report", 2024, null, null, "AC", null, 55, null, null, null, null, null)).toBe("[2024] AC 55");
    expect(buildOscola("legislation", null, null, null, null, null, null, "Companies Act 2006", "47", null, null, null)).toBe("s.47 Companies Act 2006");
    expect(buildOscola("si", null, null, null, null, null, null, null, null, 2018, 1234, null)).toBe("SI 2018/1234");
    expect(buildOscola("eu_retained", null, null, null, null, null, null, null, null, null, null, "Regulation (EU) 2016/679")).toBe("Regulation (EU) 2016/679");
    expect(buildOscola("eu_retained", null, null, null, null, null, null, null, null, null, null, null)).toBe("");
  });

  it("parseCitationFromMatch fills fields per type", () => {
    const p = compilePatterns();
    const neutral = [...("[2024] UKSC 12".matchAll(p.neutral))][0]!;
    expect(parseCitationFromMatch(neutral, "neutral")).toMatchObject({ year: 2024, court: "UKSC", number: 12, confidence: 1.0 });

    const ambiguous = [...("[2024] EWHC 100".matchAll(p.neutral))][0]!;
    expect(parseCitationFromMatch(ambiguous, "neutral")).toMatchObject({ court: "EWHC", confidence: 0.5, resolved_url: null });

    const withDivision = [...("[2024] EWHC 100 (KB)".matchAll(p.neutral))][0]!;
    expect(parseCitationFromMatch(withDivision, "neutral")).toMatchObject({
      court: "EWHC (KB)",
      confidence: 1.0,
      resolved_url: `${TNA_BASE}/ewhc/kb/2024/100`,
    });

    // An unrecognised division does not resolve, so it is surfaced as ambiguous (0.5), not confident.
    const badDivision = [...("[2024] EWHC 100 (Xyz)".matchAll(p.neutral))][0]!;
    expect(parseCitationFromMatch(badDivision, "neutral")).toMatchObject({
      court: "EWHC (XYZ)",
      confidence: 0.5,
      resolved_url: null,
    });

    const report = [...("[2024] 1 WLR 100".matchAll(p.law_report))][0]!;
    expect(parseCitationFromMatch(report, "law_report")).toMatchObject({ report_series: "WLR", volume: 1, page: 100 });

    const leg = [...("s.47 Companies Act 2006".matchAll(p.legislation))][0]!;
    expect(parseCitationFromMatch(leg, "legislation")).toMatchObject({ section: "47", legislation_title: "Companies Act 2006", year: 2006 });

    const si = [...("SI 2018/1234".matchAll(p.si))][0]!;
    expect(parseCitationFromMatch(si, "si")).toMatchObject({ si_year: 2018, si_number: 1234, confidence: 1.0 });

    const eu = [...("Regulation (EU) 2016/679".matchAll(p.eu_retained))][0]!;
    expect(parseCitationFromMatch(eu, "eu_retained")).toMatchObject({ year: 2016, number: 679 });
  });

  it("extractAllCitations dedups overlaps and splits by confidence", () => {
    const [confident, ambiguous] = extractAllCitations(
      "See [2024] UKSC 12; s.47 Companies Act 2006; SI 2018/1234; [2024] EWHC 90.",
      compilePatterns(),
    );
    expect(confident.map((c) => c.type)).toEqual(expect.arrayContaining(["neutral", "legislation", "si"]));
    expect(ambiguous.some((c) => c.court === "EWHC")).toBe(true);
  });

  it("does not match Scottish or Northern Irish court codes (not on Find Case Law)", () => {
    // TNA Find Case Law hosts England & Wales only. Scottish (CSOH/CSIH) and NI
    // (NICA/NIQB) codes are dropped from the pattern: recognising them would only
    // yield confident-looking hits that resolve to URLs which 404.
    const [confident, ambiguous] = extractAllCitations(
      "[2024] CSOH 12; [2024] CSIH 3; [2024] NICA 5; [2024] NIQB 7",
      compilePatterns(),
    );
    expect(confident).toHaveLength(0);
    expect(ambiguous).toHaveLength(0);
  });
});

// --------------------------------------------------------------- citations_parse
describe("citations_parse", () => {
  it("parses citations from free text (pure, no network)", async () => {
    const reg = registerModule(registerCitations);
    const r = await callTool(reg, "citations_parse", { text: "[2024] UKSC 12 and SI 2018/1234", disambiguate: false });
    const out = resultJson(r);
    expect(out.citations.length).toBeGreaterThanOrEqual(2);
    expect(out.text_length).toBe("[2024] UKSC 12 and SI 2018/1234".length);
    expect(typeof out.parse_duration_ms).toBe("number");
  });

  it("disambiguate=true promotes a resolved ambiguous citation to confident", async () => {
    const sample = vi.fn(async () => "KB");
    const reg = registerModule(registerCitations, { sample });
    const r = await callTool(reg, "citations_parse", { text: "[2024] EWHC 90", disambiguate: true });
    const out = resultJson(r);
    expect(out.ambiguous).toHaveLength(0);
    expect(out.citations.some((c: any) => c.court === "EWHC (KB)")).toBe(true);
    expect(sample).toHaveBeenCalled();
  });

  it("disambiguate keeps a citation ambiguous when sampling declines/invalid", async () => {
    for (const reply of [null, "UNKNOWN", "not-a-division"]) {
      const reg = registerModule(registerCitations, { sample: vi.fn(async () => reply) });
      const out = resultJson(await callTool(reg, "citations_parse", { text: "[2024] EWHC 90", disambiguate: true }));
      expect(out.ambiguous.length).toBe(1);
    }
  });

  it("disambiguate fails soft when sampling throws", async () => {
    const reg = registerModule(registerCitations, {
      sample: vi.fn(async () => {
        throw new Error("no sampling");
      }),
    });
    const out = resultJson(await callTool(reg, "citations_parse", { text: "[2024] EWHC 90", disambiguate: true }));
    expect(out.ambiguous.length).toBe(1);
  });
});

// ------------------------------------------------------------- citations_resolve
describe("citations_resolve", () => {
  it("verifies a neutral citation via TNA HEAD (200 keeps confidence)", async () => {
    const head = vi.fn(async () => ({ status: 200, ok: true }));
    const reg = registerModule(registerCitations, { head });
    const out = resultJson(await callTool(reg, "citations_resolve", { citation: "[2024] UKSC 12" }));
    expect(out.confidence).toBe(1.0);
    expect(head).toHaveBeenCalledOnce();
  });

  it("sets confidence 0.0 when TNA reports the document absent", async () => {
    const head = vi.fn(async () => ({ status: 404, ok: false }));
    const reg = registerModule(registerCitations, { head });
    const out = resultJson(await callTool(reg, "citations_resolve", { citation: "[2024] UKSC 12" }));
    expect(out.confidence).toBe(0.0);
  });

  it("resolves a non-neutral citation without a HEAD check", async () => {
    const head = vi.fn();
    const reg = registerModule(registerCitations, { head });
    const out = resultJson(await callTool(reg, "citations_resolve", { citation: "SI 2018/1234" }));
    expect(out.type).toBe("si");
    expect(head).not.toHaveBeenCalled();
  });

  it("errors when no citation is recognised", async () => {
    const reg = registerModule(registerCitations);
    const r = await callTool(reg, "citations_resolve", { citation: "just some prose" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r).error_category).toBe("unknown");
  });

  it("retries the HEAD check once and succeeds", async () => {
    vi.useFakeTimers();
    const head = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({ status: 200, ok: true });
    const reg = registerModule(registerCitations, { head });
    const p = callTool(reg, "citations_resolve", { citation: "[2024] UKSC 12" });
    await vi.runAllTimersAsync();
    const out = resultJson(await p);
    expect(out.confidence).toBe(1.0);
    expect(head).toHaveBeenCalledTimes(2);
  });

  it("returns a retryable transient when the HEAD check fails after retry", async () => {
    vi.useFakeTimers();
    const head = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const reg = registerModule(registerCitations, { head });
    const p = callTool(reg, "citations_resolve", { citation: "[2024] UKSC 12" });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});

// ------------------------------------------------------------- citations_network
describe("citations_network", () => {
  const JUDGMENT = `<akn>[2024] UKSC 12 cites [2020] UKSC 1; s.47 Companies Act 2006; SI 2018/1234; Regulation (EU) 2016/679; [2019] 1 WLR 5</akn>`;

  it("groups, dedups and sorts citations found in the judgment XML", async () => {
    const xmlGet = vi.fn(async () => fetched(JUDGMENT));
    const reg = registerModule(registerCitations, { xmlGet });
    const out = resultJson(await callTool(reg, "citations_network", { case_uri: "/uksc/2024/12" }));
    expect(out.case_uri).toBe("uksc/2024/12"); // leading slash stripped
    expect(out.neutral_citations).toEqual(["[2020] UKSC 1", "[2024] UKSC 12"]);
    expect(out.legislation_refs.length).toBe(1);
    expect(out.si_refs.length).toBe(1);
    expect(out.eu_refs.length).toBe(1);
    expect(out.total_citations).toBe(out.neutral_citations.length + out.legislation_refs.length + out.si_refs.length + out.eu_refs.length + out.law_report_refs.length);
  });

  it("surfaces an upstream HTTP error", async () => {
    const xmlGet = vi.fn(async () => fetched("not found", { status: 404, ok: false }));
    const reg = registerModule(registerCitations, { xmlGet });
    const r = await callTool(reg, "citations_network", { case_uri: "uksc/2024/99" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r).error_category).toBe("not_found");
  });
});

// --------------------------------------------------------- citations_format_oscola
describe("citations_format_oscola", () => {
  const reg = () => registerModule(registerCitations);

  it("refuses to format a confidence-0.0 citation", async () => {
    const out = resultJson(await callTool(reg(), "citations_format_oscola", { citation_type: "neutral", confidence: 0.0 }));
    expect(out.status).toBe("upstream_bad_request");
    expect(out.detail).toMatch(/absent/);
  });

  it("refuses a neutral citation with no resolved_url", async () => {
    const out = resultJson(await callTool(reg(), "citations_format_oscola", { citation_type: "neutral", confidence: 1.0, resolved_url: null }));
    expect(out.status).toBe("upstream_bad_request");
    expect(out.detail).toMatch(/ambiguous or unsupported/);
  });

  it("formats each citation type on the happy path", async () => {
    const neutral = resultJson(await callTool(reg(), "citations_format_oscola", {
      citation_type: "neutral", confidence: 1.0, resolved_url: "https://x", year: 2024, court: "UKSC", number: 12,
    }));
    expect(neutral).toMatchObject({ status: "ok", oscola: "[2024] UKSC 12" });

    const report = resultJson(await callTool(reg(), "citations_format_oscola", {
      citation_type: "law_report", confidence: 0.9, year: 2024, report_series: "WLR", volume: 1, page: 100,
    }));
    expect(report.oscola).toBe("[2024] 1 WLR 100");

    const leg = resultJson(await callTool(reg(), "citations_format_oscola", {
      citation_type: "legislation", confidence: 0.95, section: "47", legislation_title: "Companies Act 2006",
    }));
    expect(leg.oscola).toBe("s.47 Companies Act 2006");

    const si = resultJson(await callTool(reg(), "citations_format_oscola", {
      citation_type: "si", confidence: 1.0, si_year: 2018, si_number: 1234,
    }));
    expect(si.oscola).toBe("SI 2018/1234");

    const eu = resultJson(await callTool(reg(), "citations_format_oscola", {
      citation_type: "eu_retained", confidence: 0.9, raw: "Regulation (EU) 2016/679",
    }));
    expect(eu.oscola).toBe("Regulation (EU) 2016/679");
  });

  it("validation-errors when required fields are missing for the type", async () => {
    const cases = [
      { citation_type: "neutral", confidence: 1.0, resolved_url: "https://x" },
      { citation_type: "law_report", confidence: 0.9 },
      { citation_type: "legislation", confidence: 0.95 },
      { citation_type: "si", confidence: 1.0 },
      { citation_type: "eu_retained", confidence: 0.9 },
    ];
    for (const c of cases) {
      const out = resultJson(await callTool(reg(), "citations_format_oscola", c));
      expect(out.status).toBe("upstream_bad_request");
    }
  });
});
