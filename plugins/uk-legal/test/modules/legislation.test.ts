import { describe, it, expect, vi } from "vitest";
import { registerLegislation } from "../../src/modules/legislation/index.js";
import {
  reprStr, normaliseSectionId, parseSearchAtom, parseClmlSection, parseHtmlSection, parseTocXml, jurisdictionCaveat, LEGISLATION_BASE,
} from "../../src/modules/legislation/parsers.js";
import { registerModule, callTool, resultJson, isErr, resourceByTemplate, fetched } from "../_harness.js";
import { LegislationUpstreamError } from "../../src/shared/envelope.js";

const xml = (t: string) => fetched(t, { contentType: "application/xml" });
const html = (t: string) => fetched(t, { contentType: "text/html" });

const LEG = 'xmlns="http://www.legislation.gov.uk/namespaces/legislation"';
const UKM = 'xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"';

// ----------------------------------------------------------------- Atom search
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:os="http://a9.com/-/spec/opensearch/1.1/" xmlns:h="http://www.w3.org/1999/xhtml">
  <os:totalResults>4</os:totalResults>
  <entry><title>Housing Act 1988</title><id>http://www.legislation.gov.uk/id/ukpga/1988/50</id></entry>
  <entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><span xml:lang="cy">Deddf</span><span xml:lang="en">Welsh Act 2020</span></div></title><id>http://www.legislation.gov.uk/id/asp/2020/3</id></entry>
  <entry><title>Some Old Act 1955</title><id>http://www.legislation.gov.uk/id/ukpga/Eliz2/5-6/31</id></entry>
  <entry><title>Weird</title><id>http://example.com/nonsense</id></entry>
