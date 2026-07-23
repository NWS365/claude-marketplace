---
title: uk-legal-mcp TypeScript port — implementation plan
status: ready
date: 2026-07-23
design: .claude/designs/uk-legal-mcp-typescript-port.md
work_item: none (personal marketplace repo)
repo: C:\repos\claude-marketplace (single repo — units are layer-scoped, not repo-scoped)
---

# Implementation plan — uk-legal-mcp TypeScript port

Single-repo build. Units below are **layer-scoped, self-contained** work items. The "Capability-level contract" (shared-infra interface + the exact wire-name registry) is recorded **once** in §Shared Contract and **referenced** by every module unit — module units must not restate it (drift hazard). Ordering follows the dependency graph; units with no edge between them run in parallel.

## Shared Contract (referenced by all module units — the single source of parity)

**`deps` object** injected into every `register(server, deps)`:
```ts
interface Deps {
  jsonGet(url: string, opts?): Promise<Resp>          // Accept: application/json
  xmlGet(url: string, opts?): Promise<Resp>           // Accept: atom+xml, application/xml, text/xml
  legislationGet(url: string, opts?): Promise<Resp>   // impit JA3; 202-poll [1s,2s,4s]; WAF/empty detect
  legislationGetHtml(url: string, opts?): Promise<Resp>
  legislationSearch(params): Promise<Resp>            // impit + query params (Atom)
  cache: TtlCache                                     // URL-keyed; per-endpoint TTLs
  sample(prompt): Promise<string|null>                // MCP sampling, fail-soft, capability-checked
  log(evt): void                                      // stderr only
}
```
**Envelope statuses:** `ok | empty | not_found | auth_required | upstream_validation | upstream_timeout | upstream_unavailable | unknown_error`. `classifyError` maps fetch/HTTP → (status, detail); **437 → transient/upstream_unavailable**.
**Tool-error return (NOT throw McpError):** `{ isError:true, content:[{type:'text', text: JSON.stringify(payload)}] }`. Reproduce the 4 source payload styles (see design §18).
**XML helper:** `parseXml(bytesOrStr) -> Document` (@xmldom/xmldom; byte-level DTD/ENTITY reject), plus `xpath` select with namespace maps; `serialize(node)` via XMLSerializer.
**Annotations presets:** `READ_ONLY_OPEN` (openWorldHint:true) for network tools; `READ_ONLY_CLOSED` (openWorldHint:false) for `citations_parse`, `citations_format_oscola`.
**Output:** zod OUTPUT schema + `structuredContent`; **snake_case keys**, exact enum literals; dates as `YYYY-MM-DD`/offset strings.
**TTLs:** legislation 24h, votes 24h, hmrc 90d, case_law/bills/committees/parliament 1h.

**Wire-name registry (the parity checklist — 31 tools, 8 templates + 1 static, 4 prompts):**
- case_law: `case_law_search`, `case_law_grep_judgment`
- legislation: `legislation_search`, `legislation_get_section`, `legislation_get_toc`
- parliament: `parliament_search_hansard`, `parliament_policy_position_summary`, `parliament_find_member`, `parliament_member_debates`, `parliament_member_interests`, `parliament_search_petitions`, `parliament_get_debate_divisions`, `parliament_get_debate_contributions`, `parliament_lookup_by_column`
- bills: `bills_search_bills`, `bills_get_bill`
- votes: `votes_search_divisions`, `votes_get_division`
- committees: `committees_search_committees`, `committees_get_committee`, `committees_search_evidence`
- citations: `citations_parse`, `citations_resolve`, `citations_network`, `citations_format_oscola`
- hmrc: `hmrc_get_vat_rate`, `hmrc_check_mtd_status`, `hmrc_search_guidance`
- companion: `judgment_get_header`, `judgment_get_index`, `judgment_get_paragraph`
- resources (templates): `judgment://{slug*}/header|index|para/{eId}`, `legislation://{type}/{year}/{number}/section/{section}{?date}`, `legislation://{type}/{year}/{number}/toc{?date}`, `hansard://debate/{debate_ext_id}/header`, `hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}`, `hansard://member/{member_id}/biography`
- resource (static): `server://about`
- prompts: `legislation_summarise_act`, `legislation_compare_legislation`, `parliament_policy_reception_review`, `parliament_member_record_on_topic`

**Per-module detailed spec** lives in the inventory journal: `…/subagents/workflows/wf_605147b2-6f7/journal.jsonl` (one result line per module). Each module unit reads its own line for exact params/upstream/parser.

## Dependency graph

