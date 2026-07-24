// Single source of truth for the server's public MCP surface — the exact set of
// tool, resource-template, static-resource, and prompt names it exposes.
//
// Imported by BOTH the parity verifier (scripts/verify-parity.mjs, run under
// plain node) AND the in-process surface test (test/server.test.ts, run under
// vitest). Keeping one list prevents the two from drifting when the surface
// changes. Plain JS so both runners can import it without transpilation.

export const EXPECT_TOOLS = [
  "case_law_search", "case_law_grep_judgment",
  "legislation_search", "legislation_get_section", "legislation_get_toc",
  "parliament_search_hansard", "parliament_policy_position_summary", "parliament_find_member",
  "parliament_member_debates", "parliament_member_interests", "parliament_search_petitions",
  "parliament_get_debate_divisions", "parliament_get_debate_contributions", "parliament_lookup_by_column",
  "bills_search_bills", "bills_get_bill",
  "votes_search_divisions", "votes_get_division",
  "committees_search_committees", "committees_get_committee", "committees_search_evidence",
  "citations_parse", "citations_resolve", "citations_network", "citations_format_oscola",
  "hmrc_get_vat_rate", "hmrc_check_mtd_status", "hmrc_search_guidance",
  "companies_house_search", "companies_house_get_company", "companies_house_list_officers", "companies_house_get_psc",
  "gazette_search_notices", "gazette_get_notice",
  "eurlex_search", "eurlex_get_document",
  "epo_ops_search_patents", "epo_ops_get_patent",
  "judgment_get_header", "judgment_get_index", "judgment_get_paragraph",
];

export const EXPECT_TEMPLATES = [
  "judgment://{+slug}/header", "judgment://{+slug}/index", "judgment://{+slug}/para/{eId}",
  "legislation://{type}/{year}/{number}/section/{section}{?date}",
  "legislation://{type}/{year}/{number}/toc{?date}",
  "hansard://debate/{debate_ext_id}/header",
  "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}",
  "hansard://member/{member_id}/biography",
];

export const EXPECT_STATIC = ["server://about"];

export const EXPECT_PROMPTS = [
  "legislation_summarise_act", "legislation_compare_legislation",
  "parliament_policy_reception_review", "parliament_member_record_on_topic",
];
