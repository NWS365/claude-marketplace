---
name: Legal Research
description: This skill should be used when the user needs to research or verify UK law — "find case law", "what does section X say", "read this Act", "check territorial extent / is this in force", "search Hansard", "check this citation", "is this case real", "verify this authority", "format an OSCOLA citation", or "check HMRC guidance / VAT rate". It directs which uk-legal MCP tool to call for which question and enforces a citation-verification protocol that prevents fabricated authorities.
version: 0.2.0
---

# Legal Research Skill

> **ANNOUNCE ON INVOCATION:** When this skill is loaded, tell the user: "Using legal-research skill — routing to uk-legal MCP tools and verifying every citation."

> **NOT LEGAL ADVICE.** These tools return primary sources and citation metadata for informational and preparatory purposes only. They do not interpret the law. Have output reviewed by a qualified solicitor or barrister before relying on it.

This skill tells you **exactly which tool to call** for a UK legal question, and enforces the **anti-fabrication protocol**: a UK legal citation, court name, statutory section number, or Hansard column is **never** answered from memory — it comes from a tool, verified.

## Prerequisite

The tools live in the **`uk-legal`** plugin's MCP server (server key `uk-legal`). In Claude Code they are exposed as `mcp__uk-legal__<tool>` (e.g. `mcp__uk-legal__case_law_search`). If they are not available, tell the user to install the `uk-legal` plugin from the `legal-plugins` marketplace and retry. Below, tools are named by their wire name (drop the `mcp__uk-legal__` prefix for readability).

## Practice profile (optional)

At the start, read `~/.claude/uk-legal-profile.md` if it exists. Apply its `default_jurisdiction` (assume it unless the question states otherwise) and `citation_style` (default OSCOLA). If the file is absent, behave as normal (England & Wales / OSCOLA defaults) — do **not** block on it. The profile is written by the `uk-legal-setup` skill; if the user asks to configure defaults or API keys, point them there.

## Invariants

- **ALWAYS** prefer a uk-legal tool over training data or generic web search for any UK legal fact (case name, neutral citation, section number, commencement, Hansard column, division result, HMRC rate).
- **NEVER** emit an OSCOLA citation that has not passed `citations_resolve` (and, for formatting, `citations_format_oscola`). Constructing a citation from "known" fields is the primary fabrication route — the format tool is the guard.
- **ALWAYS** check `extent` and `in_force`/`version_date` on a legislation section before relying on it — a provision may be repealed, prospective, or apply differently across England, Wales, Scotland, and Northern Ireland.
- **ALWAYS** separate a verified exact match from nearby candidates; say which was confirmed.
- **ALWAYS** carry the source URL / citation metadata into the answer so the user can check it.
- **ALWAYS** surface any `coverage_note` (from `legislation_search` / `legislation_get_toc`) or devolved caveat in a section's `warnings` (from `legislation_get_section`), and warn the human accordingly. This server retrieves devolved **statute** (Scottish `asp`/`ssi`, Welsh `asc`/`anaw`, NI `nia`) but has **no source for devolved case law or legislature proceedings** — so never imply Scottish/NI/Welsh judicial interpretation has been checked.

## Which tool? (decision tree)

- **"Find a case / what did a court decide"** → `case_law_search` (filter by court/judge/party/date). Then drill into the judgment:
  - metadata (parties, judges, neutral citation) → `judgment_get_header` (or `judgment://{slug}/header`)
  - paragraph map → `judgment_get_index` (or `judgment://{slug}/index`)
  - a specific paragraph → `judgment_get_paragraph` (or `judgment://{slug}/para/{eId}`)
  - find text inside one judgment → `case_law_grep_judgment`
  - what a judgment relies on (cases/legislation/SIs/EU) → `citations_network`
