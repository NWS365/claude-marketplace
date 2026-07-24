# Changelog — uk-legal

All notable changes to the `uk-legal` MCP server. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semver.

## 0.2.0

### Added
- **Four new source families (10 tools):** Companies House (`companies_house_search`,
  `_get_company`, `_list_officers`, `_get_psc`), The Gazette (`gazette_search_notices`,
  `_get_notice`), EUR-Lex / retained EU law via CELLAR SPARQL (`eurlex_search`,
  `_get_document`), and EPO Open Patent Services (`epo_ops_search_patents`,
  `_get_patent`). Surface is now **41 tools · 9 resources · 4 prompts**.
- **Devolved-legislation awareness:** documented `asp`/`ssi` (Scotland), `nia` (NI),
  `asc`/`anaw` (Wales) type codes; a `jurisdictionCaveat` surfaces coverage
  shortcomings in outputs (`legislation_get_section` `warnings`; `legislation_search`
  and `_get_toc` `coverage_note`).
- **`smoke:live`** — opt-in live-API smoke test for the newer modules.

### Changed
- **OSCOLA citation patterns re-derived from primary sources** (neutral-citation
  Practice Direction + TNA Find Case Law court list; OSCOLA 4th edn), replacing the
  previously-adapted third-party fragments. NOTICE/README/`server://about` updated to
  first-party.
- **Citation division handling fixed:** acronym divisions keep case (`KB`, `IPEC`,
  `TCC`, `IAC`); parenthetical divisions now format after the number
  (`[2024] EWHC 123 (KB)`); neutral confidence is resolve-based.

### Removed
- **Scottish (CSOH/CSIH) and Northern Irish (NICA/NIQB) case-law codes** from the
  citation pattern, resolver, and `case_law_search` filter — TNA Find Case Law is
  England & Wales only, so those slugs resolved to URLs that 404 and produced
  false-confident citations. Scottish/NI **statute** remains available via the
  legislation tools.

### Added — companion skills
- New `uk-legal-setup` skill: practice-profile interview + guided free-API-key
  onboarding. `legal-research` and `legal-debate` read the profile and warn on
  devolved/Scots-law coverage limits.

## 0.1.0

- Initial release: UK case law (TNA Find Case Law), legislation (legislation.gov.uk),
  Parliament/Hansard, bills, votes, committees, OSCOLA citations, and HMRC —
  31 tools · 9 resources · 4 prompts.
