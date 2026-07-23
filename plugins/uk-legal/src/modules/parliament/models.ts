/**
 * Type-only interfaces for the parliament module.
 *
 * They capture the snake_case JSON shape that goes out on the wire. There are
 * no runtime validators — success payloads are assembled as plain objects and
 * serialised through jsonResult().
 *
 * Dates travel as 'YYYY-MM-DD' strings, never Date objects.
 */

export type House = "Commons" | "Lords";
export type HouseFilter = "Commons" | "Lords" | "both";

/** One Hansard debate contribution, carrying citation-grade metadata. */
export interface HansardContribution {
  member_name: string;
  member_id: number | null;
  attributed_to: string;
  party: string | null;
  constituency: string | null;
  date: string;
  debate_title: string;
  debate_id: number;
  debate_ext_id: string;
  contribution_ext_id: string;
  column_ref: string | null;
  column_start: number | null;
  column_end: number | null;
  chamber_section: string;
  house: House;
  rank: number | null;
  text: string;
  url: string;
}

/** A leading debate section surfaced by a search, lookup preview, or aggregate. */
export interface TopDebate {
  debate_id: number;
  debate_ext_id: string;
  debate_title: string;
  date: string;
  house: House;
  relevance_rank: number | null;
  contribution_count: number | null;
  source_code: number | null;
  source: string | null;
}

/** A lightweight match shape for one division (a formal parliamentary vote). */
export interface DivisionMatchLite {
  id: number;
  votes_id: number | null;
  external_id: string;
  number: string;
  date: string;
  time: string | null;
  house: House;
  ayes_count: number;
  noes_count: number;
  motion_text: string | null;
  result_text: string | null;
  debate_section: string | null;
  debate_section_ext_id: string | null;
}

/** One facet bucket: a key paired with its count. */
export interface FacetCount {
  key: string;
  count: number;
}

/** A contributor with high volume within the sampled window. */
export interface TopContributor {
  member_id: number;
  member_name: string;
  party: string | null;
  count: number;
}

/** The outcome of a Hansard debate search. */
export interface HansardSearchResult {
  query: string;
  from_date: string | null;
  to_date: string | null;
  house: HouseFilter;
  member_id: number | null;
  text_mode: "preview" | "full";
  offset: number;
  limit: number;
  total: number;
  total_corpus: number | null;
  total_debates: number | null;
  total_divisions: number | null;
  total_written_statements: number | null;
  total_written_answers: number | null;
  total_corrections: number | null;
  total_petitions: number | null;
  total_committees: number | null;
  total_members: number | null;
  top_debates: TopDebate[];
  top_divisions: DivisionMatchLite[];
  party_breakdown: Record<string, number>;
  house_breakdown: Record<string, number>;
  date_range: [string, string] | null;
  has_more: boolean;
  contributions: HansardContribution[];
}

/** The outcome of a Hansard search filtered to one member. */
export interface MemberDebatesResult {
  member_id: number;
  topic: string | null;
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  contributions: HansardContribution[];
}

/** The divisions that took place inside a given debate. */
export interface DebateDivisions {
  debate_ext_id: string;
  divisions: DivisionMatchLite[];
}

/** The outcome of resolving a Hansard citation from its volume and column. */
export interface ColumnLookupResult {
  column_number: string;
  volume_number: number;
  house: HouseFilter;
  total_results: number;
  matches: TopDebate[];
}

/** Member-agnostic aggregate signals drawn from Hansard for a topic. */
export interface PolicyPositionSummary {
  topic: string;
  from_date: string | null;
  to_date: string | null;
  house: HouseFilter;
  total_contributions: number;
  total_debates: number;
  total_written_statements: number;
  total_written_answers: number;
  total_divisions: number;
  debates_scanned: number;
  by_party: FacetCount[];
  by_house: FacetCount[];
  by_section: FacetCount[];
  by_year: FacetCount[];
  by_month_recent_12: FacetCount[];
  top_contributors: TopContributor[];
  top_debates: TopDebate[];
}

/** A sitting or former Member of Parliament or peer. */
export interface MemberResult {
  id: number;
  name: string;
  party: string;
  constituency: string | null;
  house: House;
  is_current: boolean;
}

/** The outcome of searching for a parliamentarian by name. */
export interface MemberSearchResult {
  query: string;
  total: number;
  members: MemberResult[];
}

/** One entry from the register of financial interests. */
export interface Interest {
  category: string;
  description: string;
  date_created: string | null;
  date_amended: string | null;
}

/** A single page of a member's registered financial interests. */
export interface MemberInterestsPage {
  member_id: number;
  category: string | null;
  offset: number;
  limit: number;
  returned: number;
  has_more: boolean;
  interests: Interest[];
}

/** A petition submitted to the UK Parliament. */
export interface PetitionSummary {
  id: number;
  action: string;
  state: string;
  signature_count: number;
  created_at: string | null;
  government_response_at: string | null;
  debate_date: string | null;
  url: string;
}

/** The outcome of a UK Parliament petitions search. */
export interface PetitionSearchResult {
  query: string;
  state: "open" | "closed" | "all";
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  petitions: PetitionSummary[];
}