</feed>`;

describe("legislation/parsers — jurisdictionCaveat", () => {
  it("flags Scottish, NI, and Welsh legislation and is null for UK-wide types", () => {
    expect(jurisdictionCaveat("asp")).toMatch(/Scottish/);
    expect(jurisdictionCaveat("ssi")).toMatch(/Scottish/);
    expect(jurisdictionCaveat("asp")).toMatch(/cannot retrieve Scottish case law|NOT Scottish case law/);
    expect(jurisdictionCaveat("nia")).toMatch(/Northern Ireland/);
    expect(jurisdictionCaveat("asc")).toMatch(/Welsh/);
    expect(jurisdictionCaveat("anaw")).toMatch(/Welsh/);
    expect(jurisdictionCaveat("ukpga")).toBeNull();
    expect(jurisdictionCaveat("uksi")).toBeNull();
    expect(jurisdictionCaveat(" ASP ")).toMatch(/Scottish/); // trimmed + case-insensitive
  });
});

describe("legislation/parsers — parseSearchAtom", () => {
  it("parses plain, xhtml, regnal, and unknown entries", () => {
    const out = parseSearchAtom(ATOM);
    expect(out.total).toBe(4);
    expect(out.coverage_note).toBeNull(); // the parser leaves the note to the tool handler
    expect(out.results[0]).toMatchObject({ title: "Housing Act 1988", type: "ukpga", year: 1988, number: 50 });
    expect(out.results[0]!.next_steps.toc).toContain("legislation://ukpga/1988/50/toc");
    expect(out.results[1]!.title).toBe("Welsh Act 2020"); // xhtml en span
    expect(out.results[2]).toMatchObject({ type: "ukpga", number: 31, year: 1955 }); // regnal id, year from title
    expect(out.results[3]).toMatchObject({ type: "unknown", year: 0, number: 0 });
    expect(out.results[3]!.next_steps).toEqual({}); // unknown -> no hints
  });

  it("xhtml title falls back to any span, then Unknown", () => {
    const anySpan = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:h="http://www.w3.org/1999/xhtml"><entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><span>OnlySpan</span></div></title><id>x</id></entry></feed>`;
    expect(parseSearchAtom(anySpan).results[0]!.title).toBe("OnlySpan");
    const noSpan = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:h="http://www.w3.org/1999/xhtml"><entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"></div></title><id>x</id></entry></feed>`;
    expect(parseSearchAtom(noSpan).results[0]!.title).toBe("Unknown");
    const noTitle = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id></entry></feed>`;
    expect(parseSearchAtom(noTitle).results[0]!.title).toBe("Unknown");
  });
});

// ------------------------------------------------------------- normaliseSectionId
describe("legislation/parsers — normaliseSectionId", () => {
  it("strips prefixes and title suffixes", () => {
    expect(normaliseSectionId("section-47")).toBe("47");
    expect(normaliseSectionId("47: Definitions")).toBe("47");
    expect(normaliseSectionId("article-5")).toBe("5");
    expect(normaliseSectionId("regulation-3")).toBe("3");
    expect(normaliseSectionId("  12A ")).toBe("12A");
  });
  it("reprStr wraps in single quotes", () => {
    expect(reprStr("x")).toBe("'x'");
  });
});

// ------------------------------------------------------------- parseClmlSection
describe("legislation/parsers — parseClmlSection", () => {
  it("parses a P1group section with extent, in-force, version date, and title", () => {
    const doc = `<Legislation ${LEG} ${UKM} >
      <Metadata><ukm:EnactmentDate Date="2006-11-08"/></Metadata>
      <Body>
        <P1group id="section-47" RestrictExtent="E+W" RestrictStartDate="2009-10-01">
          <Title>Company records</Title>
          <ukm:InForce Applied="false" Prospective="false"/>
          <P1><Text>The rules about records.</Text></P1>
        </P1group>
      </Body>
    </Legislation>`;
    const s = parseClmlSection(doc, "47", 10000);
    expect(s.title).toBe("Company records");
    expect(s.extent).toEqual(["England", "Wales"]);
    expect(s.in_force).toBe(true); // applied false, prospective false -> !false
    expect(s.prospective).toBe(false);
    expect(s.version_date).toBe("2009-10-01");
    expect(s.content).toContain("records");
    expect(s.source_format).toBe("xml");
  });

  it("finds a section by P1 id and promotes to its P1group parent", () => {
    const doc = `<Legislation ${LEG} ${UKM}><Body><P1group RestrictExtent="S"><P1 id="section-2"><Text>t</Text></P1></P1group></Body></Legislation>`;
    const s = parseClmlSection(doc, "2", 10000);
    expect(s.extent).toEqual(["Scotland"]); // from the P1group ancestor
  });

  it("treats a repealed section (Repeal in Title) as not in force", () => {
    const doc = `<Legislation ${LEG} ${UKM}><Body><P1group id="section-3"><Title>Old <Repeal>repealed</Repeal></Title></P1group></Body></Legislation>`;
    const s = parseClmlSection(doc, "3", 10000);
    expect(s.in_force).toBe(false);
    expect(s.prospective).toBe(false);
  });

  it("honours Applied=true and Prospective=true", () => {
    const applied = `<Legislation ${LEG} ${UKM}><Body><P1group id="section-4"><Title>T</Title><ukm:InForce Applied="true"/></P1group></Body></Legislation>`;
    expect(parseClmlSection(applied, "4", 10000).in_force).toBe(true);
    const prospective = `<Legislation ${LEG} ${UKM}><Body><P1group id="section-5"><Title>T</Title><ukm:InForce Applied="false" Prospective="true"/></P1group></Body></Legislation>`;
    const s = parseClmlSection(prospective, "5", 10000);
    expect(s.prospective).toBe(true);
    expect(s.in_force).toBe(false);
  });

  it("falls back to legacy ukm:Extent and EnactmentDate; unknown InForce -> null", () => {
    const doc = `<Legislation ${LEG} ${UKM}><Metadata><ukm:Extent Value="N.I."/><ukm:EnactmentDate Date="2000-01-01"/></Metadata><Body><P1group id="section-6"><Title>Plain</Title><P1><Text>x</Text></P1></P1group></Body></Legislation>`;
    const s = parseClmlSection(doc, "6", 10000);
    expect(s.extent).toEqual(["Northern Ireland"]);
    expect(s.version_date).toBe("2000-01-01");
    expect(s.in_force).toBeNull();
  });

  it("ignores unknown extent codes and invalid dates", () => {
    const doc = `<Legislation ${LEG} ${UKM}><Metadata><ukm:EnactmentDate Date="not-a-date"/></Metadata><Body><P1group id="section-7" RestrictExtent="X+E" RestrictStartDate="bad-date"><Title>T</Title></P1group></Body></Legislation>`;
    const s = parseClmlSection(doc, "7", 10000);
    expect(s.extent).toEqual(["England"]); // X dropped, E kept
    expect(s.version_date).toBeNull();
  });

  it("falls back to the document root when the section id is absent", () => {
    const doc = `<Legislation ${LEG} ${UKM}><Body><P1group id="section-99"><Title>Root Title</Title><P1><Text>root body</Text></P1></P1group></Body></Legislation>`;
    const s = parseClmlSection(doc, "1", 10000); // no section-1 -> root fallback
    expect(s.content).toContain("root body");
    expect(s.title).toBe("Root Title"); // root .//Title fallback
  });

  it("truncates content beyond max_chars", () => {
    const body = "z".repeat(200);
    const doc = `<Legislation ${LEG} ${UKM}><Body><P1group id="section-8"><Title>T</Title><P1><Text>${body}</Text></P1></P1group></Body></Legislation>`;
    const s = parseClmlSection(doc, "8", 50);
    expect(s.content_truncated).toBe(true);
    expect(s.content.endsWith("…[truncated]")).toBe(true);
    expect(s.original_length).toBeGreaterThan(50);
  });
});

// ------------------------------------------------------------- parseHtmlSection
describe("legislation/parsers — parseHtmlSection", () => {
  it("extracts content and heading, stripping script/nav chrome", () => {
    const doc = `<html><body><div id="content"><script>junk()</script><nav>menu</nav><h1>Section 47 Heading</h1><p>Body text here.</p></div></body></html>`;
    const s = parseHtmlSection(doc, "47", 10000, "waf blocked");
    expect(s.source_format).toBe("html_fallback");
    expect(s.title).toBe("Section 47 Heading");
    expect(s.content).toContain("Body text here.");
    expect(s.content).not.toContain("junk");
    expect(s.warnings[0]).toBe("waf blocked");
    expect(s.in_force).toBeNull();
  });

  it("uses default title when no heading and truncates", () => {
    const doc = `<html><body><div id="content">${"w ".repeat(200)}</div></body></html>`;
    const s = parseHtmlSection(doc, "9", 20, "warn");
    expect(s.title).toBe("Section 9");
    expect(s.content_truncated).toBe(true);
  });
});

// ------------------------------------------------------------- parseTocXml
describe("legislation/parsers — parseTocXml", () => {
  it("lists id: title for every element with an id and a direct Title", () => {
    const doc = `<Legislation ${LEG}><Body>
      <Part id="part-1"><Title>Introduction</Title>
        <P1group id="section-1"><Title>Interpretation</Title></P1group>
      </Part>
      <P1group id="section-2"></P1group>
    </Body></Legislation>`;
    const items = parseTocXml(doc);
    expect(items).toContain("part-1: Introduction");
    expect(items).toContain("section-1: Interpretation");
    expect(items.some((i) => i.startsWith("section-2"))).toBe(false); // no Title -> skipped
  });
});

// ================================================================= tools
describe("legislation_search", () => {
  it("returns results and forwards title/type/year params", async () => {
    const legislationGet = vi.fn(async () => xml(ATOM));
    const reg = registerModule(registerLegislation, { legislationGet });
    const out = resultJson(await callTool(reg, "legislation_search", { query: "housing", type: "ukpga", year: 1988, limit: 20 }));
    expect(out.results.length).toBe(4);
    const url = legislationGet.mock.calls[0]![0] as string;
    expect(url.startsWith(`${LEGISLATION_BASE}/ukpga?`)).toBe(true);
    expect(url).toContain("title=housing");
    expect(url).toContain("year=1988");
    expect(url).toContain("results-count=20");
  });

  it("sets a coverage_note when the result set contains devolved legislation", async () => {
    // ATOM includes an asp entry (asp/2020/3), so the handler flags the set.
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => xml(ATOM)) });
    const out = resultJson(await callTool(reg, "legislation_search", { query: "housing" }));
    expect(out.coverage_note).toMatch(/devolved legislation/);
  });

  it("leaves coverage_note null when every result is UK-wide", async () => {
    const ukOnly = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Housing Act 1988</title><id>http://www.legislation.gov.uk/id/ukpga/1988/50</id></entry></feed>`;
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => xml(ukOnly)) });
    const out = resultJson(await callTool(reg, "legislation_search", { query: "housing" }));
    expect(out.coverage_note).toBeNull();
  });

  it("uses the /search path and text param when fulltext=true", async () => {
    const legislationGet = vi.fn(async () => xml(ATOM));
    const reg = registerModule(registerLegislation, { legislationGet });
    await callTool(reg, "legislation_search", { query: "deposits", fulltext: true });
    const url = legislationGet.mock.calls[0]![0] as string;
    expect(url.startsWith(`${LEGISLATION_BASE}/search?`)).toBe(true);
    expect(url).toContain("text=deposits");
  });

  it("surfaces an upstream error", async () => {
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => fetched("x", { status: 500, ok: false }) as any) });
    expect(isErr(await callTool(reg, "legislation_search", { query: "x" }))).toBe(true);
  });
});

