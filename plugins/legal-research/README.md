# legal-research

Decision-tree guidance for grounding UK legal work in **primary sources** via the `uk-legal` MCP tools, plus a **mandatory citation-verification protocol** that prevents fabricated authorities.

> **Not legal advice.** Informational/preparatory use only. Have output reviewed by a qualified solicitor or barrister.

## What it does

The `legal-research` skill routes a UK legal question to the right `uk-legal` tool (case law, legislation, Parliament/Hansard, bills, votes, committees, citations, HMRC) and enforces the anti-fabrication flow: **parse → resolve → format** every OSCOLA citation before it appears in output; check territorial `extent` and `in_force` status on every statutory provision.

## Requires

The **`uk-legal`** plugin (same marketplace) — it provides the `uk-legal` MCP server whose tools this skill directs. Install both.

## Structure

```
legal-research/
├── .claude-plugin/plugin.json
└── skills/legal-research/
    ├── SKILL.md                      # decision tree + citation-verification protocol
    └── references/tool-catalogue.md  # full per-tool catalogue (31 tools, 9 resources, 4 prompts)
```
