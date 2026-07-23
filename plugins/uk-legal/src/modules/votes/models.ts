/**
 * Compile-time interfaces for the votes module.
 *
 * These describe the exact wire shape produced upstream: snake_case keys,
 * calendar dates rendered as 'YYYY-MM-DD' strings, and absent values as `null`.
 * Nothing here validates at runtime — tools.ts assembles the success payloads by hand.
 */

/** How one member voted in a division. */
export interface Voter {
  member_id: number;
  name: string;
  party: string | null;
}

/** Condensed division entry as returned by a search. */
export interface DivisionSummary {
  id: number;
  title: string;
  date: string;
  house: string;
  ayes: number;
  noes: number;
  passed: boolean;
  is_government_win: boolean | null;
}

/** Complete division record listing each member's vote. */
export interface DivisionDetail {
  id: number;
  title: string;
  date: string;
  house: string;
  ayes_count: number;
  noes_count: number;
  passed: boolean;
  is_government_win: boolean | null;
  aye_voters: Voter[];
  noe_voters: Voter[];
  truncated: boolean;
  total_aye_voters: number;
  total_noe_voters: number;
}

/** Envelope pairing search hits with their query metadata. */
export interface DivisionsSearchResult {
  query: string | null;
  house: string;
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  divisions: DivisionSummary[];
}
