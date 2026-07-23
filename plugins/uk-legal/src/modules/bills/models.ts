/**
 * Type-only definitions describing the bills module's data shapes.
 *
 * Keys use snake_case to match the JSON emitted on the wire. String values
 * arrive already whitespace-trimmed, since the parsers clean them before
 * populating these objects.
 */

/** One person sponsoring a bill. */
export interface BillSponsor {
  /** Name shown for the sponsor */
  name: string;
  /** Party the sponsor belongs to */
  party: string | null;
  /** Whether they sit in the Commons or the Lords */
  house: string | null;
}

/** A single step in a bill's passage through Parliament. */
export interface BillStage {
  /** Name of the stage, for example 'Second Reading' */
  name: string;
  /** The house in which the stage took place */
  house: string | null;
  /** Calendar date (YYYY-MM-DD) on which the stage happened */
  date: string | null;
  /** Marks the stage the bill is presently at */
  is_current: boolean;
}

/** A condensed record for a single bill. */
export interface BillSummary {
  /** The bill's numeric identifier */
  id: number;
  /** The bill's short title */
  short_title: string;
  /** The complete long title */
  long_title: string | null;
  /** Which house the bill is in at the moment */
  current_house: string | null;
  /** Where the bill sits in the legislative process */
  current_stage: string | null;
  /** Set once the bill has been granted Royal Assent */
  is_act: boolean;
  /** Link to the bill on the Parliament site */
  url: string;
}

/** A single page of matching bills plus paging metadata. */
export interface BillSearchResult {
  /** The keyword used for the search */
  query: string;
  /** How many matches were passed over before this page */
  offset: number;
  /** The maximum requested for this call */
  limit: number;
  /** How many bills this page actually holds */
  returned: number;
  /** Count of all matches across every page, when the upstream API supplies it. */
  total: number | null;
  /** Set when further matches remain past this page. */
  has_more: boolean;
  /** The bills that matched. */
  bills: BillSummary[];
}

/** The complete record for one bill. */
export interface BillDetail {
  /** The bill's numeric identifier */
  id: number;
  /** The bill's short title */
  short_title: string;
  /** The complete long title */
  long_title: string | null;
  /** The bill's summary text, which may be shortened to honour max_summary_chars. */
  summary: string | null;
  /** Set when the summary had to be shortened to stay within max_summary_chars */
  summary_truncated: boolean;
  /** Length of the summary, in characters, before any shortening */
  summary_original_length: number;
  /** Which house the bill is in at the moment */
  current_house: string | null;
  /** The house in which the bill first appeared */
  originating_house: string | null;
  /** Where the bill sits in the legislative process */
  current_stage: string | null;
  /** The bill's sponsors */
  sponsors: BillSponsor[];
  /** Stages the bill has already been through */
  stages: BillStage[];
  /** Set once the bill has been granted Royal Assent */
  is_act: boolean;
  /** When Royal Assent was granted */
  royal_assent_date: string | null;
  /** Link to the bill on the Parliament site */
  url: string;
}
