/**
 * Parsing helpers for the legislation module.
 *
 * Data sources:
 *   search      — the legislation.gov.uk Atom feed
 *   section/toc — the legislation.gov.uk API, delivered as CLML XML
 *
 * XML handling runs through the shared xml.ts helpers (@xmldom/xmldom +
 * xpath). One thing to keep in mind: parseXml hands back a DOM *Document*,
 * whereas the equivalent XML-tree APIs return the root *element* directly, so
 * we grab `.documentElement` up front. That keeps the ancestor walk and the
 * `.//` descendant queries behaving the same way.
 */
import { parseXml, parseHtml, nsSelector, select, textOf, attr, type XmlNode } from "../../shared/xml.js";
import type { LegislationResult, LegislationSearchResult, LegislationSection } from "./models.js";

export const LEGISLATION_BASE = "https://www.legislation.gov.uk";

const LEG_NS = "http://www.legislation.gov.uk/namespaces/legislation";
const UKM_NS = "http://www.legislation.gov.uk/namespaces/metadata";
const ATOM_NS = "http://www.w3.org/2005/Atom";
const OS_NS = "http://a9.com/-/spec/opensearch/1.1/";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

const ID_RE = /\/id\/([a-z]+)\/(\d{4})\/(\d+)$/;
// Acts from before 1963 are identified by regnal year, e.g. /id/ukpga/Eliz2/5-6/31
const REGNAL_ID_RE = /\/id\/([a-z]+)\/[A-Za-z].+\/(\d+)$/;
const YEAR_RE = /\b(\d{4})\b/;

const EXTENT_CODE_MAP: Record<string, string> = {
  E: "England",
  W: "Wales",
  S: "Scotland",
  "N.I.": "Northern Ireland",
  NI: "Northern Ireland",
};

// --- generic DOM helpers (mirroring the XML-tree behaviour we depend on) ---

/** Wrap a string in single quotes, matching the quoting used in the `attempted` diagnostics. */
export function reprStr(s: string): string {
  return `'${s}'`;
}

/** Collect every descendant text fragment in document order. */
function iterText(node: XmlNode): string[] {
  const out: string[] = [];
  const walk = (n: XmlNode): void => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 || c.nodeType === 4) {
        // text / CDATA
        if (c.nodeValue != null) out.push(c.nodeValue);
      } else if (c.nodeType === 1) {
        walk(c);
      }
    }
  };
  walk(node);
  return out;
}

/** Join all descendant text with single spaces and trim it — how section content text is assembled. */
function extractText(el: XmlNode): string {
  return iterText(el).join(" ").trim();
}

/** The text that sits directly after an element's start tag (its immediate leading text). */
function directText(el: XmlNode): string {
  const first = el?.firstChild;
  if (first && (first.nodeType === 3 || first.nodeType === 4)) return first.nodeValue ?? "";
  return "";
}

/** Walk an element's ancestors, starting at its parent and ending at the root element. */
function ancestors(el: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  let p = el?.parentNode;
  while (p && p.nodeType === 1) {
    out.push(p);
    p = p.parentNode;
  }
  return out;
}

/** Every element in document order with the root at the front. */
function iterElements(root: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    out.push(n);
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) walk(c);
    }
  };
  if (root) walk(root);
  return out;
}

/** The first immediate child matching a given namespace and local name. */
function directChild(parent: XmlNode, nsUri: string, local: string): XmlNode | null {
  for (let c = parent?.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.localName === local && c.namespaceURI === nsUri) return c;
  }
  return null;
}

/** Check that a YYYY-MM-DD string is a genuine calendar date, returning it as-is when valid and null otherwise. */
function parseIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// --- section id normalisation ---

