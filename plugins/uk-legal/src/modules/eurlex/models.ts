/**
 * Compile-time-only interfaces for the eurlex module.
 *
 * They document the precise snake_case JSON shape sent on the wire; they carry
 * no runtime validation of their own (input validation lives in the zod
 * schemas). Every record is keyed by a CELEX identifier — the EU's canonical
 * document number (e.g. 32016R0679 for the GDPR).
 */

/** One hit from a EUR-Lex title search. */
export interface EurlexSearchItem {
  celex: string | null;
  title: string | null;
  date: string | null; // ISO date string (YYYY-MM-DD) or null when absent
  eurlex_url: string;
}

/** The full response wrapper for a EUR-Lex title search. */
export interface EurlexSearchResult {
  query: string;
  total: number;
  results: EurlexSearchItem[];
}

/** A single EU legal instrument resolved by its CELEX identifier. */
export interface EurlexDocument {
  celex: string;
  title: string | null;
  date: string | null; // ISO date string (YYYY-MM-DD) or null when absent
  types: string[]; // distinct cdm resource-type URIs; may be empty
  eurlex_url: string;
}
