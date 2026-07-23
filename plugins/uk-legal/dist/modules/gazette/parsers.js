/**
 * Pure parsing helpers for the gazette module: the Gazette Atom-feed parser
 * (search results) and a defensive single-notice parser. No HTTP and no MCP
 * here.
 *
 * Every bit of XML handling runs through the shared/xml.ts helpers
 * (xmldom + xpath).
 */
import { parseXml, nsSelector, textOf, attr } from "../../shared/xml.js";
export const GAZETTE_BASE = "https://www.thegazette.co.uk";
// Atom-feed namespaces. The f: prefix binds to the Gazette "facets" namespace,
// which carries Gazette-specific elements such as <f:notice-code> and <f:total>.
const GAZETTE_NS = {
    atom: "http://www.w3.org/2005/Atom",
    f: "https://www.thegazette.co.uk/facets",
};
/** Trim a string and collapse an empty result to null. */
function trimOrNull(s) {
    const t = s.trim();
    return t ? t : null;
}
/**
 * Choose the best href for an entry: the rel="alternate" link, else rel="self",
 * else the first link with any href.
 */
function bestLink(entry, ns) {
    const links = ns.nodes("atom:link", entry);
    let alternate = null;
    let self = null;
    let first = null;
    for (const link of links) {
        const href = attr(link, "href");
        if (!href)
            continue;
        if (first === null)
            first = href;
        const rel = attr(link, "rel");
        if (rel === "alternate" && alternate === null)
            alternate = href;
        else if (rel === "self" && self === null)
            self = href;
    }
    return alternate ?? self ?? first;
}
/** Turn a single Atom <entry> node into a notice summary. */
function extractEntry(entry, ns) {
    const idEl = ns.first("atom:id", entry);
    const titleEl = ns.first("atom:title", entry);
    const publishedEl = ns.first("atom:published", entry);
    const updatedEl = ns.first("atom:updated", entry);
    const contentEl = ns.first("atom:content", entry);
    const noticeCodeEl = ns.first("f:notice-code", entry);
    return {
        id: idEl ? textOf(idEl).trim() : "",
        title: titleEl ? textOf(titleEl).trim() : "",
        notice_code: noticeCodeEl ? trimOrNull(textOf(noticeCodeEl)) : null,
        published: publishedEl ? trimOrNull(textOf(publishedEl)) : null,
        updated: updatedEl ? trimOrNull(textOf(updatedEl)) : null,
        summary: contentEl ? trimOrNull(textOf(contentEl)) : null,
        url: bestLink(entry, ns),
    };
}
/**
 * Parse a Gazette Atom feed into `{ total, results }`. Any parsing failure
 * produces an empty result rather than throwing; HTTP-level errors are the
 * caller's business and surface separately as tool errors.
 *
 * `total` is read from <f:total> when present, otherwise it falls back to the
 * count of entries in the feed. `results` is sliced to `limit` locally.
 */
export function parseGazetteFeed(xmlText, limit = 10) {
    try {
        const doc = parseXml(xmlText);
        const feed = doc.documentElement ?? doc;
        const ns = nsSelector(GAZETTE_NS);
        const allEntries = ns.nodes(".//atom:entry", feed);
        const totalEl = ns.first(".//f:total", feed);
        const totalText = totalEl ? textOf(totalEl).trim() : "";
        const parsedTotal = parseInt(totalText, 10);
        const total = Number.isNaN(parsedTotal) ? allEntries.length : parsedTotal;
        const results = allEntries.slice(0, limit).map((entry) => extractEntry(entry, ns));
        return { total, results };
    }
    catch {
        return { total: 0, results: [] };
    }
}
/**
 * Parse a single Gazette notice document defensively. The
 * `{base}/notice/{id}` endpoint negotiates content, and may return either an
 * Atom `<entry>` or a `<feed>` wrapping one entry. Returns the extracted fields
 * (any of which may be null) or null when the document contains no Atom entry.
 */
export function parseGazetteNotice(xmlText) {
    try {
        const doc = parseXml(xmlText);
        const root = doc.documentElement ?? doc;
        const ns = nsSelector(GAZETTE_NS);
        // A <feed> wrapping entries, or a bare <entry> at the root.
        let entry = ns.first(".//atom:entry", root);
        if (!entry) {
            const localName = root && typeof root.localName === "string" ? root.localName : "";
            if (localName === "entry")
                entry = root;
        }
        if (!entry)
            return null;
        return extractEntry(entry, ns);
    }
    catch {
        return null;
    }
}
