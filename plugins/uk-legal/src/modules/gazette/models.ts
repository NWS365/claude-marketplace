/**
 * Type-only interfaces for the gazette module.
 *
 * Field keys stay snake_case so the serialised output lines up with the wire
 * shape the tools emit.
 */

/** Condensed metadata describing one Gazette notice in a search feed. */
export interface GazetteNoticeSummary {
  /** The notice's Atom <id> — the numeric Gazette notice identifier. */
  id: string;
  title: string;
  /** The Gazette notice-type code from <f:notice-code>, or null when absent. */
  notice_code: string | null;
  /** ISO-8601 datetime string, or null when absent. */
  published: string | null;
  /** ISO-8601 datetime string, or null when absent. */
  updated: string | null;
  /** The <content> summary, trimmed, or null when absent. */
  summary: string | null;
  /** The best link href for this notice (alternate/self, else first link). */
  url: string | null;
}

/** One page of Gazette notice search results. */
export interface GazetteSearchResult {
  query: string;
  total: number;
  results: GazetteNoticeSummary[];
}

/** A single Gazette notice, fetched by id. */
export interface GazetteNotice {
  id: string;
  title: string | null;
  notice_code: string | null;
  /** ISO-8601 datetime string, or null when absent. */
  published: string | null;
  summary: string | null;
  html_url: string;
  json_url: string;
}
