/**
 * Pure parsing helpers for the case_law module: LegalDocML extraction and
 * grep, together with the TNA Atom-feed parser. No HTTP and no MCP here.
 *
 * Every bit of XML handling runs through the shared/xml.ts helpers
 * (xmldom + xpath).
 */
import { createHash } from "node:crypto";
import { parseXml, nsSelector, textOf, serialize, attr, type XmlNode } from "../../shared/xml.js";
import type {
  GrepHit,
  JudgmentIdentifier,
  JudgmentSearchResult,
  JudgmentSummary,
} from "./models.js";

export const TNA_BASE = "https://caselaw.nationalarchives.gov.uk";

// Atom-feed namespaces. The tna: prefix binds to the bare host (no path),
// the current URI for TNA-specific elements; the slug rides on
// <tna:identifier type="ukncn">.
const ATOM_NS = {
  atom: "http://www.w3.org/2005/Atom",
  tna: "https://caselaw.nationalarchives.gov.uk",
  os: "http://a9.com/-/spec/opensearch/1.1/",
};

// Namespaces used inside the judgment data.xml (LegalDocML).
const LEGALDOCML_NS = {
  akn: "http://docs.oasis-open.org/legaldocml/ns/akn/3.0",
  uk: "https://caselaw.nationalarchives.gov.uk/akn",
};

const FIRST_LINE_MAX = 120;
const SNIPPET_RADIUS = 100;

const TEXT_NODE = 3;
const CDATA_NODE = 4;
const ELEMENT_NODE = 1;

/** Collect every descendant text node and join them with single spaces. */
function itertext(node: XmlNode): string {
  const pieces: string[] = [];
  const walk = (n: XmlNode): void => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === TEXT_NODE || c.nodeType === CDATA_NODE) {
        if (c.nodeValue != null) pieces.push(c.nodeValue);
      } else if (c.nodeType === ELEMENT_NODE) {
        walk(c);
      }
    }
  };
  walk(node);
  return pieces.join(" ");
}

function firstLine(el: XmlNode, maxLen: number = FIRST_LINE_MAX): string {
  return itertext(el).trim().replace(/\n/g, " ").slice(0, maxLen);
}

/**
 * Manufacture an eId for a paragraph that has none: pull the digits out of
 * its <num> child (so "1." yields "para_1"), otherwise fall back to the
 * positional "para_{n}".
 */
function syntheticEid(p: XmlNode, position: number): string {
  const akn = nsSelector(LEGALDOCML_NS);
  const numEl = akn.first("akn:num", p);
  if (numEl) {
    const numText = textOf(numEl).trim().replace(/[^0-9]/g, "");
    if (numText) return `para_${numText}`;
  }
  return `para_${position}`;
}

/** Produce a single 'eId: first_line' row for each top-level judgment paragraph. */
export function extractIndex(xmlText: string): string {
  const root = parseXml(xmlText);
  const akn = nsSelector(LEGALDOCML_NS);
  const allParas = akn.nodes(".//akn:paragraph", root);
  const nativeEids = allParas.filter((p) => attr(p, "eId"));

  const rows: string[] = [];
  if (nativeEids.length) {
    for (const p of nativeEids) rows.push(`${attr(p, "eId")}: ${firstLine(p)}`);
  } else {
    allParas.forEach((p, i) => rows.push(`${syntheticEid(p, i + 1)}: ${firstLine(p)}`));
  }
  return rows.join("\n");
}

/** Serialise the judgment's `<header>...</header>` element back to XML. */
export function extractHeader(xmlText: string): string {
  const root = parseXml(xmlText);
  const akn = nsSelector(LEGALDOCML_NS);
  const header = akn.first(".//akn:header", root);
  if (!header) throw new Error("No <header> element in this judgment");
  return serialize(header);
}

/** Serialise one `<paragraph>` element back to XML. */
export function extractParagraph(xmlText: string, eId: string): string {
  const root = parseXml(xmlText);
  const akn = nsSelector(LEGALDOCML_NS);
  let el = akn.first(`.//akn:paragraph[@eId='${eId}']`, root);
  if (!el) {
    const allParas = akn.nodes(".//akn:paragraph", root);
    const hasNative = allParas.some((p) => attr(p, "eId"));
    if (!hasNative) {
      for (let i = 0; i < allParas.length; i++) {
        if (syntheticEid(allParas[i], i + 1) === eId) {
          el = allParas[i];
          break;
        }
      }
    }
  }
  if (!el) throw new Error(`No paragraph with eId='${eId}'`);
  return serialize(el);
}

/** Escape a string for use as a literal regex (regex-compile fallback). */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan paragraphs for text matching `pattern`, returning at most `maxHits`
 * entries shaped as `{eId, snippet, match}`. The pattern is a regex; if it
 * cannot be compiled, the search falls back to a plain substring.
 */
export function grepParagraphs(
  xmlText: string,
  pattern: string,
  caseInsensitive: boolean = true,
  maxHits: number = 25,
): GrepHit[] {
  const flags = caseInsensitive ? "gi" : "g";
  let rx: RegExp;
  try {
    rx = new RegExp(pattern, flags);
  } catch {
    rx = new RegExp(escapeRegExp(pattern), flags);
  }

  const root = parseXml(xmlText);
  const akn = nsSelector(LEGALDOCML_NS);
  const allParas = akn.nodes(".//akn:paragraph", root);
  const hasNative = allParas.some((p) => attr(p, "eId"));

  const hits: GrepHit[] = [];
  for (let i = 0; i < allParas.length; i++) {
    const p = allParas[i];
    let eId = attr(p, "eId");
    if (hasNative && !eId) continue; // modern judgments: pass over nested sub-items lacking an eId
    eId = eId || syntheticEid(p, i + 1);
    const text = itertext(p);
    rx.lastIndex = 0;
    const m = rx.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - SNIPPET_RADIUS);
    const end = Math.min(text.length, m.index + m[0].length + SNIPPET_RADIUS);
    let snippet = text.slice(start, end).trim();
    if (start > 0) snippet = "…" + snippet;
    if (end < text.length) snippet = snippet + "…";
    hits.push({ eId, snippet, match: m[0] });
    if (hits.length >= maxHits) break;
  }
  return hits;
}

