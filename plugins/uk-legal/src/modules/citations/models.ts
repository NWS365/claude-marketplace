/**
 * Type-only interfaces for the citations module.
 *
 * These shapes mirror the serialised payloads exactly: snake_case keys, the
 * CitationType enum represented by its string value, and every optional field
 * always present — set to `null` rather than omitted when it has no value.
 * There are no runtime validators here; success payloads are assembled by hand
 * in tools.ts.
 */

/** The category an OSCOLA citation falls into. */
export type CitationType = "neutral" | "law_report" | "legislation" | "si" | "eu_retained";

/** One parsed OSCOLA citation, optionally resolved to a URL. */
export interface ParsedCitation {
  raw: string;
  type: CitationType;
  year: number | null;
  court: string | null;
  number: number | null;
  report_series: string | null;
  volume: number | null;
  page: number | null;
  legislation_title: string | null;
  section: string | null;
  si_year: number | null;
  si_number: number | null;
  resolved_url: string | null;
  confidence: number;
}

/** What a full parse of some text yields: the OSCOLA citations found within it. */
export interface CitationParseResult {
  citations: ParsedCitation[];
  ambiguous: ParsedCitation[];
  text_length: number;
  parse_duration_ms: number;
}

/** The citations a single judgment makes, bucketed by their type. */
export interface CitationNetwork {
  case_uri: string;
  neutral_citations: string[];
  legislation_refs: string[];
  si_refs: string[];
  eu_refs: string[];
  law_report_refs: string[];
  total_citations: number;
}