describe("legislation_get_section", () => {
  const SECTION_XML = `<Legislation ${LEG} ${UKM}><Body><P1group id="section-47"><Title>Records</Title><P1><Text>content</Text></P1></P1group></Body></Legislation>`;

  it("parses a CLML section and normalises the section id", async () => {
    const legislationGet = vi.fn(async () => xml(SECTION_XML));
    const reg = registerModule(registerLegislation, { legislationGet });
    const out = resultJson(await callTool(reg, "legislation_get_section", { type: "ukpga", year: 2006, number: 46, section: "section-47" }));
    expect(out.title).toBe("Records");
    expect(out.section_number).toBe("47"); // normalised
    expect(legislationGet.mock.calls[0]![0]).toContain("/ukpga/2006/46/section/47/data.xml");
    expect(out.warnings.some((w: string) => /Scottish/.test(w))).toBe(false); // ukpga -> no devolved caveat
  });

  it("appends a Scottish coverage caveat to warnings for asp legislation", async () => {
    const legislationGet = vi.fn(async () => xml(SECTION_XML));
    const reg = registerModule(registerLegislation, { legislationGet });
    const out = resultJson(await callTool(reg, "legislation_get_section", { type: "asp", year: 2010, number: 8, section: "47" }));
    expect(out.title).toBe("Records"); // still parses the provision
    expect(out.warnings.some((w: string) => /Scottish legislation/.test(w))).toBe(true);
    expect(out.warnings.some((w: string) => /cannot retrieve Scottish case law|NOT Scottish case law/.test(w))).toBe(true);
    expect(legislationGet.mock.calls[0]![0]).toContain("/asp/2010/8/section/47/data.xml");
  });

  it("appends the devolved caveat on the HTML fallback path too", async () => {
    const legislationGet = vi.fn(async () => { throw new LegislationUpstreamError("waf blocked"); });
    const legislationGetHtml = vi.fn(async () => html(`<html><body><div id="content"><h1>T</h1><p>b</p></div></body></html>`));
    const reg = registerModule(registerLegislation, { legislationGet, legislationGetHtml });
    const out = resultJson(await callTool(reg, "legislation_get_section", { type: "ssi", year: 2015, number: 1, section: "1" }));
    expect(out.source_format).toBe("html_fallback");
    expect(out.warnings[0]).toBe("waf blocked");
    expect(out.warnings.some((w: string) => /Scottish legislation/.test(w))).toBe(true);
  });

  it("falls back to the HTML parser on a LegislationUpstreamError", async () => {
    const legislationGet = vi.fn(async () => { throw new LegislationUpstreamError("waf blocked"); });
    const legislationGetHtml = vi.fn(async () => html(`<html><body><div id="content"><h1>Fallback Title</h1><p>fallback body</p></div></body></html>`));
    const reg = registerModule(registerLegislation, { legislationGet, legislationGetHtml });
    const out = resultJson(await callTool(reg, "legislation_get_section", { type: "ukpga", year: 2006, number: 46, section: "47" }));
    expect(out.source_format).toBe("html_fallback");
    expect(out.title).toBe("Fallback Title");
    expect(out.warnings[0]).toBe("waf blocked");
  });

  it("surfaces the inner error when the HTML fallback also fails", async () => {
    const legislationGet = vi.fn(async () => { throw new LegislationUpstreamError("waf"); });
    const legislationGetHtml = vi.fn(async () => fetched("x", { status: 500, ok: false }) as any);
    const reg = registerModule(registerLegislation, { legislationGet, legislationGetHtml });
    expect(isErr(await callTool(reg, "legislation_get_section", { type: "ukpga", year: 2006, number: 46, section: "47" }))).toBe(true);
  });

  it("surfaces a non-legislation upstream error directly", async () => {
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => fetched("x", { status: 404, ok: false }) as any) });
    const r = await callTool(reg, "legislation_get_section", { type: "ukpga", year: 2006, number: 46, section: "47" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r).error_category).toBe("not_found");
  });
});

