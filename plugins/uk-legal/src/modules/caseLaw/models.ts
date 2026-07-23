/**
 * Type-only interfaces for the case_law module.
 *
 * Field keys stay snake_case so the serialised output lines up with the wire
 * shape the API emits. `eId` is deliberately left camelCase: it is the
 * LegalDocML paragraph identifier and is passed through unchanged.
 */

/** Identifies a judgment's citation in structured form. */
export interface JudgmentIdentifier {
  /** Which kind of identifier: 'ukncn' is the neutral citation, 'fclid' the Find Case Law internal ID. */
  type: "ukncn" | "fclid";
  value: string;
  slug: string;
}

/** Condensed metadata describing one judgment. */
export interface JudgmentSummary {
  uri: string;
  title: string;
  court: string | null;
  /** ISO-8601 offset datetime string. */
  published: string;
  /** ISO-8601 offset datetime string. */
  updated: string;
  identifiers: JudgmentIdentifier[];
  content_hash: string | null;
  xml_url: string | null;
  pdf_url: string | null;
  next_steps: Record<string, string>;
}

/** Holds one page of judgment search results. */
export interface JudgmentSearchResult {
  results: JudgmentSummary[];
  page: number;
  has_more: boolean;
  total_pages: number | null;
}

/** One paragraph that matched a grep_judgment search. */
export interface GrepHit {
  eId: string;
  snippet: string;
  match: string;
}

/** Shape of the value returned by case_law_grep_judgment. */
export interface GrepResult {
  slug: string;
  pattern: string;
  hits: GrepHit[];
  truncated: boolean;
}
