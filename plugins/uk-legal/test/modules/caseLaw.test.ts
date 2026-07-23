import { describe, it, expect, vi } from "vitest";
import { registerCaseLaw } from "../../src/modules/caseLaw/index.js";
import {
  extractIndex,
  extractHeader,
  extractParagraph,
  grepParagraphs,
  escapeRegExp,
  parseAtomFeed,
} from "../../src/modules/caseLaw/parsers.js";
import { registerModule, callTool, resultJson, isErr, resourceByTemplate, fetched } from "../_harness.js";

// --- Fixtures ---------------------------------------------------------------

const AKN = 'xmlns:akn="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"';

// Judgment with native eIds + a nested sub-item + CDATA content.
const JUDGMENT_NATIVE = `<akn:akomaNtoso ${AKN}>
  <akn:judgment>
    <akn:header><akn:p>IN THE SUPREME COURT OF THE UNITED KINGDOM</akn:p></akn:header>
    <akn:judgmentBody>
      <akn:paragraph eId="para_1"><akn:num>1.</akn:num><akn:content><akn:p>The question of negligence and duty of care.</akn:p></akn:content>
        <akn:paragraph><akn:content><akn:p>nested sub-item without eId</akn:p></akn:content></akn:paragraph>
      </akn:paragraph>
      <akn:paragraph eId="para_2"><akn:num>2.</akn:num><akn:content><akn:p>Foreseeability (the test) applies.</akn:p><akn:p><![CDATA[cdata clause]]></akn:p></akn:content></akn:paragraph>
    </akn:judgmentBody>
  </akn:judgment>
</akn:akomaNtoso>`;

// Judgment with NO native eIds (exercises syntheticEid).
const JUDGMENT_SYNTHETIC = `<akn:akomaNtoso ${AKN}>
  <akn:paragraph><akn:num>5.</akn:num><akn:content><akn:p>Synthetic paragraph five.</akn:p></akn:content></akn:paragraph>
  <akn:paragraph><akn:content><akn:p>No num here.</akn:p></akn:content></akn:paragraph>
</akn:akomaNtoso>`;

const NO_HEADER = `<akn:akomaNtoso ${AKN}><akn:paragraph eId="para_1"><akn:content><akn:p>x</akn:p></akn:content></akn:paragraph></akn:akomaNtoso>`;

const ATOM = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:tna="https://caselaw.nationalarchives.gov.uk" xmlns:os="http://a9.com/-/spec/opensearch/1.1/">
  <os:totalResults>2</os:totalResults>
  <os:itemsPerPage>10</os:itemsPerPage>
  <os:startIndex>1</os:startIndex>
  <atom:entry>
    <atom:title>R v Smith</atom:title>
    <atom:published>2024-01-01T00:00:00Z</atom:published>
    <atom:updated>2024-01-02T00:00:00Z</atom:updated>
    <atom:author><atom:name>Supreme Court</atom:name></atom:author>
    <tna:identifier type="ukncn" slug="uksc/2024/12">[2024] UKSC 12</tna:identifier>
    <atom:link rel="alternate" href="https://caselaw.nationalarchives.gov.uk/uksc/2024/12"/>
  </atom:entry>
  <atom:entry>
    <atom:title>Jones v Jones</atom:title>
    <atom:published>2022-03-03T10:00:00+01:00</atom:published>
    <atom:updated>2022-03-03T10:00:00+01:00</atom:updated>
    <atom:author><atom:name>EWCA</atom:name></atom:author>
    <atom:link rel="alternate" href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2023/1"/>
    <atom:link rel="alternate" type="application/akn+xml" href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2023/1/data.xml"/>
    <atom:link type="application/pdf" href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2023/1/data.pdf"/>
  </atom:entry>
