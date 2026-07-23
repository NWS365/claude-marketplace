# uk-legal (TypeScript)

[![Build](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square&logo=typescript&logoColor=white)](#develop)
[![Tests](https://img.shields.io/badge/tests-330%20passing-brightgreen?style=flat-square&logo=vitest&logoColor=white)](#tests)
[![Coverage](https://img.shields.io/badge/coverage-99%25%20lines-brightgreen?style=flat-square)](#tests)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.29-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](https://github.com/modelcontextprotocol)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)](./NOTICE)

A **compliance-controlled** TypeScript MCP server for UK legal research — case law, legislation, Parliament/Hansard, bills, votes, committees, OSCOLA citations, and HMRC guidance. It returns **primary sources with citation metadata** so an agent can build evidence packs you can check and footnote. It does not interpret the law.

> **Not legal advice.** Informational/preparatory use only. Verify all citations and have output reviewed by a qualified solicitor or barrister.

It is an independent TypeScript implementation built on `@modelcontextprotocol/sdk`, so we own and govern the code and data paths end to end. Proprietary — © 2026 Smartr365; see `NOTICE`.

## Surface

**31 tools, 9 resources, 4 prompts** across 8 modules:

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

Resources: `judgment://{+slug}/header|index|para/{eId}`, `legislation://…/section/…{?date}`, `legislation://…/toc{?date}`, `hansard://debate/{debate_ext_id}/header|contribution/{contribution_ext_id}`, `hansard://member/{member_id}/biography`, `server://about`.
Prompts: `legislation_summarise_act`, `legislation_compare_legislation`, `parliament_policy_reception_review`, `parliament_member_record_on_topic`.

The companion **`legal-research`** skill routes questions to these tools and enforces a citation-verification protocol.

## Install & run

The plugin ships a built `dist/` and declares the server in `.mcp.json` (stdio):

```json
{ "mcpServers": { "uk-legal": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"] } } }
```

Install the plugin from the `legal-plugins` marketplace; tools appear as `mcp__uk-legal__<tool>`. No API keys are needed for the legal sources.

## Configuration (optional)

`hmrc_check_mtd_status` uses HMRC OAuth2 and is inert unless configured; it returns an `auth_required`/`configuration` result otherwise. Set:

- `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`
- `HMRC_API_BASE` — defaults to the sandbox `https://test-api.service.hmrc.gov.uk`; set `https://api.service.hmrc.gov.uk` for production.

## Develop

```bash
npm install          # deps: @modelcontextprotocol/sdk, zod, @xmldom/xmldom, xpath, impit
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/
npm run verify       # spawn dist/server.js over stdio; assert 31 tools / 8 templates / 1 static / 4 prompts + an offline citations_parse call
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
