# legal-debate

Structured multi-agent debate for **legal problem-solving**, tailored to **England & Wales and Commonwealth silk systems**. A team of 2-5 agents — cast as **King's Counsel** (or Senior Counsel) — independently develop opposing or competing cases, then challenge each other's reasoning through adversarial debate rounds until consensus emerges or a judge synthesis decides.

> **Not legal advice.** This plugin produces structured argument analysis for informational and preparatory purposes only. It does not create a solicitor/barrister–client relationship and may not reflect current law. Have all output reviewed by a qualified solicitor or barrister before relying on it.

> **Companion:** install the **`uk-legal`** plugin (same marketplace) so advocates can ground their submissions in primary sources — the *Authority & verification* section directs them to `case_law_search`, `legislation_get_section`, `parliament_search_hansard`, and the `citations_parse → resolve → format_oscola` verification chain. The debate runs without it, but authorities will be unverified.

## What it does

Given a legal question, the skill:

1. **Classifies** the problem (litigation strategy, contract, statutory interpretation, risk assessment, choice-of-forum/law) and confirms jurisdiction & governing law.
2. **Chooses the debate shape** —
   - **Proposition** (a yes/no question): agents split into sides and argue the *same* proposition **for and against**, as opposing KCs.
   - **Strategy-selection** (a "which approach?" question): agents each develop a *distinct* strategy and compare.
3. **Spawns** the team, each agent cast as leading counsel and told to argue with cited authority and pre-empted counter-arguments.
4. **Facilitates** two debate rounds — Challenge and Rebuttal — where agents attack weaknesses with specific legal grounds and concede genuine flaws.
5. **Resolves** to a consensus, or falls back to a **judge synthesis** weighting arguments by strength of authority.
6. **Outputs** a weighted comparison table, a ≤3-sentence verdict, key authorities, and a disclaimer.

## When it triggers

Phrases like: *"debate this legal question"*, *"argue both sides"*, *"evaluate legal strategies"*, *"moot this"*, *"which clause approach is safer"*, *"assess litigation risk"*, *"what's the strongest argument"*.

## Usage

Invoke the `Legal Debate` skill and describe the question, the facts, and the governing jurisdiction. Example:

> Debate whether this £50k-per-day delay clause is an enforceable liquidated-damages provision or an unenforceable penalty under English law. Facts: [...].

The skill will confirm the plan (classification, jurisdiction, positions, agent count) before spawning the team.

## Structure

```
legal-debate/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── legal-debate/
        ├── SKILL.md
        └── references/
            ├── debate-protocol.md   # facilitation rules, citation hygiene, edge cases
            └── output-format.md      # comparison table, criteria, verdict, disclaimer
```

## Provenance

Ported from the software-engineering `debate` skill (smartr365-dev), re-targeted to legal reasoning: engineering problem classes become legal problem classes; a debate-shape step chooses between *for-and-against* on a proposition and *multi-strategy* comparison; agents argue as **King's Counsel** advocates rather than solution investigators; citation hygiene and jurisdiction handling are added; and every output carries a not-legal-advice disclaimer.