/** Take the various forms a section id can arrive in and boil them down to the token the API expects. */
export function normaliseSectionId(section: string): string {
  let value = section.trim();
  if (value.includes(":")) {
    value = value.split(":")[0]!.trim();
  }
  for (const prefix of ["section-", "article-", "regulation-"]) {
    if (value.toLowerCase().startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

// --- search (Atom feed) ---

function entryTitle(entry: XmlNode, sel: ReturnType<typeof nsSelector>): string {
  const titleEl = sel.first("a:title", entry);
  if (!titleEl) return "Unknown";
  if (attr(titleEl, "type") === "xhtml") {
    // The spans live inside a <div xmlns="...xhtml"> wrapper, so recurse to reach them.
    const spans = sel.nodes(".//h:span", titleEl);
    for (const span of spans) {
      const lang = attr(span, "xml:lang") ?? "";
      const t = directText(span);
      if (lang === "en" && t) return t;
    }
    for (const span of spans) {
      const t = directText(span);
      if (t) return t;
    }
    return "Unknown";
  }
  const t = directText(titleEl);
  return t || "Unknown";
}

export function parseSearchAtom(xmlText: string): LegislationSearchResult {
  const root = parseXml(xmlText).documentElement;
  const sel = nsSelector({ a: ATOM_NS, os: OS_NS, h: XHTML_NS });

  const totalText = sel.text(".//os:totalResults", root);
  const total = totalText ? parseInt(totalText, 10) : 0;

  const results: LegislationResult[] = [];
  for (const entry of sel.nodes(".//a:entry", root)) {
    const title = entryTitle(entry, sel);
    const entryId = sel.text("a:id", entry) || "";

    let legType: string;
    let yr: number;
    let num: number;
    const m = ID_RE.exec(entryId);
    if (m) {
      legType = m[1]!;
      yr = parseInt(m[2]!, 10);
      num = parseInt(m[3]!, 10);
    } else {
      const m2 = REGNAL_ID_RE.exec(entryId);
      if (m2) {
        legType = m2[1]!;
        num = parseInt(m2[2]!, 10);
        const yrM = YEAR_RE.exec(title);
        yr = yrM ? parseInt(yrM[1]!, 10) : 0;
      } else {
        legType = "unknown";
        yr = 0;
        num = 0;
      }
    }

    results.push({
      title,
      type: legType,
      year: yr,
      number: num,
      score: null,
      url: `${LEGISLATION_BASE}/${legType}/${yr}/${num}`,
      next_steps:
        legType !== "unknown"
          ? {
              toc: `legislation://${legType}/${yr}/${num}/toc`,
              section_template: `legislation://${legType}/${yr}/${num}/section/{section}`,
              point_in_time_hint: "Append ?date=YYYY-MM-DD to either URI for historical research",
            }
          : {},
    });
  }

  return { results, total: total || results.length, coverage_note: null };
}

/**
 * A coverage caveat for devolved legislation, or null for UK-wide types
 * (ukpga/uksi). This server can retrieve devolved *statute* from
 * legislation.gov.uk, but not the devolved *case law* or legislature
 * proceedings that interpret it — so any output touching devolved legislation
 * says so. Keyed on the legislation type code, not on territorial extent (a UK
 * Act can extend to Scotland without being Scottish Parliament legislation).
 */
export function jurisdictionCaveat(type: string): string | null {
  const t = type.trim().toLowerCase();
  if (t === "asp" || t === "ssi") {
    return (
      "Scottish legislation. Scots law is a distinct legal system: this server can retrieve Scottish statute " +
      "but NOT Scottish case law (the Court of Session, High Court of Justiciary and Sheriff Courts are not on " +
      "Find Case Law) or Scottish Parliament (Holyrood) proceedings, so how the Scottish courts have interpreted " +
      "this provision cannot be verified here. Check version_date for currency — revised/in-force data for devolved " +
      "legislation can lag — and confirm with a Scottish-qualified practitioner."
    );
  }
  if (t === "nia") {
    return (
      "Northern Ireland legislation. NI is a distinct jurisdiction; verify separately how the NI courts have " +
      "applied this provision, and check version_date for currency."
    );
  }
  if (t === "asc" || t === "anaw" || t === "mwa" || t === "wsi") {
    return (
      "Welsh legislation. Confirm how it applies in Wales and check version_date; devolved revised/in-force " +
      "data can lag."
    );
  }
  return null;
}

// --- section (CLML XML) ---

function extentCodesToNames(codeString: string): string[] {
  if (!codeString) return [];
  const names: string[] = [];
  for (const raw of codeString.split("+")) {
    const code = raw.trim();
    if (Object.hasOwn(EXTENT_CODE_MAP, code)) names.push(EXTENT_CODE_MAP[code]!);
  }
  return names;
}

/** The candidate chain that the RestrictExtent and RestrictStartDate lookups climb. */
function collectCandidates(sectionEl: XmlNode | null, root: XmlNode): XmlNode[] {
  const candidates: XmlNode[] = [];
  if (sectionEl) {
    candidates.push(sectionEl);
    for (const a of ancestors(sectionEl)) candidates.push(a);
  }
  if (root && !candidates.includes(root)) candidates.push(root);
  return candidates;
}

/** The nearest RestrictExtent found climbing the ancestor chain; the boolean flags whether it sat on the section element itself. */
function findRestrictExtent(sectionEl: XmlNode | null, root: XmlNode): [string, boolean] {
  const candidates = collectCandidates(sectionEl, root);
  for (let idx = 0; idx < candidates.length; idx++) {
    const ext = attr(candidates[idx]!, "RestrictExtent");
    if (ext) return [ext, idx === 0];
  }
  return ["", false];
}

/** The nearest RestrictStartDate found climbing the ancestor chain — the date this version of the section took effect. */
function findRestrictStartDate(sectionEl: XmlNode | null, root: XmlNode): string | null {
  for (const el of collectCandidates(sectionEl, root)) {
    const rsd = attr(el, "RestrictStartDate");
    if (rsd) return rsd;
  }
  return null;
}

/** Returns true when a <Repeal> element is nested inside the section's <Title>, i.e. the heading is flagged as repealed. */
function sectionIsRepealed(sectionEl: XmlNode | null, sel: ReturnType<typeof nsSelector>): boolean {
  if (!sectionEl) return false;
  let title = directChild(sectionEl, LEG_NS, "Title");
  if (!title) title = sel.first(".//leg:Title", sectionEl);
  if (!title) return false;
  return sel.first(".//leg:Repeal", title) !== null;
}

export function parseClmlSection(xmlText: string, section: string, maxChars: number): LegislationSection {
  const root = parseXml(xmlText).documentElement;
  const sel = nsSelector({ leg: LEG_NS, ukm: UKM_NS });

  // Locate the section element. The P1group container is preferred because it
  // both carries RestrictExtent and wraps <Title>; depending on the Act's
  // vintage the id attribute may sit on P1group or on the inner P1.
  let sectionEl: XmlNode | null = sel.first(`.//leg:P1group[@id='section-${section}']`, root);
  if (!sectionEl) {
    const p1 = sel.first(`.//leg:P1[@id='section-${section}']`, root);
    if (p1) {
      const parent = p1.parentNode;
      if (parent && parent.localName === "P1group") {
        sectionEl = parent;
      } else {
        sectionEl = p1;
      }
    }
  }

  const rawContent = sectionEl ? extractText(sectionEl) : extractText(root);
  const originalLength = rawContent.length;
  const truncated = originalLength > maxChars;
  const content = truncated ? rawContent.slice(0, maxChars) + " …[truncated]" : rawContent;

  // Extent comes from RestrictExtent on the ancestor chain, falling back to the legacy ukm:Extent value.
  let [extentCodes] = findRestrictExtent(sectionEl, root);
  if (!extentCodes) {
    const legacyExtentEl = sel.first(".//ukm:Extent", root);
    if (legacyExtentEl) extentCodes = attr(legacyExtentEl, "Value") ?? "";
  }
  const extent = extentCodesToNames(extentCodes);

  // Work out in-force and prospective status.
  let inForce: boolean | null = null;
  let prospective: boolean | null = null;
  if (sectionIsRepealed(sectionEl, sel)) {
    inForce = false;
    prospective = false;
  } else if (sectionEl) {
    const inForceEl = sel.first(".//ukm:InForce", sectionEl);
    if (inForceEl) {
      const applied = (attr(inForceEl, "Applied") ?? "").toLowerCase() === "true";
      const prospectiveRaw = (attr(inForceEl, "Prospective") ?? "").toLowerCase();
      if (prospectiveRaw === "true" || prospectiveRaw === "false") {
        prospective = prospectiveRaw === "true";
      }
      inForce = applied ? true : prospective === null ? null : !prospective;
    }
  }

  // For the version date, try RestrictStartDate first and drop back to EnactmentDate.
  let versionDate: string | null = null;
  const rsd = findRestrictStartDate(sectionEl, root);
  if (rsd) versionDate = parseIsoDate(rsd);
  if (versionDate === null) {
    const dateEl = sel.first(".//ukm:EnactmentDate", root);
    if (dateEl) versionDate = parseIsoDate(attr(dateEl, "Date") ?? "");
  }

  // For the title, favour the <Title> that is a direct child of the section.
  let title = `Section ${section}`;
  if (sectionEl) {
    let titleEl = directChild(sectionEl, LEG_NS, "Title");
    if (!titleEl) titleEl = sel.first(".//leg:Title", sectionEl);
    if (titleEl) {
      const titleText = iterText(titleEl).join(" ").trim();
      if (titleText) title = titleText;
    }
  } else {
    const titleEl = sel.first(".//leg:Title", root);
    if (titleEl) {
      const t = directText(titleEl).trim();
      if (t) title = t;
    }
  }

  return {
    title,
    section_number: section,
    content,
    content_truncated: truncated,
    original_length: originalLength,
    in_force: inForce,
    extent,
    version_date: versionDate,
    prospective,
    source_format: "xml",
    warnings: [],
  };
}

/** Fallback parser for legislation.gov.uk HTML section pages, used when the CLML endpoint is unavailable. */
export function parseHtmlSection(htmlText: string, section: string, maxChars: number, warning: string): LegislationSection {
  const doc = parseHtml(htmlText);
  const root = doc.documentElement;

  const candidates = select(
    "//*[@id='content'] | //*[@id='viewLegSnippet'] | //*[@class='LegSnippet'] | " +
      "//*[local-name()='main'] | //*[local-name()='article'] | //*[local-name()='body']",
    doc
  );
  const container: XmlNode = candidates.length ? candidates[0] : root;

  // Strip out the navigation and page chrome that would otherwise leak into the section text.
  const noisy = select(
    ".//*[local-name()='script'] | .//*[local-name()='style'] | .//*[local-name()='nav'] | " +
      ".//*[local-name()='footer'] | .//*[local-name()='header'] | .//*[local-name()='form']",
    container
  );
  for (const n of noisy) {
    const parent = n.parentNode;
    if (parent) parent.removeChild(n);
  }

  const rawContent = textOf(container)
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .join(" ");
  const originalLength = rawContent.length;
  const truncated = originalLength > maxChars;
  const content = truncated ? rawContent.slice(0, maxChars) + " …[truncated]" : rawContent;

  let title = `Section ${section}`;
  const heading = select(
    ".//*[local-name()='h1']/text() | .//*[local-name()='h2']/text() | .//*[local-name()='h3']/text()",
    container
  );
  if (heading.length) {
    const headingText: string = heading[0].nodeValue ?? "";
    title = headingText
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .join(" ");
  }

  return {
    title,
    section_number: section,
    content,
    content_truncated: truncated,
    original_length: originalLength,
    in_force: null,
    extent: [],
    version_date: null,
    prospective: null,
    source_format: "html_fallback",
    warnings: [
      warning,
      "The HTML fallback cannot reliably recover CLML metadata, so extent, version date, and in-force status are omitted for this section.",
    ],
  };
}

// --- table of contents (CLML XML) ---

/** List, in document order, every structural element that has both an @id and a <Title>, formatted as 'id: title'. */
export function parseTocXml(xmlText: string): string[] {
  const root = parseXml(xmlText).documentElement;
  const items: string[] = [];
  for (const el of iterElements(root)) {
    const idVal = attr(el, "id");
    if (idVal) {
      const titleEl = directChild(el, LEG_NS, "Title");
      const t = titleEl ? directText(titleEl) : "";
      if (t) items.push(`${idVal}: ${t.trim()}`);
    }
  }
  return items;
}
