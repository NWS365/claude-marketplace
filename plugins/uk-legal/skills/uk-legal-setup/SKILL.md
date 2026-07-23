---
name: UK Legal Setup
description: This skill should be used to set up or reconfigure the uk-legal plugin — when the user says "set up uk-legal", "configure uk-legal", "onboarding", "cold start", "add my API keys", "connect Companies House / EPO / HMRC", "register for the patent/companies API", "which uk-legal tools need keys", or on a first install. It runs a short practice-profile interview (jurisdiction, silk system, citation style) and walks the user through registering for and configuring the free API keys the keyed source families need.
version: 0.1.0
argument-hint: "[--redo | --profile-only | --keys-only | --check]"
---

# UK Legal Setup Skill

> **ANNOUNCE ON INVOCATION:** When this skill is loaded, tell the user: "Using uk-legal-setup — I'll capture your practice profile and help you configure any API keys. I'll never echo a key back or write one into the repository."

This skill does two things, either or both depending on the flag:

1. **Practice profile** — a short interview that writes `~/.claude/uk-legal-profile.md`. The `legal-research` and `legal-debate` skills read this file to default jurisdiction, silk-system framing, and citation style so the user does not restate them each session.
2. **API-key onboarding** — probes which keyed source families are unconfigured, then for each one explains what it unlocks, opens the free registration page, captures the pasted key, and sets it as an OS user environment variable.

## Flags

- (none) — run both parts: profile, then key onboarding.
- `--redo` — re-run the full flow and overwrite the existing profile.
- `--profile-only` — only the practice-profile interview.
- `--keys-only` — only the API-key onboarding.
- `--check` — probe configuration and report status only; change nothing.

## Invariants

- **NEVER** echo a captured key back to the user, write it into a chat message, or store it in any file tracked by git (not `.mcp.json`, not the profile, not a README). Keys go only into the OS user environment.
- **NEVER** invent or guess a key. If the user does not have one, guide them to register; if they decline, record the family as "skipped — keyless tools still work" and move on.
- **ALWAYS** tell the user that a newly-set key is picked up only after the MCP server restarts — i.e. after they restart Claude Code — then confirm with a probe.
- **ALWAYS** make clear which families are keyless and need no action (see below).
- This skill configures tooling; it gives **no legal advice**.

## Part 0 — Detect current state

1. Read `~/.claude/uk-legal-profile.md`. If it exists and no `--redo`/`--profile-only` was requested for a fresh run, note it and offer to keep or update it.
2. **Probe the keyed families** by making one cheap tool call each and reading the result envelope. A `configuration` (or `auth_required`) error means the key is unset; an `ok`/`no_results` result means it is working:
   - Companies House → `companies_house_search` with `query: "test"`.
   - EPO OPS → `epo_ops_search_patents` with `query: "test"`.
   - HMRC (MTD only) → `hmrc_check_mtd_status` with `vrn: "123456789"`.
3. Report a status table: family → configured ✓ / not configured ⚪ / keyless (n/a).

Under `--check`, stop here.

## Part 1 — Practice profile (`--profile-only` or full run)

Interview briefly (offer defaults; accept "leave for later" → write `[PLACEHOLDER]`). Capture:

- **Default jurisdiction** — England & Wales (default) / Scotland / Northern Ireland / a named Commonwealth silk jurisdiction. This is the jurisdiction the other skills assume unless a question states otherwise.
- **Silk system** — does the working jurisdiction appoint King's Counsel / Senior Counsel? (England & Wales and most Commonwealth silk jurisdictions: yes. This drives `legal-debate`'s advocate personas.)
- **Primary practice areas** — free text (e.g. commercial, corporate/insolvency, IP, public law).
- **Citation style** — OSCOLA (default); note any house variant.
- **Court-tier focus** — optional (e.g. First-tier Tribunal, High Court, Court of Appeal).

Write the answers to `~/.claude/uk-legal-profile.md` using the template in `references/profile-template.md`. Date the footer. Show the user what was captured and confirm before finalising.

## Part 2 — API-key onboarding (`--keys-only` or full run)

Three families need a **free** key; the rest are keyless. For each unconfigured keyed family the user wants to enable, follow this loop (details, URLs, and what each unlocks are in `references/api-registration.md`):

1. **Explain** what the family unlocks and its free-tier terms.
2. **Open the registration page** — print the URL and offer to open it. Preferred: suggest the user run the URL with the shell prefix, e.g. `!start <url>` (Windows), `!open <url>` (macOS), `!xdg-open <url>` (Linux). If the `claude-in-chrome` tools are available and the user prefers, open it in a browser tab instead. Registration requires a human login, so guide the steps — do not attempt to automate the sign-up.
3. **Capture** the key(s): ask the user to paste them. Treat them as secrets (see invariants).
4. **Set** them as OS user environment variables (see *Setting keys* below).
5. **Confirm**: tell the user to restart Claude Code, then re-probe that family with the Part 0 call and report ✓ or the error.

### The three keyed families
- **Companies House** — `COMPANIES_HOUSE_API_KEY`. Unlocks `companies_house_*` (company profiles, officers, persons with significant control / beneficial ownership).
- **EPO OPS** — `EPO_OPS_CONSUMER_KEY` and `EPO_OPS_CONSUMER_SECRET`. Unlocks `epo_ops_*` (patents including GB; first-pass IP clearance / freedom-to-operate).
- **HMRC** — `HMRC_CLIENT_ID` and `HMRC_CLIENT_SECRET` (optionally `HMRC_API_BASE` to switch sandbox→production). Unlocks only `hmrc_check_mtd_status`; `hmrc_get_vat_rate` and `hmrc_search_guidance` are keyless.

### Keyless — no action needed
Case law, legislation, Parliament/Hansard, bills, votes, committees, OSCOLA citations, **The Gazette**, and **EUR-Lex** need no key. Say so, so the user does not think setup is incomplete.

### Setting keys (OS user environment variables)
Keys are stored as **OS user environment variables** — never in the repository. This keeps secrets out of git and is what the MCP server reads (`process.env`).

- **Windows** (user's shell is PowerShell): `setx COMPANIES_HOUSE_API_KEY "<value>"` (persists for the user; a new process — i.e. a Claude Code restart — is needed to inherit it). Have the user run it via `!setx ...`, or run it for them if permitted. Do not print the value afterwards.
- **macOS / Linux**: append `export COMPANIES_HOUSE_API_KEY="<value>"` to the user's shell profile (`~/.zshrc` or `~/.bashrc`), then a new session/Claude Code restart picks it up.

Do **not** write keys into the plugin's `.mcp.json` (it is tracked by git). If the user insists on a file-based approach, the correct place is a git-ignored file outside the repo, not `.mcp.json`.

## Part 3 — Wrap up

Summarise: profile written (path), families now configured, families skipped (with the note that their keyless siblings still work), and the reminder to restart Claude Code for new keys to take effect. Offer `--check` later to re-verify.

## Reference

- `references/api-registration.md` — per-family registration steps, URLs, free-tier limits, and env-var names.
- `references/profile-template.md` — the practice-profile file format the other skills read.
