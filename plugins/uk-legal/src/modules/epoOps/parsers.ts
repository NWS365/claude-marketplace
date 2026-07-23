/**
 * Stateless response-shaping helpers for the epoOps module.
 *
 * Nothing here touches the network: the handlers in tools.ts do the fetching
 * (and OAuth), and these functions turn raw OPS JSON into the snake_case wire
 * objects defined in models.ts.
 *
 * OPS JSON quirks these helpers absorb:
 *  - text values are wrapped as `{ "$": "value" }`
 *  - attributes are keyed as `"@name": "value"`
 *  - any repeatable element is EITHER a single object OR an array depending on
 *    how many were present, so every list is funnelled through `asArray`.
 */
import type { EpoPatentSearchHit, EpoPatentSearchResult, EpoPatentBiblio } from "./models.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Normalise an OPS "repeatable" node into an array. Returns `[]` for
 * null/undefined, the value itself if it is already an array, or a single-item
 * array wrapping a lone object/scalar.
 */
export function asArray(x: unknown): any[] {
  if (x === null || x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

/**
 * Pull the text out of an OPS text node. Given `{ "$": "value" }` returns the
 * value; given a bare string returns it as-is; otherwise null.
 */
export function txt(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") return node;
  if (typeof node === "object") {
    const v = (node as any)["$"];
    return v === undefined ? null : (v as string);
  }
  return null;
}

/** Pick a document-id entry: prefer `docdb`, else fall back to the first. */
function pickDocId(ids: any[], preferred = "docdb"): any {
  if (ids.length === 0) return undefined;
  return ids.find((d) => d?.["@document-id-type"] === preferred) ?? ids[0];
}

/**
 * Shape a published-data CQL search payload into an EpoPatentSearchResult.
 * Every level may be missing; results default to `[]` and total to `0`.
 */
export function parseSearchResults(query: string, raw: unknown, limit: number): EpoPatentSearchResult {
  const root = (raw as any)?.["ops:world-patent-data"]?.["ops:biblio-search"];
  const total = Number(root?.["@total-result-count"] ?? 0) || 0;
  const refs = asArray(root?.["ops:search-result"]?.["ops:publication-reference"]);

  const results: EpoPatentSearchHit[] = [];
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
export function parseBiblio(publicationNumber: string, raw: unknown): EpoPatentBiblio {
  const doc = asArray((raw as any)?.["ops:world-patent-data"]?.["exchange-documents"]?.["exchange-document"])[0];
  const biblio = doc?.["bibliographic-data"];

  // Title: prefer the English entry, else the first.
  const titles = asArray(biblio?.["invention-title"]);
  const titleNode = titles.find((t) => t?.["@lang"] === "en") ?? titles[0];
  const title = txt(titleNode);

  // Applicants (deduped, nulls dropped).
  const applicants = dedupe(
    asArray(biblio?.["parties"]?.["applicants"]?.["applicant"]).map((a) => txt(a?.["applicant-name"]?.["name"]))
  );

  // Inventors (deduped, nulls dropped).
  const inventors = dedupe(
    asArray(biblio?.["parties"]?.["inventors"]?.["inventor"]).map((i) => txt(i?.["inventor-name"]?.["name"]))
  );

  // IPC classifications (nulls dropped).
  const ipc_classes = asArray(biblio?.["classifications-ipcr"]?.["classification-ipcr"])
    .map((c) => txt(c?.["text"]))
    .filter((c): c is string => c != null);

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
function dedupe(values: Array<string | null>): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v != null && !out.includes(v)) out.push(v);
  }
  return out;
}
