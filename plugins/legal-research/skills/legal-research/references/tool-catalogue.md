# uk-legal MCP — tool catalogue

All tools are read-only. In Claude Code they appear as `mcp__uk-legal__<name>`. 31 tools, 9 resources, 4 prompts.

## Case law (TNA Find Case Law)
| Tool | Key params | Returns / chain |
|---|---|---|
| `case_law_search` | `query`, `court?`, `judge?`, `party?`, `from_date?`, `to_date?`, `page=1`, `limit=10` | Judgment summaries (neutral citation, court, dates, **slug**). Slug → the judgment tools/resources below. Note: date filters are currently ignored upstream; narrow with `query`/`court`. |
| `case_law_grep_judgment` | `slug`, `pattern` | `{eId, snippet, match}` hits within one judgment. Then `judgment_get_paragraph`. |
| `judgment_get_header` | `slug` | Parties, judges, neutral citation, court, dates. |
| `judgment_get_index` | `slug` | `{eId, preview}` per paragraph. |
| `judgment_get_paragraph` | `slug`, `eId` | Full text of one paragraph. |

Resources (equivalent to the companion tools): `judgment://{slug}/header`, `judgment://{slug}/index`, `judgment://{slug}/para/{eId}`.

## Legislation (legislation.gov.uk)
| Tool | Key params | Returns / chain |
|---|---|---|
| `legislation_search` | keyword | Acts & SIs. |
| `legislation_get_toc` | type, year, number | Parts/chapters/sections/schedules. |
| `legislation_get_section` | type, year, number, section, `max_chars?` | Section text + **`extent`**, **`in_force`**, **`version_date`**. Always check these before relying. |

Resources: `legislation://{type}/{year}/{number}/section/{section}{?date}`, `legislation://{type}/{year}/{number}/toc{?date}`.
Prompts: `legislation_summarise_act`, `legislation_compare_legislation`.

## Parliament (Hansard / Members / Interests / Petitions)
| Tool | Purpose |
|---|---|
| `parliament_search_hansard` | Search contributions with citation-grade metadata + debate/division previews. |
| `parliament_policy_position_summary` | Deterministic facet counts on a topic (no LLM labels). |
| `parliament_get_debate_divisions` | Divisions within a debate; chains to `votes_get_division`. |
| `parliament_get_debate_contributions` | All contributions in a debate. |
| `parliament_lookup_by_column` | Resolve a Hansard column citation to its debate (OSCOLA). |
| `parliament_find_member` | Name → member id. |
| `parliament_member_debates` | A member's contributions (optionally by topic). |
| `parliament_member_interests` | A member's registered financial interests. |
| `parliament_search_petitions` | UK Parliament petitions by keyword. |

Resources: `hansard://debate/{debate_ext_id}/header`, `hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}`, `hansard://member/{member_id}/biography`.
Prompts: `parliament_policy_reception_review`, `parliament_member_record_on_topic`.

## Bills / Votes / Committees
| Tool | Purpose |
|---|---|
| `bills_search_bills` / `bills_get_bill` | Bills by keyword/session; full detail (stages, sponsors, publications). |
| `votes_search_divisions` / `votes_get_division` | Commons & Lords divisions; per-member records (Lords include `isGovernmentWin`). |
| `committees_search_committees` / `committees_get_committee` / `committees_search_evidence` | Select committees, membership, oral & written evidence. |

## Citations (OSCOLA)
| Tool | Purpose |
|---|---|
| `citations_parse` | Extract + classify all OSCOLA citations in free text (`disambiguate` optional, uses client sampling; off by default). |
| `citations_resolve` | Verify a single citation; live TNA HEAD check for neutral cites (confidence 0.0 = absent). |
| `citations_network` | Map every citation a judgment makes (by slug). |
| `citations_format_oscola` | Format from resolved fields; **refuses** 0.0-confidence / unresolved — the fabrication guard. |

## HMRC
| Tool | Purpose |
|---|---|
| `hmrc_get_vat_rate` | VAT rate for a commodity/service. |
| `hmrc_search_guidance` | GOV.UK HMRC guidance search. |
| `hmrc_check_mtd_status` | MTD VAT status (needs HMRC OAuth; returns `auth_required` if unconfigured). |

## Meta
Resource `server://about` — provenance, upstream APIs, operational posture.