describe("legislation_get_toc", () => {
  const TOC_XML = `<Legislation ${LEG}><Body>
    <P1group id="section-1"><Title>One</Title></P1group>
    <P1group id="section-2"><Title>Two</Title></P1group>
    <P1group id="section-3"><Title>Three</Title></P1group>
  </Body></Legislation>`;

  it("paginates the flattened TOC", async () => {
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => xml(TOC_XML)) });
    const out = resultJson(await callTool(reg, "legislation_get_toc", { type: "ukpga", year: 2006, number: 46, offset: 1, limit: 1 }));
    expect(out.total_items).toBe(3);
    expect(out.returned).toBe(1);
    expect(out.items[0]).toContain("section-2");
    expect(out.has_more).toBe(true); // 1 + 1 < 3
    expect(out.coverage_note).toBeNull(); // ukpga -> no caveat
  });

  it("sets coverage_note for devolved (asp) legislation", async () => {
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => xml(TOC_XML)) });
    const out = resultJson(await callTool(reg, "legislation_get_toc", { type: "asp", year: 2010, number: 8 }));
    expect(out.coverage_note).toMatch(/Scottish legislation/);
  });

  it("surfaces an upstream error", async () => {
    const reg = registerModule(registerLegislation, { legislationGet: vi.fn(async () => fetched("x", { status: 503, ok: false }) as any) });
    expect(isErr(await callTool(reg, "legislation_get_toc", { type: "ukpga", year: 2006, number: 46 }))).toBe(true);
  });
});

