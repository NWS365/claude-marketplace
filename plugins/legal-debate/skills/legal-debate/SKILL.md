---
name: Legal Debate
description: This skill should be used when the user asks to "debate this legal question", "evaluate legal strategies", "argue both sides", "compare legal positions", "what's the strongest argument", "moot this", "stress test this argument", "assess litigation risk", "which clause approach is safer", "appeal this outcome", "how do I win this position", or needs multiple perspectives on a legal problem. Also use it when the user supplies evidence to work through before arguing — "digest these documents", "extract the key facts from this bundle", "prepare this evidence for a debate" — which triggers an evidence pre-processing step first. Spawns a dynamic team of agents that argue competing legal positions, then debate to find the strongest approach, with optional appeal and case-strengthening stages.
version: 0.5.0
---

# Legal Debate Skill

> **ANNOUNCE ON INVOCATION:** When this skill is loaded, immediately tell the user: "Using legal-debate skill — analysing the question to prepare an agent debate." If evidence has been supplied, say instead: "Using legal-debate skill — I'll digest the evidence into a structured record first, then pause for you to `/clear` before the debate."

> **NOT LEGAL ADVICE:** This skill produces structured argument analysis for informational and preparatory purposes only. It is not legal advice and does not create a lawyer–client relationship. Outputs must be reviewed by a qualified, jurisdictionally-licensed attorney before being relied upon. Surface this disclaimer in the final output.

Facilitate structured multi-agent debates for legal problem-solving. A team of 2-5 agents independently develop competing legal positions or strategies, then challenge each other's reasoning through adversarial debate rounds — like opposing counsel or a moot bench — until consensus emerges or a judge synthesis decides.

## Scope

This skill targets **legal reasoning problems** — litigation and dispute strategy, contract drafting and negotiation approaches, statutory and regulatory interpretation, risk and enforceability assessment, and choice-of-forum or choice-of-law trade-offs. It reasons about legal argument structure and strategy; it does **not** replace a qualified solicitor or barrister, does not guarantee jurisdictional accuracy, and is not suited to giving definitive advice on a live matter.