</atom:feed>`;

// --- parsers ----------------------------------------------------------------

describe("caseLaw/parsers — judgment extraction", () => {
  it("extractHeader serialises the <header> subtree", () => {
    expect(extractHeader(JUDGMENT_NATIVE)).toContain("SUPREME COURT");
  });

  it("extractHeader throws when there is no header", () => {
    expect(() => extractHeader(NO_HEADER)).toThrow(/No <header>/);
  });

  it("extractIndex lists native eIds and previews", () => {
    const idx = extractIndex(JUDGMENT_NATIVE);
    expect(idx).toContain("para_1:");
    expect(idx).toContain("negligence");
    expect(idx).toContain("para_2:");
  });

  it("extractIndex derives synthetic eIds from <num> or position", () => {
    const idx = extractIndex(JUDGMENT_SYNTHETIC);
    expect(idx).toContain("para_5:"); // from <num>5.</num>
    expect(idx).toContain("para_2:"); // positional fallback (2nd paragraph, no num)
  });

  it("extractParagraph returns a native paragraph and a synthetic one", () => {
    expect(extractParagraph(JUDGMENT_NATIVE, "para_1")).toContain("negligence");
    expect(extractParagraph(JUDGMENT_SYNTHETIC, "para_5")).toContain("five");
  });

  it("extractParagraph throws for an unknown eId", () => {
    expect(() => extractParagraph(JUDGMENT_NATIVE, "para_999")).toThrow(/No paragraph/);
  });
});

describe("caseLaw/parsers — grep", () => {
  it("escapeRegExp escapes regex metacharacters", () => {
    expect(escapeRegExp("a.b(c)")).toBe("a\\.b\\(c\\)");
  });

  it("matches paragraphs and returns snippets with eIds (native path skips sub-items)", () => {
    const hits = grepParagraphs(JUDGMENT_NATIVE, "negligence");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.eId).toBe("para_1");
    expect(hits[0]!.match.toLowerCase()).toBe("negligence");
  });

  it("is case-insensitive by default and case-sensitive when asked", () => {
    expect(grepParagraphs(JUDGMENT_NATIVE, "NEGLIGENCE")).toHaveLength(1);
    expect(grepParagraphs(JUDGMENT_NATIVE, "NEGLIGENCE", false)).toHaveLength(0);
  });

  it("falls back to literal search when the pattern is not a valid regex", () => {
    const hits = grepParagraphs(JUDGMENT_NATIVE, "(the"); // invalid regex -> literal
    expect(hits).toHaveLength(1);
    expect(hits[0]!.eId).toBe("para_2");
  });

  it("honours maxHits", () => {
    const hits = grepParagraphs(JUDGMENT_NATIVE, "the", true, 1);
    expect(hits).toHaveLength(1);
  });

  it("greps synthetic-eId judgments too", () => {
    const hits = grepParagraphs(JUDGMENT_SYNTHETIC, "Synthetic");
    expect(hits[0]!.eId).toBe("para_5");
  });
});

describe("caseLaw/parsers — parseAtomFeed", () => {
  it("parses entries, identifiers, links, and pagination", () => {
    const res = parseAtomFeed(ATOM, 10);
    expect(res.results).toHaveLength(2);
    expect(res.page).toBe(1);
    expect(res.has_more).toBe(false);
    expect(res.total_pages).toBe(1);

    const smith = res.results[0]!;
    expect(smith.uri).toBe("uksc/2024/12");
    expect(smith.court).toBe("Supreme Court");
    expect(smith.published.endsWith("Z")).toBe(true);
    expect(smith.identifiers[0]).toMatchObject({ type: "ukncn", value: "[2024] UKSC 12", slug: "uksc/2024/12" });
    expect(smith.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const jones = res.results[1]!;
    expect(jones.uri).toBe("ewca/civ/2023/1"); // slug derived from the typeless alternate link
    expect(jones.xml_url).toContain("/data.xml"); // xml link override
    expect(jones.pdf_url).toContain("/data.pdf"); // pdf link override
    expect(jones.published).toBe("2022-03-03T10:00:00+01:00"); // non-UTC offset preserved
  });

  it("marks has_more and paginates when entries exceed the limit", () => {
    const res = parseAtomFeed(ATOM, 1);
    expect(res.results).toHaveLength(1);
    expect(res.has_more).toBe(true);
  });

  it("defaults pagination fields when opensearch elements are absent", () => {
    const feed = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>`;
    const res = parseAtomFeed(feed);
    expect(res).toMatchObject({ results: [], page: 1, has_more: false });
  });

  it("returns page 1 / null total_pages when itemsPerPage is zero", () => {
    const feed = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:os="http://a9.com/-/spec/opensearch/1.1/"><os:totalResults>0</os:totalResults><os:itemsPerPage>0</os:itemsPerPage><os:startIndex>1</os:startIndex></atom:feed>`;
    const res = parseAtomFeed(feed);
    expect(res.page).toBe(1);
    expect(res.total_pages).toBeNull();
  });

  it("returns an empty result on a broken feed (missing published / bad integers / bad dates)", () => {
    const noPublished = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:title>x</atom:title></atom:entry></atom:feed>`;
    expect(parseAtomFeed(noPublished).results).toEqual([]);

    const badTotal = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:os="http://a9.com/-/spec/opensearch/1.1/"><os:totalResults>abc</os:totalResults></atom:feed>`;
    expect(parseAtomFeed(badTotal).results).toEqual([]);

    const badDate = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:title>x</atom:title><atom:published>not-a-date</atom:published><atom:updated>not-a-date</atom:updated></atom:entry></atom:feed>`;
    expect(parseAtomFeed(badDate).results).toEqual([]);
  });
});

// --- tools ------------------------------------------------------------------