- **"What does the statute / SI say"** → `legislation_search` → `legislation_get_toc` (structure) → `legislation_get_section` (the provision, with `extent`/`in_force`/`version_date`). Summaries: prompt `legislation_summarise_act`; compare two: `legislation_compare_legislation`.
- **"What was said in Parliament / pepper v Hart material"** → `parliament_search_hansard`; resolve a volume/column citation → `parliament_lookup_by_column`; a whole debate's contributions → `parliament_get_debate_contributions`; how a topic is being received → `parliament_policy_position_summary` (facts, no LLM labels) or prompt `parliament_policy_reception_review`.
- **"A member's record / interests"** → `parliament_find_member` (name → id) → `parliament_member_debates` / `parliament_member_interests` (or prompt `parliament_member_record_on_topic`).
- **"A bill's progress"** → `bills_search_bills` → `bills_get_bill` (stages, sponsors, publications).
- **"How did they vote / division result"** → `votes_search_divisions` → `votes_get_division` (per-member records; Lords include `isGovernmentWin`). A debate's divisions → `parliament_get_debate_divisions` (chains to `votes_get_division`).
- **"Committee scrutiny / evidence"** → `committees_search_committees` → `committees_get_committee` → `committees_search_evidence`.
- **"A citation in this text / is this citation real"** → `citations_parse` (extract all) → `citations_resolve` (verify each) → `citations_format_oscola` (format). See protocol below.
- **"VAT rate / HMRC guidance / MTD status"** → `hmrc_get_vat_rate`, `hmrc_search_guidance`, `hmrc_check_mtd_status` (needs configured HMRC OAuth; returns `auth_required` otherwise).

## Jurisdiction coverage — devolved & Scots law (warn the human)

This server's coverage is **not uniform across the UK**. Be explicit with the user about what it can and cannot verify:

- **Scotland.** `legislation_*` can retrieve Scottish **statute** — Acts of the Scottish Parliament (`asp`) and Scottish SIs (`ssi`). But there is **no source for Scottish case law** (the Court of Session, High Court of Justiciary, and Sheriff Courts are not on Find Case Law) or **Holyrood proceedings**. So a Scots-law question can be answered on statute only; how the Scottish courts have applied a provision **cannot be verified here**. Do **not** run Scottish case citations through `citations_*` — they will not resolve. Scots law is a **distinct legal system**: tell the user that judicial interpretation must come from a Scottish source (SCTS / BAILII) or a Scottish-qualified practitioner.
- **Northern Ireland.** Statute is retrievable (`nia`), but **NI case law is not on Find Case Law** (it hosts England & Wales only), so NICA/NIQB neutral citations will **not** resolve — do not run them through `citations_*`, and do not filter `case_law_search` by an NI court. Point the user to BAILII or the NI Courts & Tribunals Service for NI judgments.
- **Wales.** For **case law**, Wales is part of the single England & Wales jurisdiction — Welsh cases are decided in the E&W courts (EWCA/EWHC), which are fully covered. Only Welsh **statute** (`asc`/`anaw`) is distinct, and it carries the devolved caveat.
- **England & Wales.** Full coverage — case law, legislation, Hansard, and the rest.

When a legislation tool returns a `coverage_note` or a devolved `warnings` entry, **repeat it to the user**; do not bury it.

## Citation-verification protocol (mandatory, anti-fabrication)

Whenever a citation will appear in output:

1. **Extract** — run `citations_parse` on the source text (memo, judgment, email). It classifies neutral citations, law reports, legislation sections, SIs, and retained EU law, and flags ambiguous ones.
2. **Verify** — pass each citation through `citations_resolve`. For neutral citations it performs a **live TNA existence check**; a `confidence` of `0.0` means the document does **not** exist at the resolved URL. Do **not** quote a `0.0` citation.
3. **Format** — produce the OSCOLA string only via `citations_format_oscola`, passing the fields `citations_resolve` returned. It **refuses** to format a `0.0`-confidence or unresolved citation — that refusal is the fabrication guard. Never hand-build the citation string.
4. If a tool fails or refuses, **surface the failure and ask the user for the source URL** — do not manufacture a citation.

## Reference

See `references/tool-catalogue.md` for the full per-tool catalogue (parameters, returns, and the workflow chain each tool participates in).