```
U1 scaffold ─► U2 shared-infra ─► U3 server-skeleton ─┐
                     │                                 │
                     ├─► U4 citations  ────────────────┤
                     ├─► U5 case_law (+companions+res) ─┤
                     ├─► U6 legislation (+res+prompts) ─┤ (U4–U11 parallel)
                     ├─► U7 parliament (+res+prompts) ──┤
                     ├─► U8 bills ──────────────────────┤
                     ├─► U9 votes ──────────────────────┤
                     ├─► U10 committees ────────────────┤
                     └─► U11 hmrc ──────────────────────┘
                                                         ▼
                                       U12 assembly + build + parity audit
                                                         ▼
                                       U13 .mcp.json + marketplace wiring
                                                         ▼
                       U14 legal-research skill ── U15 wire legal-debate + READMEs  (parallel)
                                                         ▼
                                       U16 final adversarial parity + build verify
```

## Units

### U1 — Plugin scaffold & packaging  [foundation]
- **Files:** `plugins/uk-legal-mcp/.claude-plugin/plugin.json`, `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `NOTICE` (proprietary © 2026 Smartr365), and add plugin entry to `.claude-plugin/marketplace.json`.
- **Deps:** `@modelcontextprotocol/sdk`, `zod`, `@xmldom/xmldom`, `xpath`, `impit`; dev: `typescript`, `tsx`, `vitest`, `@types/node`. Node ≥20, `"type":"module"`.
- **ACs:** `npm install` resolves; `tsc --noEmit` passes on an empty `src`; plugin.json valid; marketplace.json still valid JSON.

### U2 — Shared infrastructure  [foundation] — depends U1
- **Files:** `src/shared/{http,envelope,errors,xml,annotations,cache,logging}.ts`.
- **Tasks:** 3 HTTP client profiles incl. impit legislation client (202-poll, WAF-marker + empty-body detection, search-with-params); URL-keyed TTL cache; envelope + `classifyError` (437→transient); tool-error return shape + 4 payload styles; `parseXml`+xpath+serialize; annotation presets; stderr logger.
- **ACs:** unit tests: envelope classification (timeout/404/401/403/429/5xx/437), DTD/ENTITY rejection, cache TTL expiry, tool-error JSON shape. `tsc` clean.
- **Skills:** none (infra).

### U3 — Server skeleton & entrypoint  [foundation] — depends U2
- **Files:** `src/server.ts`.
- **Tasks:** `McpServer` + `StdioServerTransport`; construct `deps`; call `registerX(server, deps)` for each module (stubs until modules land); register `server://about` static resource; port gateway `instructions=` block verbatim (minus fly/caching lines); stderr startup log; impit-loaded startup check.
- **ACs:** server starts on stdio; `initialize` + `tools/list` return without error (empty/partial catalogue acceptable pre-modules).

### U4 — citations module  [parallel] — depends U2
- **Files:** `src/modules/citations/{tools,patterns,models}.ts`.
- **Tasks:** 4 tools (`citations_parse` w/ fail-soft sampling, `citations_resolve` w/ TNA HEAD + retry, `citations_network`, `citations_format_oscola` fabrication guard). Port regex verbatim + `escapeRegExp`, `/g`, `$`-trim. `READ_ONLY_CLOSED` on parse/format.
- **ACs:** port `tests/test_citations.py` cases (neutral/report/legislation/SI/EU, ambiguous, mixed text, span-overlap dedup); output snake_case + enum literals.
- **Skills:** none.

### U5 — case_law module  [parallel] — depends U2
- **Files:** `src/modules/case_law/{tools,parsers,resources,models}.ts`; register 3 companion tools + 3 `judgment://` resource templates.
- **Tasks:** `case_law_search` (Atom parse; `tna:` bare-host ns; slug from `ukncn` attr; client-side `limit`; empty-not-error), `case_law_grep_judgment`; parsers (`extract_header/index/paragraph`) via xpath+serialize; companions + resources share cached `data.xml` fetch.
- **ACs:** fixture test against `uksc_2024_12_full.xml` — header fields, paragraph index eIds, para extraction, grep snippet; `{slug*}` slash round-trip.
- **Skills:** none.

### U6 — legislation module  [parallel] — depends U2
- **Files:** `src/modules/legislation/{tools,parsers,resources,prompts,models}.ts`.
- **Tasks:** `legislation_search` (impit Atom search-with-params), `legislation_get_section` (CLML; `extent` RestrictExtent walk-up, `in_force`, `version_date`, `max_chars` truncation), `legislation_get_toc`; 2 resource templates; 2 prompts (`legislation_summarise_act`, `legislation_compare_legislation`).
- **ACs:** section read returns extent/in_force/version_date; toc parse; WAF/437 → transient tool-error; prompts registered with prefixed names.
- **Skills:** none.

