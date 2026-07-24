/**
 * Type-only interfaces for the legislation module.
 *
 * Each interface pins down the exact snake_case JSON shape that goes out on
 * the wire. These are compile-time types only — there are no runtime
 * validators in this file.
 */

/** One entry from a legislation search. */
export interface LegislationResult {
  title: string;
  type: string;
  year: number;
  number: number;
  score: number | null;
  url: string;
  next_steps: Record<string, string>;
}

/** Wrapper holding a set of legislation search results. */
export interface LegislationSearchResult {
  results: LegislationResult[];
  total: number;
  /** A coverage caveat when any result is devolved legislation (Scotland/NI/Wales); null otherwise. */
  coverage_note: string | null;
}

/** A page of an Act's or Statutory Instrument's table of contents. */
export interface LegislationTOC {
  type: string;
  year: number;
  number: number;
  offset: number;
  limit: number;
  returned: number;
  total_items: number;
  has_more: boolean;
  items: string[];
  /** A coverage caveat for devolved legislation (Scotland/NI/Wales); null for UK-wide types. */
  coverage_note: string | null;
}

/** One section of an Act or SI, together with its metadata. */
export interface LegislationSection {
  title: string;
  section_number: string;
  content: string;
  content_truncated: boolean;
  original_length: number;
  in_force: boolean | null;
  extent: string[];
  version_date: string | null;
  prospective: boolean | null;
  source_format: "xml" | "html_fallback";
  warnings: string[];
}