**Jurisdictional scope:** this skill is tailored to **England & Wales and Commonwealth silk systems** (jurisdictions that appoint King's Counsel / Senior Counsel). Its advocate personas, terminology, and authority conventions assume that setting. If a question is governed by a non-silk jurisdiction's law (e.g. a US state), flag that it falls outside the skill's tailoring before proceeding.

**Practice profile (optional):** at the start, read `~/.claude/uk-legal-profile.md` if it exists. Use its `default_jurisdiction` as the assumed governing law when the question does not state one, and its `citation_style` (default OSCOLA) when formatting authorities. If `silk_system` is `false` or the jurisdiction is non-silk, apply the non-silk flag above before spawning advocates. If the file is absent, use the England & Wales / silk defaults — do not block on it. The profile is written by the `uk-legal-setup` skill.

## Invariants

- **ALWAYS**, when the question is supplied with **evidence** (contracts, correspondence, pleadings, witness statements, exhibit bundles, transcripts, long pasted text, or attached files), run **Phase 0 (Evidence pre-processing)** *first* — read the evidence and distil it into a structured, greppable digest file before any debate work
- **ALWAYS**, after producing the digest, **stop and prompt the human to run `/clear` and then start the debate** — the digest is a file that survives the reset; **NEVER** continue from Phase 0 into the debate in the same context (the `/clear` is what keeps the raw evidence out of the debate)
- **NEVER** decide, weigh, or resolve any legal issue in the digest — Phase 0 is **extraction only**; it records facts and *flags* issues, the debate decides them
- **ALWAYS**, once a debate begins with a digest available, treat the digest as the **factual record** and have advocates **grep it and cite facts by ID** rather than re-ingesting the raw evidence
- **ALWAYS** choose the **debate shape** before agent count — *proposition* (agents argue a single yes/no question for and against) or *strategy-selection* (agents argue distinct competing approaches)
- **ALWAYS** assess problem complexity before choosing agent count
- **NEVER** spawn more than 5 agents — diminishing returns beyond this
- **ALWAYS** assign each agent a distinct legal position or strategy to prevent convergence before debate begins
- **ALWAYS**, in *proposition* shape, split agents into opposing sides (for and against) so at least one advocates each way
- **ALWAYS** cast the advocate agents as **King's Counsel (KC)** — or **Senior Counsel (SC)** in Commonwealth jurisdictions that use that title — since this skill is scoped to England & Wales and Commonwealth silk systems
- **ALWAYS** flag, before spawning, if the governing law is a non-silk jurisdiction — the question falls outside this skill's tailoring
- **NEVER** let agents see each other's initial research — independence is critical for genuinely adversarial argument
- **ALWAYS** ground every authority an advocate advances in the **uk-legal MCP tools** (case law, legislation, Hansard) rather than model memory, and **verify every citation** via `citations_resolve` before it enters the output — see *Authority & verification* below. Flag where jurisdiction is assumed or unknown
- **ALWAYS** include a consensus check after debate rounds
- **ALWAYS**, *even when consensus is reached*, offer the human a formal judge's ruling anyway — a consensus among advocates is not an independent determination on the law (see Phase 4)
- **ALWAYS** produce output as a weighted comparison table with a brief verdict (see `references/output-format.md`)
- **ALWAYS** fall back to a judge synthesis if consensus is not reached after 2 debate rounds
- **ALWAYS**, once the output has been produced, offer the human an **appeals process** before treating the matter as closed (see Phase 6)
- **ALWAYS**, after the appeal has run or been declined, offer the human a **case-strengthening review** that produces a package on how best to win *their* position (see Phase 7)
- **ALWAYS** treat the appeal and the case-strengthening review as *opt-in* — offer them, never impose them
- **ALWAYS** append the "NOT LEGAL ADVICE" disclaimer to every output, including the appeal ruling and the case-strengthening package
- **ALWAYS** write each deliverable to a file under a `legal-review/` directory in the current working directory (or a user-specified path), in **ADDITION** to rendering it inline — the files supplement the conversation, they never replace it. Use kebab-case, numbered filenames (see the file set below and `references/output-format.md`)
- **ALWAYS** make every written file self-contained: it MUST carry the "NOT LEGAL ADVICE" disclaimer, a **generation date**, and the **jurisdiction / governing law**. `Date.now()` is unavailable in this environment — take the date from the session's `currentDate` context (do **NEVER** fabricate one; if no date is available, ask the user for it)

## File outputs

Each deliverable is written to a file under `legal-review/` (in the current working directory, or a path the user specifies) as it is produced, in addition to being rendered inline:

| File | Written | Contents |
|------|---------|----------|
| `01-debate-verdict.md` | **Always** (Phase 5) | The packaged verdict — the 6-part structure in `references/output-format.md` (question, positions, weighted table, verdict, authorities, disclaimer) |
| `02-judges-ruling.md` | Only if a judge's ruling is produced (Phase 4, or on the appeal bench where relevant) | The independent judge synthesis / ruling |
| `03-case-strengthening.md` | Only if the Phase 7 package is produced | The partisan winning package |
| `04-appeal-ruling.md` | Only if an appeal is run (Phase 6) | The appellate determination and disposition |

Every one of these files opens with an italic provenance line — `*<description> (legal-debate skill, Phase N). Generated <currentDate>. Jurisdiction: <jurisdiction>.*` — and closes with the NOT LEGAL ADVICE disclaimer. `references/output-format.md` gives the complete reference format for each document. Keep `01-debate-verdict.md` crisp, per the "keep the total output concise" rule.

## Authority & verification (uk-legal MCP)

This skill is a companion to the **`uk-legal`** plugin (MCP server key `uk-legal`) and the **`legal-research`** skill. Advocates must ground their submissions in **primary sources via those tools, not model memory** — include this directive in every agent prompt (Phase 2), and apply it when synthesising the verdict.

Map debate work → tools:
- **Case authority** for a position → `case_law_search` → `judgment_get_index` / `judgment_get_paragraph` (quote the paragraph, not a paraphrase). What a leading case relied on → `citations_network`.
- **Statutory / SI authority** → `legislation_search` → `legislation_get_section`; **check `extent` and `in_force` / `version_date`** before an advocate relies on a provision — a repealed or not-yet-in-force section sinks the argument. **Surface any `coverage_note` / devolved `warnings`** the tool returns.
- **Scots law and other devolved jurisdictions — warn the human first.** If the governing law is **Scots law**, the tools can ground Scottish **statute** (`asp`/`ssi`) but there is **no source for Scottish case law or Holyrood proceedings** — advocates cannot verify Scottish authority here, and Scots law is a **distinct legal system** whose doctrine does not map onto England & Wales (the KC/SC silk framing does still apply — the Faculty of Advocates appoints King's Counsel). Before spawning, tell the human the debate would rest on unverifiable Scottish authority, and offer to (a) confine it to statute, (b) treat it as reasoning-only with authorities flagged unverified, or (c) pause for a Scottish-qualified practitioner. **Northern Ireland** is in the same position as Scotland for case law — NI courts are not on Find Case Law, so NI authority cannot be verified here (statute is available via `nia`). **Wales**, by contrast, shares the England & Wales courts, so Welsh case law *is* covered; only Welsh statute is distinct.
- **Parliamentary material** (purposive construction, *Pepper v Hart*) → `parliament_search_hansard` → `parliament_lookup_by_column`.
- **Every citation** an advocate advances, in any round, MUST pass the verification protocol before it appears in the comparison table, the verdict, or an agent's cited authority: `citations_parse` → `citations_resolve` (a `confidence` of `0.0` means the document does not exist — do not cite it) → `citations_format_oscola` (which refuses to format a fabricated citation). This is the concrete mechanism behind the "no fabricated citations" invariant. If verification fails, the advocate drops or re-sources the point — never manufacture a citation.

If the `uk-legal` tools are unavailable, tell the user to install the `uk-legal` plugin; the debate can still run on reasoning alone, but flag that authorities are unverified.

## Workflow

### Phase 0: Evidence pre-processing (when evidence is supplied)

**Trigger:** the question arrives with factual material to work from — one or more contracts, letters/emails, pleadings, witness statements, exhibit bundles, transcripts, attached files, or a substantial block of pasted facts. A bare legal question with no supporting material skips straight to Phase 1.

Before any debate, read the evidence **once** and distil it into a single **structured, greppable digest file**. This is the subject-matter pre-processing step: the digest — not the raw evidence — grounds the debate after a context reset.

1. **Read all supplied evidence thoroughly.**
2. **Extract a digest** to `legal-evidence-digest-{matter-slug}.md` in the current working directory, following the schema in `references/evidence-digest.md`: matter summary, parties, documents index, chronology, agreed/disputed facts, key terms (verbatim), admissions, authorities cited in the evidence, spotted legal issues, and gaps. Every fact carries a stable ID, literal bracketed tags, ISO dates, and a `Source:` locator so an LLM or `grep` can pull exactly what it needs later.
3. **Extraction only** — record what the evidence says and *flag* the legal issues it raises; decide nothing.
4. **Stop and hand off.** Present the handoff prompt (see `references/evidence-digest.md`): report what was captured, then instruct the human to **run `/clear`** and restart the debate referencing the digest file. **Do not proceed into Phase 1 in this context** — the digest file carries the facts across the reset.

Phase 1 onward then runs in the fresh, post-`/clear` context, loading the digest as its factual record.

### Phase 1: Problem Analysis

**If an evidence digest exists** (Phase 0 was run, or the user points at a `*evidence-digest*.md` file — glob the working directory and, if several match, ask which matter): load it first and treat it as the **factual record**. Draw the problem classification, jurisdiction, and candidate positions from the digest's *Matter summary* and *Spotted legal issues*; do not re-ingest the raw evidence. Carry each `[AUTHORITY][TO-VERIFY]` entry forward for verification during the debate. Then continue with the analysis below.

Analyse the user's problem statement to determine:

1. **Problem classification** — litigation/dispute strategy, contract drafting/negotiation, statutory/regulatory interpretation, risk & enforceability assessment, or choice-of-forum/choice-of-law
2. **Jurisdiction & governing law** — identify the applicable jurisdiction and body of law. If not stated, ask before proceeding — legal conclusions rarely transfer across jurisdictions. The skill assumes an England & Wales / Commonwealth silk jurisdiction, so the advocate persona is **King's Counsel** (or **Senior Counsel** where that title is used); if the governing law is a non-silk jurisdiction, flag that it falls outside the skill's tailoring.
3. **Debate shape** — classify the question:
   - **Proposition** — a single yes/no legal question (enforceable? liable? time-barred? admissible?). Agents are split into opposing sides and argue the *same* proposition **for and against**, as adversaries.
   - **Strategy-selection** — a "which approach?" question with three or more genuinely distinct options (e.g. litigate vs mediate vs arbitrate). Agents each develop a *distinct* strategy and compare (multi-position).
4. **Complexity assessment** — determines agent count, given the shape:
   - **Proposition, simple** (2 agents): one KC/advocate for, one against.
   - **Proposition, contested** (4 agents): two-a-side — a leader and junior per side, or two independent advocates per side developing the strongest and second-strongest lines.
   - **Strategy-selection, moderate** (3 agents): three viable strategies with non-obvious trade-offs.
   - **Strategy-selection, complex** (4-5 agents): broad option space, multiple causes of action, or cross-jurisdictional concerns.
5. **Positions / strategies** — identify the concrete legal angle each agent develops. In *proposition* shape these are the for and against cases on one question; in *strategy-selection* each must be a genuinely different theory or strategy, not a rephrasing.

Confirm the plan with the user before spawning:

> **Proposition:** "Analysing as a [classification] question under [jurisdiction/governing law] — a proposition, so I'll instruct [N] agents as opposing [King's Counsel / Senior Counsel]: [M] arguing FOR '[proposition]' and [M] AGAINST. Proceed?"
>
> **Strategy-selection:** "Analysing as a [classification] question under [jurisdiction/governing law] — a strategy choice, so I'll spawn [N] agents to develop and compare: [strategy 1], [strategy 2], ... Proceed?"

### Phase 2: Agent Team Creation

Use `TeamCreate` to spawn the agent team. Each agent receives:

- Its **assigned side** (for / against) or **distinct strategy**, per the debate shape
- Its **advocate persona** — **King's Counsel (KC)**, or **Senior Counsel (SC)** where that title is used (see Phase 1). Instruct the agent to conduct itself as leading counsel: precise, authority-led, and candid about weaknesses in its own case.
- The **original problem statement**, jurisdiction, and governing law for context
- **If an evidence digest exists:** the digest **file path**, with instructions to treat it as the factual record, **grep it by fact ID / tag** for the facts it needs, and **cite facts by ID** (e.g. "per F014") in its submission — not to re-read raw evidence or invent facts beyond the digest (missing facts are in the digest's *Gaps & unknowns*)
- Instructions to **build the strongest possible case** for its side/strategy
- A directive to **anticipate opposing counsel's arguments** and pre-empt them
- A directive to **ground every authority in the `uk-legal` MCP tools** (`case_law_search`/`judgment_get_paragraph`, `legislation_get_section` with `extent`/`in_force`, `parliament_search_hansard`) and to **verify each citation** through `citations_parse` → `citations_resolve` → `citations_format_oscola` before advancing it — see *Authority & verification*

**Proposition shape** — opposing advocates on one question:

```
TeamCreate:
  name: "legal-debate-[matter-slug]"
  agents:
    - name: "kc-for"          # senior-counsel-for in a non-silk jurisdiction
      prompt: |
        You are [King's Counsel / Senior Counsel] instructed to argue FOR the proposition:
        "[proposition]". Jurisdiction / governing law: [jurisdiction].

        Conduct yourself as a senior advocate: lead with your strongest authority, be precise,
        and be candid about the weaknesses in your own case rather than hiding them.
        Structure your submission as:
        1. Position statement (concrete legal conclusion, not abstract)
        2. Supporting authority (cite statutes, cases, regulations, or contract text)
        3. Application to the facts
        4. Known weaknesses, adverse authority, and how you distinguish or mitigate them
        5. Anticipated arguments from opposing counsel and your rebuttals

        Cite specific authority. Where you assume a fact or jurisdictional point, flag it explicitly.
        Do not fabricate citations — if you are unsure a case or section exists, say so.
    - name: "kc-against"      # mirror prompt, arguing AGAINST the same proposition
      prompt: ...
    # For a contested (4-agent) proposition: kc-for-lead, kc-for-junior, kc-against-lead, kc-against-junior
```

**Strategy-selection shape** — each agent develops a distinct approach (multi-position):

```
TeamCreate:
  name: "legal-debate-[matter-slug]"
  agents:
    - name: "counsel-strategy-1"
      prompt: |
        You are [King's Counsel / Senior Counsel] developing [strategy 1] as the approach to: [problem statement].
        Jurisdiction / governing law: [jurisdiction].
        Build the strongest case for THIS strategy using the same 5-part structure as above,
        and identify the conditions under which a competing strategy would be preferable.
    - name: "counsel-strategy-2"
      prompt: ...
    # ... up to 5 agents
```

### Phase 3: Debate Rounds

Once all agents have completed their initial development, the orchestrator (main session) acts as the debate facilitator — think presiding judge or moot bench. Facilitate debate:

**Round 1 — Challenge Phase:**
Send each agent a summary of all other agents' positions via `SendMessage`. Instruct each to:
- Identify the **weakest points** in competing positions (missing elements, distinguishable authority, factual gaps)
- Defend their own position against anticipated challenges
- Concede points where a competing position is genuinely stronger on the law

**Round 2 — Rebuttal Phase:**
Share Round 1 challenges back to each agent. Instruct each to:
- Respond to specific critiques of their position
- Update their position if a challenge revealed a genuine flaw or controlling adverse authority
- State which competing position they consider second-strongest and why

See `references/debate-protocol.md` for detailed facilitation guidance, including how to handle unproductive arguments, citation hygiene, and maintaining focus. If the problem is under-specified (missing facts or jurisdiction) and agents cannot argue concretely, pause and ask the user for clarification before proceeding.

### Phase 4: Consensus Resolution

After Round 2, assess consensus:

**Consensus reached** — Agents converge on the same position or clearly acknowledge one as strongest:
- Synthesise the winning position with improvements surfaced during debate
- Note any caveats, adverse authority, or factual dependencies that should inform reliance
- **Offer a judge's ruling anyway.** A consensus *among advocates* is not an independent determination on the law — the advocates may have converged on a shared but wrong reading, or missed a dispositive authority. Ask the human via `AskUserQuestion`:
  > "The advocates reached consensus on **[position]**. A consensus among counsel is not a ruling. Would you like a formal judge's ruling regardless — an independent, reasoned determination that weighs authority rather than counting supporters?"
  - **Yes** → run the judge synthesis below as if there were no consensus, then **state explicitly where the judge's independent ruling agrees with, qualifies, or diverges from the advocates' consensus**. Divergence is a signal, not an error — surface it prominently.
  - **No** → proceed to Phase 5 with the consensus synthesis.

**No consensus (fallback)** — Agents remain divided or the margin is thin:
- Act as a **judge agent**: review all arguments objectively
- Weight arguments by strength of authority and fit to the facts, not by count of supporters
- Produce a verdict with explicit reasoning for why the winning position edges out the alternatives

**Whenever a judge's ruling is produced** (either the offered ruling on consensus, or the fallback synthesis), **write it to `legal-review/02-judges-ruling.md`** in addition to rendering it inline — provenance line + independent determination + the NOT LEGAL ADVICE disclaimer, following the reference format. (If the outcome comes purely from advocate consensus with no ruling, this file is not written.)

### Phase 5: Output

Produce the final output in two parts:

1. **Weighted comparison table** — score each position against relevant criteria (see `references/output-format.md` for template and criteria selection guidance)
2. **Brief verdict** — 2-3 sentences: strongest position, primary rationale, and key caveat

Append the **NOT LEGAL ADVICE** disclaimer. Present to the user for final decision. The debate informs — a qualified attorney and the user decide.

**As the final step of producing the verdict, write it to `legal-review/01-debate-verdict.md`** — the full 6-part structure from `references/output-format.md` (question restatement, positions argued, weighted comparison table, verdict, key authorities & open points, disclaimer), opening with the provenance line (`Generated <currentDate>`, jurisdiction) and closing with the NOT LEGAL ADVICE disclaimer. This file is written on every run. Keep it crisp — the debate was thorough, the file is the summary.

Then proceed to **Phase 6** — do not treat the matter as closed until the appeal and case-strengthening offers have been made.

### Phase 6: Appeals (opt-in)

Once the Phase 5 output exists, **offer the human an appeals process** before closing. An appeal is a structured re-examination of the ruling on defined grounds — not a re-run of the debate. Ask via `AskUserQuestion`:

> "Would you like to appeal this outcome? An appeal appoints counsel to challenge the ruling on specific grounds (error of law, misapplied test, overlooked or misweighted authority, a strong line never argued, or new facts/authority), with the bench applying an appellate standard of review."

- **Declined** → skip to Phase 7.
- **Accepted** → run the appeal per `references/appeals-and-strengthening.md`:
  1. **Grounds of appeal** — appoint an *appellant KC/SC* to draft concrete grounds against the ruling (each ground tied to a specific error and authority, not general disagreement).
  2. **Respondent's answer** — appoint a *respondent KC/SC* to defend the ruling ground-by-ground.
  3. **Appellate determination** — act as the appellate bench (a single appellate judge, or a 3-member panel for complex matters). Apply the standard of review: **de novo on questions of law; deference to findings that turned on facts/authority actually argued below.** Every authority relied on in the appeal passes the same *Authority & verification* protocol.
  4. **Disposition** — **appeal allowed** (ruling varied or reversed — state the revised position and what changed) or **appeal dismissed** (ruling affirmed, with reasons). Append the disclaimer.

When an appeal is run, **write the appellate determination and disposition to `legal-review/04-appeal-ruling.md`** in addition to rendering it inline — provenance line (`Generated <currentDate>`, jurisdiction) + grounds, respondent's answer, determination, disposition + the NOT LEGAL ADVICE disclaimer.

An appeal may only be run once by default; a further appeal requires the human to identify a genuinely new ground.

### Phase 7: Case-strengthening review (opt-in)

After the appeal has run **or been declined**, offer the human a partisan review aimed at *winning*, not adjudicating. Ask via `AskUserQuestion`:

> "Would you like a case-strengthening review? Unlike the neutral ruling, this takes **one** position — the one you want to advance — and produces a package on how best to win it: the strongest lines, the authorities to marshal, the evidence to gather, and the counter-arguments to prepare for."

- **Declined** → close: brief summary + disclaimer.
- **Accepted** → first confirm **which position is theirs to advance** (it may be the winner, the appeal outcome, or the position they are instructed on — it need not be the position that prevailed). Then produce the **winning package** per `references/appeals-and-strengthening.md`:
  1. **Strongest lines, ranked** — each anchored to verified, OSCOLA-formatted authority with the key paragraph to quote.
  2. **Authorities to marshal** — the cases, sections, and Hansard material to cite, all verified via `citations_resolve`; flag any that are only persuasive or distinguishable.
  3. **Evidence & factual gaps** — what facts/documents make each line land, and what is missing.
  4. **Anticipated opposition & prepared rebuttals** — the strongest counter-arguments (drawn from the losing/other side of the debate) and how to meet them.
  5. **Tactics** — dispositive/threshold points first, forum and procedural considerations, and settlement leverage.
  6. **Risk register** — what could sink the position and the mitigation for each.

This package is *advocacy preparation*, not advice — append the **NOT LEGAL ADVICE** disclaimer and reiterate that a qualified, jurisdictionally-licensed lawyer must settle anything relied on.

When the package is produced, **write it to `legal-review/03-case-strengthening.md`** in addition to rendering it inline — provenance line (`Generated <currentDate>`, jurisdiction) + a lead line naming the position advanced + the 6-part package + the NOT LEGAL ADVICE disclaimer.

## Agent Communication Pattern

```
Phase 0: Evidence → digest file → STOP, prompt /clear   (only if evidence supplied)
    ── (human runs /clear, restarts debate referencing the digest) ──
Phase 1: Load digest as factual record (if present)
Phase 2: TeamCreate (parallel, independent development)
    counsel-1 ──develop──> position-1
    counsel-2 ──develop──> position-2
    counsel-N ──develop──> position-N

Phase 3, Round 1: SendMessage (challenge)
    facilitator ──all positions──> each counsel
    each counsel ──challenges──> facilitator

Phase 3, Round 2: SendMessage (rebuttal)
    facilitator ──challenges──> each counsel
    each counsel ──rebuttals──> facilitator

Phase 4: Consensus or judge synthesis (+ offer judge's ruling even on consensus)   → legal-review/02-judges-ruling.md (if a ruling is produced)
Phase 5: Comparison table + verdict + disclaimer                                   → legal-review/01-debate-verdict.md (always)
Phase 6: Offer appeal → grounds → respondent → appellate ruling (opt-in)           → legal-review/04-appeal-ruling.md (if run)
Phase 7: Offer case-strengthening → winning package for the user's position (opt-in) → legal-review/03-case-strengthening.md (if produced)

All files are written to legal-review/ (or a user-specified path) in ADDITION to inline rendering; each carries the disclaimer, generation date (from session currentDate), and jurisdiction.
```

## Criteria Selection

Choose 3-5 criteria relevant to the specific question. Weight by importance (x1 default, x2 for critical factors). See `references/output-format.md` for detailed criteria selection guidance per problem type (litigation strategy, contract, statutory interpretation, risk assessment).

## Reference Files

- **`references/evidence-digest.md`** — Phase 0 mechanics: why the digest + `/clear` handoff, the greppability contract (stable headers, fact IDs, closed tag vocabulary, ISO dates, provenance), the digest template, the handoff prompt, and how the post-`/clear` debate picks the digest back up
- **`references/debate-protocol.md`** — Detailed debate facilitation rules, round structure, citation hygiene, handling unproductive arguments, and edge cases
- **`references/output-format.md`** — Comparison table template, criteria selection guidance, verdict format, and disclaimer text
- **`references/appeals-and-strengthening.md`** — Mechanics for Phase 6 (grounds of appeal, standard of review, appellate panel, disposition) and Phase 7 (winning-package structure, partisan-vs-neutral framing, authority marshalling)
