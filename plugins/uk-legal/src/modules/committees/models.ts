/**
 * Type declarations for the committees module (no runtime behaviour).
 *
 * They describe the serialised output shape: snake_case keys, every field
 * always present (null in place of an absent value), and fixed enum literals.
 * There is no validation here — the shape is guaranteed by how the values are
 * constructed.
 */

export interface CommitteeMember {
  /** The member's display name */
  name: string;
  /** Party affiliation */
  party: string | null;
  /** Committee role, such as 'Chair' */
  role: string | null;
}

export interface CommitteeSummary {
  /** Identifier of the committee */
  id: number;
  /** Name of the committee */
  name: string;
  /** Chamber: Commons, Lords, or Joint */
  house: string | null;
  /** Active status of the committee, or null when not known */
  is_active: boolean | null;
  /** Link to the committee's page on Parliament's site */
  url: string | null;
}

export interface CommitteeSearchResult {
  /** The name filter that was applied, or null */
  query: string | null;
  /** The house filter that was applied, or null */
  house: string | null;
  /** Indicates the results were limited to committees currently sitting */
  active_only: boolean;
  /** Count of committees included in this response */
  total: number;
  /** The committees that matched. Call committees_get_committee for full membership. */
  committees: CommitteeSummary[];
}

export interface CommitteeDetail {
  /** Identifier of the committee */
  id: number;
  /** Name of the committee */
  name: string;
  /** Chamber: Commons, Lords, or Joint */
  house: string | null;
  /** Phone number for contact */
  phone: string | null;
  /** Email address for contact */
  email: string | null;
  /** Link to the committee's page on Parliament's site */
  url: string | null;
  /** Members presently serving on the committee */
  members: CommitteeMember[];
}

export interface EvidenceItem {
  /** Identifier of the evidence item */
  id: number;
  /** Whether the evidence is oral or written */
  type: "oral" | "written";
  /** Title of the evidence or a session description (possibly trimmed to max_title_chars) */
  title: string;
  /** When the evidence was given or lodged, as 'YYYY-MM-DD' */
  date: string | null;
  /** Names of witnesses, present for oral evidence only and limited to 10 */
  witnesses: string[] | null;
  /** Link to the evidence document */
  url: string | null;
}

export interface CommitteeEvidencePage {
  /** Identifier of the committee this page covers */
  committee_id: number;
  /** The evidence-type filter used for this query */
  evidence_type: "oral" | "written" | "both";
  /** How many evidence items were skipped ahead of this page */
  offset: number;
  /** The requested ceiling on items for this page */
  limit: number;
  /** How many evidence items this call actually returned */
  returned: number;
  /** Set when further evidence may exist past this page. */
  has_more: boolean;
  /** The evidence items making up this page. */
  evidence: EvidenceItem[];
}