### U7 — parliament module  [parallel] — depends U2
- **Files:** `src/modules/parliament/{tools,parsers,resources,prompts,models}.ts`.
- **Tasks:** 9 tools (incl. `get_debate_divisions` Hansard-id→votes `divisionId` cross-resolve, `lookup_by_column` OSCOLA column, `member_interests` 20/page cap); 3 `hansard://` resources; 2 prompts. **Use `hansard-api.parliament.uk`** (never `hansard.parliament.uk`). Correct Swagger param names (`columnNumber` etc.).
- **ACs:** search returns citation metadata; division chain resolves; resources use `{debate_ext_id}`/`{contribution_ext_id}`/`{member_id}`; prompts prefixed.
- **Skills:** none.

### U8 — bills module  [parallel] — depends U2
- **Files:** `src/modules/bills/{tools,models}.ts`. 2 tools (`search_bills`, `get_bill`). `bills-api.parliament.uk/api/v1`.
- **ACs:** search + detail parse (stages, sponsors); snake_case output.

### U9 — votes module  [parallel] — depends U2
- **Files:** `src/modules/votes/{tools,models}.ts`. 2 tools; Commons (25/page) + Lords (`isGovernmentWin`).
- **ACs:** division search + detail with per-member records.

### U10 — committees module  [parallel] — depends U2
- **Files:** `src/modules/committees/{tools,models}.ts`. 3 tools. `committees-api.parliament.uk/api`.
- **ACs:** committee search/detail/membership + oral & written evidence.

### U11 — hmrc module  [parallel] — depends U2
- **Files:** `src/modules/hmrc/{tools,models}.ts`. 3 tools. `hmrc_get_vat_rate`, `hmrc_search_guidance` (GOV.UK; `fields[]` via append), `hmrc_check_mtd_status` (OAuth2 client-credentials; env-gated; `auth_required` when secrets absent; `vrn.replace(/^[GBgb]+/,'')`; fresh token per call).
- **ACs:** vat lookup; guidance search repeated-param URL correct; MTD returns `auth_required` without secrets.

### U12 — Assembly, build & parity audit  [integration] — depends U3–U11
- **Tasks:** finalize `server.ts` imports; `tsc` build to `dist/`; start on stdio; assert `tools/list`=31 exact names, `resources/list` incl. `server://about`, `resources/templates/list`=8 (incl. `{slug*}` round-trip), `prompts/list`=4 prefixed names. Commit `dist/`.
- **ACs:** parity audit passes against the Shared-Contract registry (no missing/extra/misnamed); build clean.

### U13 — Plugin MCP wiring  [integration] — depends U12
- **Files:** `plugins/uk-legal-mcp/.mcp.json` (`node ${CLAUDE_PLUGIN_ROOT}/dist/server.js`), marketplace entry finalized.
- **ACs:** `.mcp.json` valid; server launches from plugin root over stdio.

### U14 — legal-research skill  [skills] — depends U12 (needs final tool names)
- **Files:** `plugins/legal-research/.claude-plugin/plugin.json`, `skills/legal-research/SKILL.md` (+ references: tool catalogue, decision tree, citation-verification protocol). Add to marketplace.
- **ACs:** skill lists every tool with USE-WHEN + the verification protocol (`citations_resolve`→`citations_format_oscola` before any citation is emitted); references exact wire names.

### U15 — Wire legal-debate + docs  [skills] — depends U12
- **Files:** `plugins/legal-debate/skills/legal-debate/SKILL.md` (new "Authority & verification" section mapping debate steps → specific tools), `references/*` as needed; update `legal-debate/README.md`, root `README.md`, `marketplace.json` to note the `uk-legal` MCP companion.
- **ACs:** debate skill names specific tools at each step; "no fabricated citations" invariant now backed by `citations_resolve`.

### U16 — Final verification  [quality] — depends U13–U15
- **Tasks:** adversarial parity + build + skill-reference audit (every tool named in skills exists in the server; `tsc` clean; manifests valid).
- **ACs:** goal met — all features present; skills give explicit tool direction.

## Summary

| Phase | Units | Parallelism |
|---|---|---|
| Foundation | U1 → U2 → U3 | sequential |
| Modules | U4–U11 | 8-way parallel (disjoint paths) |
| Integration | U12 → U13 | sequential |
| Skills | U14, U15 | parallel |
| Quality | U16 | final |

**Execution strategy (ultracode):** Foundation built directly/sequentially (shared contract must be stable first). Modules U4–U11 fan out as a parallel workflow — each agent gets the design + Shared Contract + its module's journal spec, writes only `src/modules/<name>/*`, and self-verifies (`tsc` on its files + any fixture test). Integration/skills/verify run as subsequent sequenced steps with an adversarial parity gate.
