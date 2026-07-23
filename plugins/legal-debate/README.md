<div align="center">

# 🗣️ legal-debate

**Structured multi-agent debate for UK legal problem-solving.**

[![Type](https://img.shields.io/badge/type-skill-blue?style=flat-square)](./skills/legal-debate)
[![Category](https://img.shields.io/badge/category-legal-blueviolet?style=flat-square)](#)
[![Jurisdiction](https://img.shields.io/badge/jurisdiction-E%26W%20%2F%20Commonwealth-informational?style=flat-square)](#what-it-does)
[![Companion](https://img.shields.io/badge/companion-uk--legal-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](../uk-legal)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)](#disclaimer)

</div>

---

Structured multi-agent debate for **legal problem-solving**, tailored to **England & Wales and Commonwealth silk systems**. A team of 2–5 agents — cast as **King's Counsel** (or Senior Counsel) — independently develop opposing or competing cases, then challenge each other's reasoning through adversarial debate rounds until consensus emerges or a judge synthesis decides.

> **Not legal advice.** This plugin produces structured argument analysis for informational and preparatory purposes only. It does not create a solicitor/barrister–client relationship and may not reflect current law. Have all output reviewed by a qualified solicitor or barrister before relying on it.

> **Companion:** install the **`uk-legal`** plugin (same marketplace) so advocates can ground their submissions in primary sources — the *Authority & verification* section directs them to `case_law_search`, `legislation_get_section`, `parliament_search_hansard`, and the `citations_parse → resolve → format_oscola` verification chain. The debate runs without it, but authorities will be unverified.

## What it does

Given a legal question, the skill:

0. **Pre-processes evidence** (when the question comes with contracts, correspondence, pleadings, witness statements, or exhibit bundles): reads the material once and distils it into a **structured, greppable digest file** — parties, chronology, agreed/disputed facts, verbatim key terms, admissions, cited authorities, and spotted issues, each with a stable ID and source locator. It then **stops and prompts you to `/clear` and restart the debate** referencing the digest, so the raw evidence never bloats the debate context. Extraction only — it flags issues, it doesn't decide them.
1. **Classifies** the problem (litigation strategy, contract, statutory interpretation, risk assessment, choice-of-forum/law) and confirms jurisdiction & governing law.
2. **Chooses the debate shape** —
   - **Proposition** (a yes/no question): agents split into sides and argue the *same* proposition **for and against**, as opposing KCs.
   - **Strategy-selection** (a "which approach?" question): agents each develop a *distinct* strategy and compare.
3. **Spawns** the team, each agent cast as leading counsel and told to argue with cited authority and pre-empted counter-arguments.
4. **Facilitates** two debate rounds — Challenge and Rebuttal — where agents attack weaknesses with specific legal grounds and concede genuine flaws.
5. **Resolves** to a consensus, or falls back to a **judge synthesis** weighting arguments by strength of authority.
6. **Outputs** a weighted comparison table, a ≤3-sentence verdict, key authorities, and a disclaimer — then offers optional **appeal** and **case-strengthening** stages. Every deliverable is also **written to a file** under a `legal-review/` directory (verdict always; judge's ruling, appeal ruling, and case-strengthening package when those stages run), each carrying the disclaimer, generation date, and jurisdiction — the files supplement the inline output, never replace it.

## When it triggers

Phrases like: *"debate this legal question"*, *"argue both sides"*, *"evaluate legal strategies"*, *"moot this"*, *"which clause approach is safer"*, *"assess litigation risk"*, *"what's the strongest argument"* — including when the question arrives with **evidence** to digest first.

## Usage

Invoke the `Legal Debate` skill and describe the question, the facts, and the governing jurisdiction. Example:

> Debate whether this £50k-per-day delay clause is an enforceable liquidated-damages provision or an unenforceable penalty under English law. Facts: [...].

If you attach evidence, the skill digests it first and asks you to `/clear` before the debate begins. Otherwise it confirms the plan (classification, jurisdiction, positions, agent count) before spawning the team.

## Structure

```
legal-debate/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── legal-debate/
        ├── SKILL.md
        └── references/
            ├── evidence-digest.md          # Phase 0: greppable digest schema + /clear handoff
            ├── debate-protocol.md          # facilitation rules, citation hygiene, edge cases
            ├── output-format.md            # comparison table, criteria, verdict, disclaimer
            └── appeals-and-strengthening.md # appeal mechanics + case-strengthening package
```

## Provenance

Ported from the software-engineering `debate` skill (smartr365-dev), re-targeted to legal reasoning: engineering problem classes become legal problem classes; a debate-shape step chooses between *for-and-against* on a proposition and *multi-strategy* comparison; agents argue as **King's Counsel** advocates rather than solution investigators; citation hygiene and jurisdiction handling are added; and every output carries a not-legal-advice disclaimer.

## Disclaimer

This plugin produces **informational analysis only** — not legal advice, and no lawyer–client relationship. Verify all cited authorities and have output reviewed by a qualified, jurisdictionally-licensed solicitor or barrister before relying on it.
