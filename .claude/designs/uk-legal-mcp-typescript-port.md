---
title: uk-legal-mcp TypeScript port (compliance-controlled reimplementation)
status: final
date: 2026-07-23
work_item: none (personal marketplace repo — no ADO ticket, per user)
author: Nicholas Wentworth-Shaw
related:
  - reference: C:\repos\uk-legal-mcp (Python/FastMCP, v0.6.1)
  - marketplace: C:\repos\claude-marketplace (legal-plugins)
  - consumer skill: plugins/legal-debate/skills/legal-debate
---

# uk-legal-mcp → TypeScript MCP server (in-plugin, compliance-controlled)

## 1. Problem & goal

We depend on a third-party hosted MCP server (`uk-legal-mcp`, `https://uk-legal-mcp.fly.dev/mcp`) for UK legal primary-source research. For **compliance** we need our own controlled implementation, owned and shipped inside our `legal-plugins` marketplace, so we govern the code, the deployment, and the data paths.

**Goal:** a **TypeScript** MCP server (built on `@modelcontextprotocol/sdk`) bundled in our plugin that reproduces **all** features of the Python original, and legal skills that give **explicit direction to call the specific tools** when authority/verification is required.

Done = (a) every source tool/resource/prompt available in our TS server, and (b) skills reference those tools by name at the right decision points.

## 2. Source of truth

The Python server (`C:\repos\uk-legal-mcp`) is the behavioural reference. It is a FastMCP v3 gateway mounting **8 namespaced modules** (`case_law`, `legislation`, `parliament`, `bills`, `votes`, `committees`, `citations`, `hmrc`), plus gateway-level companion tools, resources, prompts, and bridge transforms. The exhaustive per-tool spec is produced by the `uk-legal-mcp-inventory` workflow and folded into §9.

## 3. Scope & non-goals

**In scope (feature parity):**
- All domain tools across the 8 modules.
- Gateway companion tools: `judgment_get_header`, `judgment_get_index`, `judgment_get_paragraph`.
- MCP **resources**: `judgment://…`, `legislation://…`, `hansard://…`, `server://about`.
- MCP **prompts**: `summarise_act`, `compare_legislation`, `policy_reception_review`, `member_record_on_topic`.
- Structured response envelope + error taxonomy parity.
- XML-safety (XXE / billion-laughs / external-DTD defense).
- HMRC OAuth2 client-credentials + sandbox/prod switch (optional, env-gated).