describe("case_law_search", () => {
  it("returns parsed search results and forwards all filter params", async () => {
    const xmlGet = vi.fn(async () => fetched(ATOM));
    const reg = registerModule(registerCaseLaw, { xmlGet });
    const out = resultJson(await callTool(reg, "case_law_search", {
      query: "negligence", court: "uksc", judge: "Reed", party: "Smith",
      from_date: "2020-01-01", to_date: "2024-01-01", page: 1, limit: 10,
    }));
    expect(out.results.length).toBe(2);
    const url = (xmlGet.mock.calls[0]![0] as string);
    expect(url).toContain("query=negligence");
    expect(url).toContain("court=uksc");
    expect(url).toContain("judge=Reed");
    expect(url).toContain("party=Smith");
    expect(url).toContain("from=2020-01-01");
    expect(url).toContain("to=2024-01-01");
  });

  it("respects limit", async () => {
    const reg = registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched(ATOM)) });
    const out = resultJson(await callTool(reg, "case_law_search", { query: "x", page: 1, limit: 1 }));
    expect(out.results.length).toBe(1);
    expect(out.has_more).toBe(true);
  });

  it("surfaces an upstream error", async () => {
    const reg = registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched("boom", { status: 503, ok: false })) });
    const r = await callTool(reg, "case_law_search", { query: "x", page: 1, limit: 10 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient" });
  });
});

describe("case_law_grep_judgment", () => {
  it("returns hits and a truncated flag", async () => {
    const reg = registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched(JUDGMENT_NATIVE)) });
    const out = resultJson(await callTool(reg, "case_law_grep_judgment", {
      slug: "/uksc/2024/12", pattern: "the", case_insensitive: true, max_hits: 1,
    }));
    expect(out.slug).toBe("uksc/2024/12");
    expect(out.hits.length).toBe(1);
    expect(out.truncated).toBe(true);
  });

  it("surfaces an upstream error", async () => {
    const reg = registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched("no", { status: 404, ok: false })) });
    const r = await callTool(reg, "case_law_grep_judgment", { slug: "uksc/2024/99", pattern: "xx", case_insensitive: true, max_hits: 25 });
    expect(isErr(r)).toBe(true);
  });
});

describe("judgment_get_header / index / paragraph tools", () => {
  const withXml = (xml: string) => registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched(xml)) });

  it("judgment_get_header returns the header", async () => {
    const out = resultJson(await callTool(withXml(JUDGMENT_NATIVE), "judgment_get_header", { slug: "uksc/2024/12" }));
    expect(out.header).toContain("SUPREME COURT");
  });

  it("judgment_get_index splits eId/preview rows", async () => {
    const out = resultJson(await callTool(withXml(JUDGMENT_NATIVE), "judgment_get_index", { slug: "uksc/2024/12" }));
    expect(out.paragraphs[0]).toMatchObject({ eId: "para_1" });
    expect(out.paragraphs[0].preview).toContain("negligence");
  });

  it("judgment_get_paragraph normalises a bare number to para_N", async () => {
    const out = resultJson(await callTool(withXml(JUDGMENT_NATIVE), "judgment_get_paragraph", { slug: "uksc/2024/12", eId: "1" }));
    expect(out.eId).toBe("para_1");
    expect(out.content).toContain("negligence");
  });

  it("each tool surfaces an upstream error", async () => {
    const bad = () => registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched("x", { status: 500, ok: false })) });
    expect(isErr(await callTool(bad(), "judgment_get_header", { slug: "uksc/2024/99" }))).toBe(true);
    expect(isErr(await callTool(bad(), "judgment_get_index", { slug: "uksc/2024/99" }))).toBe(true);
    expect(isErr(await callTool(bad(), "judgment_get_paragraph", { slug: "uksc/2024/99", eId: "1" }))).toBe(true);
  });
});

describe("judgment:// resources", () => {
  const reg = () => registerModule(registerCaseLaw, { xmlGet: vi.fn(async () => fetched(JUDGMENT_NATIVE)) });

  it("header resource returns the header XML", async () => {
    const res = resourceByTemplate(reg(), "judgment://{+slug}/header");
    const out = await res.handler(new URL("judgment://uksc/2024/12/header"), { slug: "uksc/2024/12" });
    expect(out.contents[0].text).toContain("SUPREME COURT");
    expect(out.contents[0].mimeType).toBe("application/xml");
  });

  it("index resource returns the plain-text index", async () => {
    const res = resourceByTemplate(reg(), "judgment://{+slug}/index");
    const out = await res.handler(new URL("judgment://uksc/2024/12/index"), { slug: "uksc/2024/12" });
    expect(out.contents[0].text).toContain("para_1:");
  });

  it("paragraph resource returns a single paragraph", async () => {
    const res = resourceByTemplate(reg(), "judgment://{+slug}/para/{eId}");
    const out = await res.handler(new URL("judgment://uksc/2024/12/para/para_1"), { slug: "uksc/2024/12", eId: "para_1" });
    expect(out.contents[0].text).toContain("negligence");
  });
});
