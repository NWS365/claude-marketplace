<div align="center">

# ⚖️ legal-plugins

**A Claude Code plugin marketplace for UK legal reasoning & research.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square&logo=typescript&logoColor=white)](#quality)
[![Tests](https://img.shields.io/badge/tests-426%20passing-brightgreen?style=flat-square&logo=vitest&logoColor=white)](#quality)
[![Coverage](https://img.shields.io/badge/coverage-99%25%20lines-brightgreen?style=flat-square)](#quality)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)](#disclaimer)
[![Plugins](https://img.shields.io/badge/plugins-3-blueviolet?style=flat-square)](#plugins)
[![MCP tools](https://img.shields.io/badge/MCP%20tools-41-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](./plugins/uk-legal)

</div>

---

Three plugins that help Claude reason about, research, and stress-test UK legal
questions — grounded in **primary sources with citation-grade metadata**, never
model memory.

## Add this marketplace

```
/plugin marketplace add <this-repo-url>
```

Then browse and install plugins with `/plugin`.

## Plugins

| Plugin | Category | Description |
|--------|----------|-------------|
| [`uk-legal`](./plugins/uk-legal) | legal | TypeScript **MCP server** — UK case law, legislation, Parliament/Hansard, bills, votes, committees, OSCOLA citations, HMRC guidance, the Companies House register, The Gazette official notices, EU/retained law (EUR-Lex), and EPO patents. Returns primary sources with citation metadata (**41 tools · 9 resources · 4 prompts**). |
| [`legal-research`](./plugins/legal-research) | legal | Decision-tree guidance for grounding UK legal work in primary sources via the `uk-legal` MCP tools, with a mandatory citation-verification protocol. Companion to `uk-legal`. |
| [`legal-debate`](./plugins/legal-debate) | legal | Multi-agent debate for legal problem-solving (England & Wales / Commonwealth silk systems) — digests supplied evidence into a greppable fact record, then King's Counsel argue a proposition for and against, or compare competing strategies, and produce a weighted comparison, a reasoned verdict, and optional appeal & case-strengthening stages. |

> `legal-debate` and `legal-research` are strongest when `uk-legal` is installed —
> they direct their advocates and researchers to verify every authority against
> its primary-source tools.

## Setup

After installing `uk-legal`, run the **`uk-legal-setup`** skill (say "set up uk-legal" or
"add my API keys"). It captures a short practice profile — default jurisdiction, silk
system, citation style — to `~/.claude/uk-legal-profile.md`, which `legal-research` and
`legal-debate` read so you don't restate it each session. It then walks you through
registering for and configuring the **free** API keys the three keyed source families need
(Companies House, EPO patents, HMRC MTD); everything else — case law, legislation,
Parliament, votes, committees, bills, citations, The Gazette, and EUR-Lex — is keyless and
needs no setup. Keys are stored as OS environment variables and never written into the repo.

## Quality

The build, test, and coverage pills above report the **`uk-legal`** MCP server —
the marketplace's substantive code. From `plugins/uk-legal`:

```bash
npm run build          # tsc → dist/  (committed for zero-friction install)
npm test               # vitest — 426 tests, upstreams stubbed (no network)
npm run test:coverage  # ~99% lines · ~99% functions · ~90% branches (gated)
npm run verify         # parity + smoke: 41 tools / 9 resources / 4 prompts
```

Figures reflect the latest local run; there is no hosted CI in this repository.

## Structure

```
.
├── .claude-plugin/
│   └── marketplace.json      # marketplace manifest listing the plugins below
└── plugins/
    ├── uk-legal/             # TypeScript MCP server (UK legal primary sources)
    ├── legal-research/       # tool-routing + citation-verification skill
    └── legal-debate/         # multi-agent legal debate skill
```

## Disclaimer

Plugins in this marketplace that reason about legal questions produce
**informational analysis only** — not legal advice, and no lawyer–client
relationship. Verify all cited authorities and have output reviewed by a
qualified, jurisdictionally-licensed solicitor or barrister before relying on
it. See each plugin's README for details.