// ================================================================= resources
describe("legislation:// resources", () => {
  const SECTION_XML = `<Legislation ${LEG}><Body><P1group id="section-1"><Title>T</Title></P1group></Body></Legislation>`;
  const TOC_XML = `<Legislation ${LEG}><Body><P1group id="section-1"><Title>One</Title></P1group></Body></Legislation>`;

  it("section resource returns raw CLML XML (undated and dated)", async () => {
    const legislationGet = vi.fn(async () => xml(SECTION_XML));
    const reg = registerModule(registerLegislation, { legislationGet });
    const res = resourceByTemplate(reg, "legislation://{type}/{year}/{number}/section/{section}{?date}");

    const undated = await res.handler(new URL("legislation://ukpga/2006/46/section/1"), { type: "ukpga", year: "2006", number: "46", section: "1" });
    expect(undated.contents[0].text).toContain("<P1group");
    expect(legislationGet.mock.calls[0]![0]).toContain("/section/1/data.xml");

    await res.handler(new URL("legislation://ukpga/2006/46/section/1"), { type: "ukpga", year: "2006", number: "46", section: "1", date: "2010-01-01" });
    expect(legislationGet.mock.calls[1]![0]).toContain("/section/1/2010-01-01/data.xml");
  });

  it("toc resource returns id: title lines and handles array/undefined variables", async () => {
    const legislationGet = vi.fn(async () => xml(TOC_XML));
    const reg = registerModule(registerLegislation, { legislationGet });
    const res = resourceByTemplate(reg, "legislation://{type}/{year}/{number}/toc{?date}");
    // Array-valued variables exercise the one() array branch; missing date -> undefined branch.
    const out = await res.handler(new URL("legislation://ukpga/2006/46/toc"), { type: ["ukpga"], year: ["2006"], number: ["46"] });
    expect(out.contents[0].text).toContain("section-1: One");
    expect(legislationGet.mock.calls[0]![0]).toContain("/ukpga/2006/46/data.xml");

    await res.handler(new URL("legislation://ukpga/2006/46/toc"), { type: "ukpga", year: "2006", number: "46", date: "2010-01-01" });
    expect(legislationGet.mock.calls[1]![0]).toContain("/2006/46/2010-01-01/data.xml");
  });
});

// ================================================================= prompts
describe("legislation prompts", () => {
  it("summarise_act references the citation", () => {
    const reg = registerModule(registerLegislation);
    const msg = reg.prompts.get("legislation_summarise_act")!.handler({ type: "ukpga", year: "2006", number: "46" });
    expect(msg.messages[0].content.text).toContain("ukpga/2006/46");
  });
  it("compare_legislation references both citations and the topic", () => {
    const reg = registerModule(registerLegislation);
    const msg = reg.prompts.get("legislation_compare_legislation")!.handler({
      type1: "ukpga", year1: "2006", number1: "46", type2: "asp", year2: "2020", number2: "3", topic: "directors",
    });
    const t = msg.messages[0].content.text;
    expect(t).toContain("ukpga/2006/46");
    expect(t).toContain("asp/2020/3");
    expect(t).toContain("'directors'");
  });
});
