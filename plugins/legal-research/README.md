<div align="center">

# 🔍 legal-research

**Route UK legal questions to primary sources — and verify every citation.**

[![Type](https://img.shields.io/badge/type-skill-blue?style=flat-square)](./skills/legal-research)
[![Category](https://img.shields.io/badge/category-legal-blueviolet?style=flat-square)](#)
[![Requires](https://img.shields.io/badge/requires-uk--legal-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](../uk-legal)
[![Protocol](https://img.shields.io/badge/citations-verified-brightgreen?style=flat-square)](#what-it-does)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)](#disclaimer)

</div>

---

Decision-tree guidance for grounding UK legal work in **primary sources** via the `uk-legal` MCP tools, plus a **mandatory citation-verification protocol** that prevents fabricated authorities.

> **Not legal advice.** Informational/preparatory use only. Have output reviewed by a qualified solicitor or barrister before relying on it.

## What it does

The `legal-research` skill routes a UK legal question to the right `uk-legal` tool (case law, legislation, Parliament/Hansard, bills, votes, committees, citations, HMRC) and enforces the anti-fabrication flow:

- **`parse → resolve → format`** every OSCOLA citation before it appears in output — the format step refuses to emit a citation that did not resolve, which is the fabrication guard.
- Check territorial **`extent`** and **`in_force`** status on every statutory provision before relying on it.
- Separate a verified exact match from nearby candidates, and carry the source URL / citation metadata into the answer so it can be checked.

## Requires

The **`uk-legal`** plugin (same marketplace) — it provides the `uk-legal` MCP server whose tools this skill directs. Install both; tools appear as `mcp__uk-legal__<tool>`.

## Structure

```
legal-research/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── legal-research/
        ├── SKILL.md                      # decision tree + citation-verification protocol
        └── references/
            └── tool-catalogue.md         # full per-tool catalogue (31 tools, 9 resources, 4 prompts)
```

## Disclaimer

This plugin produces **informational analysis only** — not legal advice, and no lawyer–client relationship. Verify all cited authorities and have output reviewed by a qualified, jurisdictionally-licensed solicitor or barrister before relying on it.
