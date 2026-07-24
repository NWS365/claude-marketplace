<div align="center">

# 🏛️ uk-legal

**A compliance-controlled TypeScript MCP server for UK legal research.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square&logo=typescript&logoColor=white)](#develop)
[![Tests](https://img.shields.io/badge/tests-426%20passing-brightgreen?style=flat-square&logo=vitest&logoColor=white)](#tests)
[![Coverage](https://img.shields.io/badge/coverage-99%25%20lines-brightgreen?style=flat-square)](#tests)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.29-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](https://github.com/modelcontextprotocol)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)](#disclaimer)

</div>

---

A **compliance-controlled** TypeScript MCP server for UK legal research — case law, legislation, Parliament/Hansard, bills, votes, committees, OSCOLA citations, and HMRC guidance. It returns **primary sources with citation metadata** so an agent can build evidence packs you can check and footnote. It does not interpret the law.

> **Not legal advice.** Informational/preparatory use only. Verify all citations and have output reviewed by a qualified solicitor or barrister before relying on it.

It is an independent TypeScript implementation built on `@modelcontextprotocol/sdk`. Proprietary — © 2026 Smartr365; see [`NOTICE`](./NOTICE).

## Surface

**41 tools, 9 resources, 4 prompts** across 12 modules:

| Module | Tools |
|---|---|
| case_law | `case_law_search`, `case_law_grep_judgment`, `judgment_get_header`, `judgment_get_index`, `judgment_get_paragraph` |
| legislation | `legislation_search`, `legislation_get_section`, `legislation_get_toc` |
| parliament | `parliament_search_hansard`, `parliament_policy_position_summary`, `parliament_find_member`, `parliament_member_debates`, `parliament_member_interests`, `parliament_search_petitions`, `parliament_get_debate_divisions`, `parliament_get_debate_contributions`, `parliament_lookup_by_column` |
| bills | `bills_search_bills`, `bills_get_bill` |
| votes | `votes_search_divisions`, `votes_get_division` |
| committees | `committees_search_committees`, `committees_get_committee`, `committees_search_evidence` |
| citations | `citations_parse`, `citations_resolve`, `citations_network`, `citations_format_oscola` |
| hmrc | `hmrc_get_vat_rate`, `hmrc_check_mtd_status`, `hmrc_search_guidance` |
| companies_house | `companies_house_search`, `companies_house_get_company`, `companies_house_list_officers`, `companies_house_get_psc` |
| gazette | `gazette_search_notices`, `gazette_get_notice` |
| eurlex | `eurlex_search`, `eurlex_get_document` |
| epo_ops | `epo_ops_search_patents`, `epo_ops_get_patent` |

Resources: `judgment://{+slug}/header|index|para/{eId}`, `legislation://…/section/…{?date}`, `legislation://…/toc{?date}`, `hansard://debate/{debate_ext_id}/header|contribution/{contribution_ext_id}`, `hansard://member/{member_id}/biography`, `server://about`.
Prompts: `legislation_summarise_act`, `legislation_compare_legislation`, `parliament_policy_reception_review`, `parliament_member_record_on_topic`.

The companion **`legal-research`** skill routes questions to these tools and enforces a citation-verification protocol.

## Install & run

The plugin ships a built `dist/` and declares the server in `.mcp.json` (stdio):

```json
{ "mcpServers": { "uk-legal": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"] } } }
```

Install the plugin from the `legal-plugins` marketplace; tools appear as `mcp__uk-legal__<tool>`. The core research sources (case law, legislation, Parliament, bills, votes, committees, citations, The Gazette, EUR-Lex) need **no API keys**; three source families need free, registration-only credentials (see below) and are inert until configured.

## Configuration (optional)

**Guided setup:** run the **`uk-legal-setup`** skill ("set up uk-legal", "add my API keys") — it captures a practice profile (jurisdiction, silk system, citation style → `~/.claude/uk-legal-profile.md`, read by `legal-research` and `legal-debate`) and walks you through registering for and setting the free keys below. The manual reference follows.

Tools whose upstream needs credentials return a `configuration`/`auth_required` result until the relevant environment variables are set. All keys below are **free** (registration only).

- **HMRC** (`hmrc_check_mtd_status`): `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`. `HMRC_API_BASE` defaults to the sandbox `https://test-api.service.hmrc.gov.uk`; set `https://api.service.hmrc.gov.uk` for production.
- **Companies House** (`companies_house_*`): `COMPANIES_HOUSE_API_KEY` (free from developer.company-information.service.gov.uk). `COMPANIES_HOUSE_API_BASE` optional.
- **EPO OPS** (`epo_ops_*`): `EPO_OPS_CONSUMER_KEY`, `EPO_OPS_CONSUMER_SECRET` (free from developers.epo.org; 4 GB/week fair-use). `EPO_OPS_API_BASE` optional.

The Gazette and EUR-Lex (CELLAR SPARQL) are fully keyless.

## Develop

```bash
npm install          # deps: @modelcontextprotocol/sdk, zod, @xmldom/xmldom, xpath, impit
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/
npm run verify       # spawn dist/server.js over stdio; assert 41 tools / 8 templates / 1 static / 4 prompts + an offline citations_parse call
npm test             # vitest — full unit suite (no network; upstreams are stubbed)
npm run test:coverage # vitest + v8 coverage (thresholds enforced)
```

`npm run verify` is a re-runnable **parity + smoke** check (compliance artifact): it fails loudly if the tool/resource/prompt surface drifts from the expected registry.

### Tests

The `test/` suite unit-tests every module against a fake `Deps` (upstream HTTP is
stubbed with canned bodies — **no network calls**), plus an in-process integration
test that builds the real server over an in-memory transport and enumerates the
surface. Coverage runs ~99% lines / ~98% functions / ~88% branches; the residual
branches are defensive/unreachable fallbacks (e.g. the XML parser's own throw
pre-empting our error wrapper, `?? null` guards on always-present upstream fields).
Thresholds are enforced in `vitest.config.ts` to guard against regression.

## Notes on fidelity

- **legislation.gov.uk** sits behind a TLS-fingerprinting WAF (HTTP 437); requests use `impit` (Chrome impersonation) with the source's 202-async-render poll + WAF-challenge detection.
- XML is parsed with `@xmldom/xmldom` + `xpath` (namespace-aware), behind a DTD/ENTITY-rejecting safe parser.
- A uniform response envelope, a fixed error taxonomy, and per-endpoint caching (1h/24h/90d) apply across every module; JSON keys are snake_case with exact enum literals for stable, checkable output.
- Architecture: a single flat `McpServer` over stdio — no HTTP, metrics, or hosting layer, none of which a stdio plugin server needs.

## Disclaimer

This plugin returns **primary sources and citation metadata only** — it does not interpret the law and is not legal advice. Verify all citations and have output reviewed by a qualified, jurisdictionally-licensed solicitor or barrister before relying on it. Proprietary — © 2026 Smartr365; see `NOTICE`.
