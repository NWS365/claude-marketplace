/**
 * Compile-time-only interfaces for the epoOps module.
 *
 * They document the precise snake_case JSON shape sent on the wire; they carry
 * no runtime validation of their own (input validation lives in the zod
 * schemas). The shapes model the subset of the EPO Open Patent Services (OPS)
 * bibliographic data the two tools surface.
 */

/** One hit from a published-data CQL search. */
export interface EpoPatentSearchHit {
  country: string | null;
  doc_number: string | null;
  kind: string | null;
  /** country + doc_number + kind, with nulls omitted (e.g. "EP1000000A1"). */
  publication_number: string;
}

/** The full response wrapper for a published-data CQL search. */
export interface EpoPatentSearchResult {
  query: string;
  total: number;
  results: EpoPatentSearchHit[];
}

/** Bibliographic detail for a single publication. */
export interface EpoPatentBiblio {
  publication_number: string;
  title: string | null;
  applicants: string[];
  inventors: string[];
  ipc_classes: string[];
  publication_date: string | null; // YYYYMMDD as supplied by OPS, or null
}
