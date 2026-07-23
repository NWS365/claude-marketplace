/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Normalise an OPS "repeatable" node into an array. Returns `[]` for
 * null/undefined, the value itself if it is already an array, or a single-item
 * array wrapping a lone object/scalar.
 */
export function asArray(x) {
    if (x === null || x === undefined)
        return [];
    return Array.isArray(x) ? x : [x];
}
/**
 * Pull the text out of an OPS text node. Given `{ "$": "value" }` returns the
 * value; given a bare string returns it as-is; otherwise null.
 */
export function txt(node) {
    if (node === null || node === undefined)
        return null;
    if (typeof node === "string")
        return node;
    if (typeof node === "object") {
        const v = node["$"];
        return v === undefined ? null : v;
    }
    return null;
}
/** Pick a document-id entry: prefer `docdb`, else fall back to the first. */
function pickDocId(ids, preferred = "docdb") {
    if (ids.length === 0)
        return undefined;
    return ids.find((d) => d?.["@document-id-type"] === preferred) ?? ids[0];
}
/**
 * Shape a published-data CQL search payload into an EpoPatentSearchResult.
 * Every level may be missing; results default to `[]` and total to `0`.
 */
export function parseSearchResults(query, raw, limit) {
    const root = raw?.["ops:world-patent-data"]?.["ops:biblio-search"];
    const total = Number(root?.["@total-result-count"] ?? 0) || 0;
    const refs = asArray(root?.["ops:search-result"]?.["ops:publication-reference"]);
    const results = [];
    for (const ref of refs) {
        const docId = pickDocId(asArray(ref?.["document-id"]));
        const country = txt(docId?.["country"]);
        const docNumber = txt(docId?.["doc-number"]);
        const kind = txt(docId?.["kind"]);
        const publicationNumber = [country, docNumber, kind].filter((p) => p != null).join("");
        results.push({ country, doc_number: docNumber, kind, publication_number: publicationNumber });
    }
    return { query, total, results: results.slice(0, limit) };
}
/**
 * Shape a published-data biblio payload into an EpoPatentBiblio. Fully
 * defensive: every level may be absent, in which case fields fall back to
 * null (scalars) or `[]` (lists) rather than throwing.
 */
export function parseBiblio(publicationNumber, raw) {
    const doc = asArray(raw?.["ops:world-patent-data"]?.["exchange-documents"]?.["exchange-document"])[0];
    const biblio = doc?.["bibliographic-data"];
    // Title: prefer the English entry, else the first.
    const titles = asArray(biblio?.["invention-title"]);
    const titleNode = titles.find((t) => t?.["@lang"] === "en") ?? titles[0];
    const title = txt(titleNode);
    // Applicants (deduped, nulls dropped).
    const applicants = dedupe(asArray(biblio?.["parties"]?.["applicants"]?.["applicant"]).map((a) => txt(a?.["applicant-name"]?.["name"])));
    // Inventors (deduped, nulls dropped).
    const inventors = dedupe(asArray(biblio?.["parties"]?.["inventors"]?.["inventor"]).map((i) => txt(i?.["inventor-name"]?.["name"])));
    // IPC classifications (nulls dropped).
    const ipc_classes = asArray(biblio?.["classifications-ipcr"]?.["classification-ipcr"])
        .map((c) => txt(c?.["text"]))
        .filter((c) => c != null);
    // Publication date: from the docdb/epodoc document-id.
    const pubIds = asArray(biblio?.["publication-reference"]?.["document-id"]);
    const pubId = pubIds.find((d) => d?.["@document-id-type"] === "docdb" || d?.["@document-id-type"] === "epodoc") ?? pubIds[0];
    const publication_date = txt(pubId?.["date"]);
    return {
        publication_number: publicationNumber,
        title,
        applicants,
        inventors,
        ipc_classes,
        publication_date,
    };
}
/** Drop nulls and duplicates, preserving first-seen order. */
function dedupe(values) {
    const out = [];
    for (const v of values) {
        if (v != null && !out.includes(v))
            out.push(v);
    }
    return out;
}