// --- Atom feed parsing ---

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function intOrThrow(s: string): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) throw new Error(`not an integer: ${s}`);
  return n;
}

/** Normalise an Atom datetime to an ISO-8601 offset string (Z -> +00:00). */
function toOffsetDateTime(s: string): string {
  const t = s.trim().replace(/Z/g, "+00:00");
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid datetime: ${s}`);
  return t.endsWith("+00:00") ? t.slice(0, -"+00:00".length) + "Z" : t;
}

/**
 * Parse a TNA Atom feed into a JudgmentSearchResult. Any parsing failure
 * produces an empty result rather than throwing; HTTP-level errors are the
 * caller's business and surface separately as tool errors.
 */
export function parseAtomFeed(xmlText: string, limit: number = 10): JudgmentSearchResult {
  try {
    const doc = parseXml(xmlText);
    const feed = doc.documentElement ?? doc;
    const ns = nsSelector(ATOM_NS);

    const totalEl = ns.first(".//os:totalResults", feed);
    const perPageEl = ns.first(".//os:itemsPerPage", feed);
    const startEl = ns.first(".//os:startIndex", feed);
    const total = totalEl ? intOrThrow(textOf(totalEl)) : 0;
    const perPage = perPageEl ? intOrThrow(textOf(perPageEl)) : 10;
    const start = startEl ? intOrThrow(textOf(startEl)) : 1;
    const currentPage = perPage ? Math.max(1, Math.floor((start - 1) / perPage) + 1) : 1;
    const totalPages = perPage ? Math.floor((total + perPage - 1) / perPage) : null;

    const allEntries = ns.nodes("atom:entry", feed);
    const entries = allEntries.slice(0, limit);
    const hasMore = allEntries.length > limit;

    const summaries: JudgmentSummary[] = [];
    for (const entry of entries) {
      const titleEl = ns.first("atom:title", entry);
      const publishedEl = ns.first("atom:published", entry);
      const updatedEl = ns.first("atom:updated", entry);
      const authorNameEl = ns.first("atom:author/atom:name", entry);

      const ncnIdentEl = ns.first('tna:identifier[@type="ukncn"]', entry);
      let slug = ncnIdentEl ? (attr(ncnIdentEl, "slug") ?? "").trim() : "";

      const links = ns.nodes("atom:link", entry);
      if (!slug) {
        for (const link of links) {
          if (attr(link, "rel") === "alternate" && !attr(link, "type")) {
            const href = attr(link, "href") ?? "";
            if (href.startsWith(`${TNA_BASE}/`)) {
              slug = href.slice(TNA_BASE.length + 1).replace(/\/+$/, "");
              break;
            }
          }
        }
      }

      const identifiers: JudgmentIdentifier[] = [];
      if (ncnIdentEl) {
        const ncnText = textOf(ncnIdentEl).trim();
        if (ncnText) identifiers.push({ type: "ukncn", value: ncnText, slug });
      }

      let xmlUrl = slug ? `${TNA_BASE}/${slug}/data.xml` : null;
      let pdfUrl = slug ? `${TNA_BASE}/${slug}/data.pdf` : null;
      for (const link of links) {
        const linkType = attr(link, "type") ?? "";
        const href = attr(link, "href");
        if (attr(link, "rel") === "alternate" && linkType.includes("xml")) {
          if (href) xmlUrl = href;
        } else if (linkType.includes("pdf")) {
          if (href) pdfUrl = href;
        }
      }

      const titleTrim = titleEl ? textOf(titleEl).trim() : "";
      const titleText = titleTrim ? titleTrim : slug;

      // A missing published/updated element must throw here: that bubbles up
      // and collapses the whole feed to empty rather than emitting a partial entry.
      if (publishedEl == null) throw new Error("missing atom:published");
      const publishedText = (textOf(publishedEl) || "1970-01-01T00:00:00Z").trim();
      if (updatedEl == null) throw new Error("missing atom:updated");
      const updatedText = (textOf(updatedEl) || publishedText).trim();

      const courtTrim = authorNameEl ? textOf(authorNameEl).trim() : "";
      const courtText = courtTrim ? courtTrim : null;

      summaries.push({
        uri: slug,
        title: titleText,
        court: courtText,
        published: toOffsetDateTime(publishedText),
        updated: toOffsetDateTime(updatedText),
        identifiers,
        content_hash: xmlUrl ? sha256Hex(xmlUrl) : null,
        xml_url: xmlUrl,
        pdf_url: pdfUrl,
        next_steps: slug
          ? {
              header: `judgment://${slug}/header`,
              index: `judgment://${slug}/index`,
              paragraph_template: `judgment://${slug}/para/{eId}`,
              grep_tool: `case_law_grep_judgment(slug='${slug}', pattern=...)`,
            }
          : {},
      });
    }

    return { results: summaries, page: currentPage, has_more: hasMore, total_pages: totalPages };
  } catch {
    return { results: [], page: 1, has_more: false, total_pages: null };
  }
}