**Non-goals (deliberately dropped — HTTP-deployment concerns not needed for a stdio plugin server):**
- Fly.io deployment, `Dockerfile`, `fly.toml`.
- uvicorn HTTP transport, `_HttpGuard` GET-SSE shim, `_AcceptNormalizer` (only needed for claude.ai's *hosted HTTP relay*; a stdio plugin server never sees those).
- Prometheus metrics, `/health`, `/metrics`, `/.well-known/*` custom routes.
- `PromptsAsTools` / `ResourcesAsTools` bridge tools — **deferred** (see §11): our target clients (Claude Code / Cowork) support resources & prompts natively. Revisit only if ChatGPT/tool-only parity is required.

> Transport decision: **stdio** (launched from the plugin `.mcp.json`). This removes the single largest chunk of the Python codebase (the HTTP gateway/uvicorn/Fly stack) with zero feature loss for our clients.

## 4. Target architecture

```
plugins/uk-legal-mcp/                 # new plugin in the legal-plugins marketplace
├── .claude-plugin/plugin.json
├── .mcp.json                         # launches the built server over stdio
├── package.json                      # @modelcontextprotocol/sdk, zod, fast-xml-parser, undici
├── tsconfig.json
├── README.md
├── NOTICE                            # proprietary notice (© 2026 Smartr365)
├── src/
│   ├── server.ts                     # McpServer: registers all modules, resources, prompts; stdio transport
│   ├── shared/
│   │   ├── http.ts                   # 3 HTTP client profiles (json / xml / legislation-impersonated)
│   │   ├── envelope.ts               # status enum, error classification, ToolError payloads
│   │   ├── xml.ts                    # safe XML parse (DTD/ENTITY reject + no-entity parser)
│   │   ├── errors.ts                 # structured ToolError (error_category, is_retryable, attempted, description)
│   │   └── annotations.ts            # readOnly/destructive/idempotent/openWorld presets
│   └── modules/
│       ├── caseLaw/{tools,parsers,resources,models}.ts
│       ├── legislation/{tools,parsers,resources,prompts,models}.ts
│       ├── parliament/{tools,parsers,resources,prompts,models}.ts
│       ├── bills/{tools,models}.ts
│       ├── votes/{tools,models}.ts
│       ├── committees/{tools,models}.ts
│       ├── citations/{tools,patterns,models}.ts
│       └── hmrc/{tools,models}.ts
└── dist/                             # compiled JS (committed or built on install — see §12)
```

- **One `McpServer` instance** (flat), not a gateway-of-mounted-submounts. FastMCP's `mount(namespace=…)` prefixing is reproduced by **registering each tool with its final namespaced name** (`case_law_search`, `legislation_get_section`, …). Same wire names, simpler runtime.
- **Tool names must match the Python wire names exactly** (module prefix + name), because the skills (and any existing prompts/muscle-memory) reference them. E.g. citations registers `name="parse"` under namespace `citations` → wire name `citations_parse`.
- Each module exports `register(server, deps)`; `server.ts` calls all of them.
- Shared HTTP clients are created once and passed via a `deps` object (the TS analogue of FastMCP's lifespan context).

## 5. Technology mapping (Python → TypeScript)

| Python | TypeScript | Notes |
|---|---|---|
| `fastmcp` / `mcp` | `@modelcontextprotocol/sdk` (`McpServer`, `StdioServerTransport`) | Native resources + prompts + sampling |
| `pydantic` input models + `Field(description=…)` | `zod` schemas with `.describe(...)` | Descriptions are load-bearing for tool routing — carry them verbatim |
| `httpx.AsyncClient` (JSON + XML) | `undici`/global `fetch` with per-profile headers | Two profiles: JSON `Accept: application/json`, XML `Accept: application/atom+xml,…` |
| `curl_cffi` Chrome impersonation (legislation) | **See §8 — open decision** | Node has no first-class JA3 impersonation |
| `lxml` + `defusedxml`-style hardening | **`@xmldom/xmldom` + `xpath` + `XMLSerializer`** + byte-level DTD/ENTITY pre-reject | ⚠️ NOT `fast-xml-parser` (see §18): need namespace-URI matching, `parentNode` walk-up, document order, mixed-content text, subtree serialisation |
| `lxml.html.fromstring` (HTML fallback) | `node-html-parser` or `cheerio` | Only for legislation HTML fallback path |
| `ctx.sample(...)` (MCP sampling) | `server.server.createMessage(...)` | For `citations_parse(disambiguate=True)` only |
| `ToolError(json.dumps({...}))` | **return** `{isError:true, content:[{type:'text',text:JSON.stringify(payload)}]}` (NOT `throw McpError`) | 4 non-uniform error styles to reproduce — see §18 |
| pydantic return models (auto outputSchema) | **zod OUTPUT schemas** + `structuredContent`; snake_case keys; exact enum literals | claude.ai validates against advertised outputSchema |
| `date`/`datetime` ISO strings | explicit `YYYY-MM-DD` / offset strings (NOT `Date.toISOString()`) | avoid UTC-`Z`/ms/date→datetime drift |
| `@lru_cache` compiled regex | module-level compiled `RegExp` consts | One-time compile |
| FastMCP caching middleware | small in-memory TTL cache in `deps`, keyed by fetched URL | per-endpoint TTLs (§18) |

## 6. Shared infrastructure design

**Envelope (`shared/envelope.ts`)** — reproduce the status enum exactly: `ok | empty | not_found | auth_required | upstream_validation | upstream_timeout | upstream_unavailable | unknown_error`. Port `classify_error()` (map fetch/undici errors + HTTP status → status,detail), `error_envelope()`, `not_found_envelope()`, `empty_envelope()`, `wrap_response()`.

**Errors (`shared/errors.ts`)** — `raiseToolError(category, {isRetryable, attempted, description})` where category ∈ `transient | not_found | auth_required | configuration | unknown`; `raiseHttpToolError(err, {attempted})` mirroring `deps.py`. Payload shape byte-compatible so agents can parse it.

**HTTP (`shared/http.ts`)** — three callables:
1. `jsonGet(url, opts)` — `Accept: application/json`, 30s timeout, redirects, shared UA `uk-legal-mcp/…`.
2. `xmlGet(url, opts)` — `Accept: application/atom+xml, application/xml, text/xml`.
3. `legislationGet(url)` / `legislationGetHtml(url)` — the impersonated client (§8), **including** the 202-async-render poll loop (`[1s,2s,4s]`) and the AWS-WAF challenge / empty-body detection that raises `LegislationUpstreamError` → transient ToolError. This logic is client-agnostic and ports regardless of which impersonation approach we pick.

**XML (`shared/xml.ts`)** — `parseXml(bytesOrStr)`: reject `<!DOCTYPE|ENTITY|NOTATION|ELEMENT|ATTLIST` at the byte level, then parse with `fast-xml-parser` configured to not process entities. Preserve element/attribute access helpers the parsers need (CLML section IDs, LegalDocML eIds, Atom entries).

**Annotations (`shared/annotations.ts`)** — presets: `READ_ONLY_OPEN` (`readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true`) for network tools; `READ_ONLY_CLOSED` (`openWorldHint:false`) for pure-regex citations tools (`citations_parse`, `citations_format_oscola`).

## 7. Tool description discipline (carry over)

The Python project treats tool descriptions as load-bearing (the "4-part pattern": USE WHEN… / what it returns / AFTER calling, call X if Y / authoritative-source clause) and content-neutral (procedural, never advocacy). **We carry the descriptions across verbatim** — they encode the cross-tool workflow chains (e.g. `case_law_search` → `judgment_get_header` → `judgment_get_index` → `judgment_get_paragraph`) that our skills will also reference. This directly serves goal (b).

## 8. KEY RISK — legislation.gov.uk WAF / TLS impersonation

legislation.gov.uk sits behind CloudFront + AWS WAF that **fingerprints the TLS/JA3 handshake** and returns HTTP **437** to non-browser clients. The Python server bypasses this with `curl_cffi` (`impersonate="chrome"`). Node/undici cannot spoof a JA3 fingerprint natively. Options (decision deferred to Phase 4):

| Option | Approach | Pro | Con |
|---|---|---|---|
| A. `cycletls` (or similar) | npm lib that shells to a bundled Go binary doing JA3 spoofing | Closest behavioural parity | Ships a native binary; supply-chain + cross-platform packaging burden — at odds with "compliance control" |
| B. i.AI Lex API only + CLML via a compliant path | Use `lex.lab.i.ai.gov.uk` for search; fetch CLML through a route that isn't JA3-walled | Pure-Node, no binaries | May not cover point-in-time section reads; unproven |
| C. Best-effort Chrome headers, document 437 as known limitation | Plain `fetch` with realistic headers; surface a clear transient error on 437 | Simplest, honest | Header spoofing likely insufficient against JA3 → legislation reads may fail |
| D. Server-side self-hosted proxy we control | Route legislation calls through our own compliant egress that terminates a browser-like TLS | Full control (fits compliance) | Extra infra to stand up |

Recommendation to propose: **A for functional parity now, with the impersonation isolated behind `legislationGet` so we can swap to D later** — but this is a genuine user decision (compliance posture vs. bundling a binary).

## 9. Module & tool inventory (parity checklist)

> Populated from the `uk-legal-mcp-inventory` workflow. Each tool ports with: exact wire name, zod schema mirroring the pydantic fields + descriptions, the upstream call, and the parser. Companion tools + resources + prompts listed separately.

### 9.8 citations (fully specified — no upstream API; pure OSCOLA regex)

| Wire name | Params | Returns | Notes |
|---|---|---|---|
| `citations_parse` | `text` (1–50k), `disambiguate` (bool, default false) | `{citations[], ambiguous[], text_length, parse_duration_ms}` | 5 patterns (neutral, law_report, legislation, SI, EU-retained); priority + span-overlap dedup; `disambiguate` uses MCP sampling for bare EWHC/UKUT/UKFTT |
| `citations_resolve` | `citation` (3–500) | `ParsedCitation` | Live **TNA HEAD** check for neutral cites → confidence 0.0 if absent; 1 retry then transient ToolError |
| `citations_network` | `case_uri` (slug ≥5) | `CitationNetwork{neutral_citations,legislation_refs,si_refs,eu_refs,law_report_refs,total,case_uri}` | Fetches `TNA/{uri}/data.xml`, extracts + dedups all citations |
| `citations_format_oscola` | `citation_type`, `confidence`, `resolved_url?`, + parsed fields | `{status, oscola, citation_type, resolved_url}` | **Guard against fabrication:** refuses on confidence 0.0 or missing resolved_url; fields must come from `citations_resolve` |

Regex constants to port verbatim: `NEUTRAL_COURT_PATTERN`, `REPORT_SERIES`, `AMBIGUOUS_COURTS={EWHC,UKUT,UKFTT}`, `_TNA_COURT_SLUGS`, `_COURT_DISPLAY`. Resolvers: `resolve_neutral_citation`, `resolve_si`, `resolve_legislation`.

### Complete surface (authoritative — from source registrations)

**Total: 31 tools (28 domain + 3 companion) + 9 resource templates + 4 prompts.** Exhaustive per-tool params/upstream/parser specs are in the inventory workflow journal (`…/subagents/workflows/wf_605147b2-6f7/journal.jsonl`) — execution agents read their module's line directly. Wire names below are the **exact** names the TS server must register (module prefix + registered name).

| Module | Count | Wire names |
|---|---|---|
| case_law | 2 | `case_law_search`, `case_law_grep_judgment` |
| legislation | 3 | `legislation_search`, `legislation_get_section`, `legislation_get_toc` |
| parliament | 9 | `parliament_search_hansard`, `parliament_policy_position_summary`, `parliament_find_member`, `parliament_member_debates`, `parliament_member_interests`, `parliament_search_petitions`, `parliament_get_debate_divisions`, `parliament_get_debate_contributions` ⚠️(not in public docs), `parliament_lookup_by_column` |
| bills | 2 | `bills_search_bills`, `bills_get_bill` |
| votes | 2 | `votes_search_divisions`, `votes_get_division` |
| committees | 3 | `committees_search_committees`, `committees_get_committee`, `committees_search_evidence` |
| citations | 4 | `citations_parse`, `citations_resolve`, `citations_network`, `citations_format_oscola` (see §9.8) |
| hmrc | 3 | `hmrc_get_vat_rate`, `hmrc_check_mtd_status` (OAuth), `hmrc_search_guidance` |
| **companion** (gateway) | 3 | `judgment_get_header`, `judgment_get_index`, `judgment_get_paragraph` |

**Resource templates (9):** `judgment://{slug*}/header`, `judgment://{slug*}/index`, `judgment://{slug*}/para/{eId}`; `legislation://{type}/{year}/{number}/section/{section}{?date}`, `legislation://{type}/{year}/{number}/toc{?date}`; `hansard://debate/{ext_id}/header`, `hansard://debate/{ext_id}/contribution/{ext_id}`, `hansard://member/{member_id}/biography`; `server://about`.

**Prompts (4):** `summarise_act(type, year, number)`, `compare_legislation(...)` [legislation module]; `policy_reception_review(policy_description, topic)`, `member_record_on_topic(member_name, topic)` [parliament module].

**Notable per-tool facts (for the build):**
- `case_law_search`: Atom parse via hardened XML; slug read from the `slug` attribute on `<tna:identifier type="ukncn">` (NOT `atom:id` which is now a UUID); `tna:` namespace is the bare host `https://caselaw.nationalarchives.gov.uk` with **no path** (recent contract change — getting it wrong yields empty slugs); `from_date`/`to_date` currently ignored upstream; `limit` sliced client-side; parse failures return an **empty** result (not an error).
- `parliament_get_debate_divisions`: cross-resolves Hansard division `id` → Lords/Commons Votes `divisionId` (`_populate_votes_ids` pattern) — an ID-space bridge to preserve.
- `hmrc_check_mtd_status`: OAuth2 client-credentials; env-gated; sandbox default.

## 10. Upstream API map (exact)

| Module | Base URL(s) | Auth | Notes |
|---|---|---|---|
| case_law | `https://caselaw.nationalarchives.gov.uk` | none | Atom `/atom.xml?query=`; judgment `/{uri}/data.xml`. 1000/5min |
| legislation | `https://www.legislation.gov.uk` — **both** Atom search AND CLML section/toc reads via the JA3-impersonated client | none | **WAF/437 walls search + reads — §8/§18.** No `lex.lab` call (stale docstrings). 3000/5min |
| parliament | `hansard-api.parliament.uk`, `members-api.parliament.uk/api`, `interests-api.parliament.uk/api/v1`, `petition.parliament.uk` | none | **Never** `hansard.parliament.uk` (Cloudflare 403). Interests 20/page cap |
| bills | `bills-api.parliament.uk/api/v1` | none | Session IDs change yearly |
| votes | `commonsvotes-api.parliament.uk` (25/page), `lordsvotes-api.parliament.uk` (`isGovernmentWin`) | none | |
| committees | `committees-api.parliament.uk/api` | none | Committees / Members / OralEvidence / WrittenEvidence |
| citations | none | n/a | pure regex + optional TNA HEAD check + optional client sampling |
| hmrc | `test-api.service.hmrc.gov.uk` (sandbox default) / `api.service.hmrc.gov.uk` (prod), `www.gov.uk/api/search.json` | OAuth2 (client-credentials, `read:vat`) for MTD only | `HMRC_CLIENT_ID/SECRET`, `HMRC_API_BASE` |

## 11. Resources, prompts, companions, bridges

- **Resources** (native MCP resource templates): `judgment://{slug*}/header|index|para/{eId}`, `legislation://{type}/{year}/{number}/section/{section}{?date}` + `/toc{?date}`, `hansard://debate/{ext_id}/header|contribution/{ext_id}`, `hansard://member/{id}/biography`, `server://about`. Registered on the single server (RFC-6570 wildcard `{slug*}` must survive — the Python note about mount-breaking substitution doesn't apply since we're flat).
- **Companion tools** (dict-returning mirrors of judgment resources for tool-only clients): `judgment_get_header`, `judgment_get_index`, `judgment_get_paragraph`. Keep — cheap and preserves parity.
- **Prompts** (native): `summarise_act`, `compare_legislation`, `policy_reception_review`, `member_record_on_topic`.
- **Bridges** (`list_resources`/`read_resource`/`list_prompts`/`get_prompt`): **deferred** — only needed for tool-only clients (ChatGPT). Flagged in Phase 4.

## 12. Plugin packaging & .mcp.json wiring

- New plugin `uk-legal-mcp` added to `.claude-plugin/marketplace.json`.
- `.mcp.json` launches over stdio:
  ```json
  { "mcpServers": { "uk-legal": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"] } } }
  ```
- **Build/ship decision (Phase 4):** commit `dist/` (works on install, no build step for users) **vs.** `npm install && build` on first use. Leaning commit-`dist/` for zero-friction plugin install; keep `src/` + `tsconfig` for our control/compliance.
- Node version floor: 20+ (global `fetch`, stable).

## 13. Skill wiring (goal part b)

Update `plugins/legal-debate/skills/legal-debate`:
- New **"Authority & verification"** section mapping debate steps → explicit tool calls, e.g.:
  - Proposition/strategy grounded in statute → `legislation_search` → `legislation_get_section` (check `extent`/`in_force`).
  - Case authority → `case_law_search` → `judgment_get_index`/`judgment_get_paragraph`; map what a judgment relies on → `citations_network`.
  - **Every citation an advocate advances → `citations_resolve` (and `citations_format_oscola`) before it appears in the output** — enforces the existing "no fabricated citations" invariant with a concrete mechanism.
  - Parliamentary/pepper-v-hart material → `parliament_search_hansard` → `parliament_lookup_by_column`.
- Add a dedicated **`legal-research`** skill (candidate): a tool-catalogue + decision-tree ("which tool for which question") so the direction is reusable beyond debate. **Phase 4:** confirm whether to add this skill or inline the guidance into legal-debate only.
- Update the `legal-debate` plugin README + marketplace to note the `uk-legal` MCP dependency.

## 14. Compliance & licensing

This package is **proprietary** — © 2026 Smartr365, all rights reserved (`package.json` `UNLICENSED` + `private`, and a proprietary `NOTICE`). All natural-language expression (tool/field/resource/prompt descriptions, the instructions block, and doc comments) is authored originally rather than carried over from the Python reference; only non-copyrightable functional data (API endpoints, enum/code values, citation regexes dictated by their formats) is shared. No third-party licence obligations are incurred by the shipped code.

## 15. Testing & verification

- **Parity audit** (adversarial workflow): assert every source wire-name/resource-URI/prompt-name exists in the TS server; diff the sets.
- **Unit**: citations regex suite (port the Python `test_citations.py` cases — neutral/report/legislation/SI/EU, disambiguation, mixed text, span-overlap).
- **Type/build**: `tsc --noEmit` clean; server starts on stdio and `list_tools` returns the full catalogue.
- **Live smoke** (optional, network): one call per module against the real upstreams.

## 16. Risks

1. **legislation.gov.uk WAF (§8)** — highest. Isolated behind one client so the impersonation strategy is swappable.
2. **XML fidelity** — CLML/LegalDocML/Atom parsing differences between lxml and fast-xml-parser (namespaces, mixed content, eId walk). Mitigate with fixture-based tests using the source's own `tests/live/fixtures`.
3. **Wire-name drift** — a renamed tool silently breaks skills. Mitigate with the parity audit.
4. **HMRC OAuth** — optional/env-gated; sandbox default; low risk.
5. **Hansard param honesty** — the Python project has AST audits for wire param names (`columnNumber` etc.); we port the *correct* names and add a lightweight check.

## 17. Decisions (Phase 4 — resolved)

1. **legislation.gov.uk access (§8):** ✅ **impit** — Apify's Rust/napi-rs client (prebuilt cross-platform binaries, JA3/JA4 + HTTP2 impersonation, fetch-like API, no subprocess). All legislation `legislationGet`/`legislationGetHtml`/search-with-params calls route through it. Isolate behind one `shared/http.ts` boundary so it can be swapped (e.g. to a self-hosted proxy) later. Note ongoing fingerprint-maintenance as a compliance cost; add a startup check that the native binary loaded, else fail with a clear message.
2. **HMRC MTD tool (§9):** ✅ **Include** `hmrc_check_mtd_status`, env-gated (`HMRC_CLIENT_ID`/`HMRC_CLIENT_SECRET`, `HMRC_API_BASE`), sandbox default; returns `auth_required` envelope when secrets absent. No secrets committed.
3. **Bridge tools (§11):** ✅ **Drop** the 4 transform bridges — target clients (Claude Code/Cowork) support resources+prompts natively. Final tool count = **31**. Parity audit expected-set excludes the bridges. Documented as a deliberate non-goal; trivial to add later for ChatGPT/tool-only clients.
4. **Skill wiring (§13):** ✅ **Dedicated `legal-research` skill** (tool catalogue + "which tool for which question" decision tree + citation-verification protocol) **plus** an *Authority & verification* section wired into `legal-debate` referencing specific tools at each debate step.
5. **Packaging (§12):** ✅ **Commit `dist/`** for zero-friction plugin install (keep `src/` + `tsconfig` for control/compliance and rebuilds).
6. **Plugin placement:** ✅ standalone **`uk-legal-mcp`** plugin in the `legal-plugins` marketplace; `legal-debate` README/marketplace note the `uk-legal` MCP as a companion dependency.
7. **Audit logging:** ✅ minimal structured **stderr** logging (tool + status + duration) ON, for the compliance rationale.

## 18. Critique resolutions & final technical decisions (Phase 2 → 3)

Adversarial critique (3 critics: parity, architecture/YAGNI, TS-porting-risk) run. Core inventory PASSED — all 31 tools + 9 resources present with exact wire names. Resolutions below **supersede** any conflicting earlier statement.

**Auto-applied (no user input needed):**
- **XML engine (was blocker):** use `@xmldom/xmldom` + `xpath` + `XMLSerializer` (pure-JS DOM ≈ lxml). fast-xml-parser cannot do default-namespace matching, `iterancestors()` walk-up for `RestrictExtent`/`RestrictStartDate` (legally load-bearing extent/version), `root.iter()` document order, `itertext()` mixed content, or `etree.tostring()` subtree serialisation. Keep byte-level DTD/ENTITY pre-reject. **Gate parsers on a fixture test** (`tests/live/fixtures/uksc_2024_12_full.xml`) reproducing extent walk-up + paragraph index before building. (libxmljs2 = alt, but native build; prefer binary-free xmldom.)
- **Prompt wire names are namespace-prefixed:** `legislation_summarise_act`, `legislation_compare_legislation`, `parliament_policy_reception_review`, `parliament_member_record_on_topic`. Verify via `prompts/list` at first run.
- **Response caching:** small in-memory TTL cache in `deps`, keyed by fetched URL (memoises data.xml / CLML / debate-JSON GETs shared by tools + resources). TTLs: legislation 24h, votes 24h, hmrc 90d, rest 1h.
- **Output-schema parity:** zod OUTPUT schemas + `structuredContent`; snake_case keys (`next_steps`, `content_truncated`, `si_year`…); exact enum literals (`neutral|law_report|legislation|si|eu_retained`).
- **ToolError shape:** return `{isError:true, content:[{type:'text',text:JSON.stringify(payload)}]}` — NOT `throw McpError`. Reproduce/normalise the 4 source error styles (`raise_tool_error` `{error_category,is_retryable,attempted,description}`; `_tna_head_check` `{…,message}`; `citations_resolve` ValueError; `citations_format_oscola` returns `{status,detail,is_retryable}`; parliament resources `error_envelope()` strings).
- **Legislation map:** BOTH search (Atom) and section/toc (CLML) reads go through the JA3-impersonated client; no `lex.lab` call exists. Impersonation boundary must expose a search-with-params call. WAF blast radius includes search.
- **Resource strings (exact):** `judgment://{slug*}/header|index|para/{eId}`; `legislation://{type}/{year}/{number}/section/{section}{?date}`; `legislation://{type}/{year}/{number}/toc{?date}`; `hansard://debate/{debate_ext_id}/header`; `hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}`; `hansard://member/{member_id}/biography`; **static** `server://about` (resources/list, not a template). → **8 templates + 1 static.**
- **`{slug*}` spike:** confirm the installed SDK's ResourceTemplate matcher captures slash-spanning `{slug*}`; else regex/path route. Coerce string template vars (`member_id`).
- **Dates:** emit `YYYY-MM-DD` / offset strings; never `Date.toISOString()`.
- **Minors:** `escapeRegExp` + `/g` on replaces + trim `$`-anchored IDs; zod `.int()`/`.gte()/.lte()`; ALL logs → **stderr** (stdout corrupts stdio JSON-RPC); `AbortSignal.timeout` per request; `URLSearchParams.append` for repeated `fields[]`; `vrn.replace(/^[GBgb]+/,'')` (char-set); fresh OAuth token per call (match source); map **437 → transient**; port the gateway `instructions=` routing preamble verbatim (minus fly/caching lines); MCP sampling must be fail-soft + capability-checked (no-op on Claude Code); `models.ts` = colocated output-zod + inferred type (no duplicate validator); pin zod to the SDK's expected major + test that descriptions/constraints survive into inputSchema.
- **Defaults taken without asking:** commit `dist/` (zero-friction install); minimal **stderr audit logging ON** (tool + status + duration — compliance-aligned, transport-independent; full Prometheus stays dropped).

**Deferred to Phase-4 question batch (below):** legislation access strategy (Q1), HMRC MTD tool (Q2), bridge tools / strict 35-tool parity (Q3), skill-wiring approach (Q4).
