# Appeals & Case-Strengthening Reference

Detailed mechanics for the two opt-in stages that follow the debate output:
**Phase 6 (Appeals)** and **Phase 7 (Case-strengthening review)**. Both are
offered to the human, never imposed. Both are bound by the same *Authority &
verification* protocol as the debate: every authority is grounded in the
`uk-legal` MCP tools and every citation passes `citations_parse` →
`citations_resolve` → `citations_format_oscola` before it appears in output.

---

## Phase 6 — Appeals

An appeal **re-examines the existing ruling on defined grounds**. It is not a
re-run of the debate and not an open-ended second opinion. If nothing is
challenged on a proper ground, the ruling stands.

### When to offer

Always, once the Phase 5 output exists — regardless of whether the outcome came
from consensus or a judge synthesis, and regardless of whether the human seemed
satisfied. Phrase it as a right, not a suggestion that the ruling is weak.

### Grounds of appeal

An appeal must rest on at least one concrete ground. Vague dissatisfaction is
not a ground. The recognised grounds:

| Ground | What it alleges | Bench's standard |
|--------|-----------------|------------------|
| **Error of law** | The ruling misstated the governing test or rule | **De novo** — no deference |
| **Misapplication** | The test was correct but wrongly applied to the facts | De novo on the law; deference on argued facts |
| **Overlooked / misweighted authority** | A controlling or strongly persuasive authority was ignored or given the wrong weight | De novo — authority is a question of law |
| **Procedural unfairness** | A dispositive line was never argued, or a side was not properly put | Correct if it could have changed the outcome |
| **Fresh authority / facts** | Authority or facts not before the original bench | Admit only if it could not reasonably have been raised earlier and may change the result |

### Procedure

1. **Appellant's grounds** — appoint an *appellant KC/SC* (a fresh advocate, not
   one of the original debaters where possible) to draft numbered grounds. Each
   ground names the specific error, the authority that exposes it (verified),
   and the outcome sought.
2. **Respondent's answer** — appoint a *respondent KC/SC* to answer each ground:
   defend the ruling, distinguish the appellant's authority, or concede.
3. **Appellate determination** — act as the appellate bench:
   - **Single appellate judge** for a straightforward appeal.
   - **Three-member panel** for a complex or high-stakes matter — each member
     reasons independently, then the panel resolves by majority, noting any
     dissent (a dissent is useful signal for the human).
   - Apply the standard of review in the table above. Do **not** substitute your
     preference for a finding that turned on facts/authority properly argued
     below unless it was plainly wrong.
4. **Disposition** — one of:
   - **Appeal allowed** — ruling *varied* or *reversed*. State the revised
     position, exactly which ground succeeded, and what now follows.
   - **Appeal dismissed** — ruling *affirmed*. Give reasons ground-by-ground.
   - **Allowed in part** — some grounds succeed; state the net effect.

### Limits

- Run **one** appeal by default. A further appeal requires the human to identify
  a genuinely new ground not available at the first appeal (mirrors the reluctance
  of appellate courts to entertain repeat challenges).
- The appeal cannot introduce a fabricated or unverified authority — a ground
  that depends on an authority failing `citations_resolve` is struck out.
- Append the **NOT LEGAL ADVICE** disclaimer to the appeal ruling.

---

## Phase 7 — Case-strengthening review ("winning package")

Where the debate and appeal are **neutral adjudication**, the case-strengthening
review is **partisan advocacy preparation**. It takes one position — the
position the human wants to advance — and builds the strongest practical case
for winning it.

### Framing (state this to the human)

- This stage is **one-sided by design**. It is not a balanced assessment; it is
  the brief you would prepare if instructed to win this position.
- It is still **not legal advice** and still **cannot fabricate authority** — a
  partisan brief built on citations that do not resolve is worse than useless.
- The position advanced **need not be the one that prevailed** in the debate or
  appeal. The human may be instructed on the losing side; say so plainly and
  build the best honest case available, including candour about its weaknesses.

### Confirm first

Before producing the package, confirm **which position is theirs** via
`AskUserQuestion` if it is not obvious — the winner, the appeal outcome, or a
specific position they must advance.

### Package structure

1. **Strongest lines, ranked** — the two or three best routes to winning, in
   order. Each line: the legal proposition, the single best authority for it
   (verified, OSCOLA-formatted), and the paragraph to quote.
2. **Authorities to marshal** — the full citation list to deploy: binding first,
   then persuasive. Each verified via `citations_resolve`; mark anything only
   persuasive, distinguishable, or from a sister jurisdiction. Note what each
   authority is *for* (the proposition it supports).
3. **Evidence & factual gaps** — the facts and documents each line depends on,
   and what is missing or must be proved. Winning is as much evidence as law.
4. **Anticipated opposition & prepared rebuttals** — the strongest arguments the
   other side will run (draw directly from the opposing advocate's case in the
   debate) and a prepared answer to each. Do not strawman the opposition.
5. **Tactics** — sequencing (lead with threshold/dispositive points), choice of
   forum and procedural levers, timing, and realistic settlement leverage given
   the strength of the position.
6. **Risk register** — the honest downside: what could sink the position, how
   likely, and the mitigation. A package that hides its own weaknesses will lose
   at the first contact with opposing counsel.

### Output discipline

- Keep it a working brief, not an essay — headings, ranked lists, quotable
  paragraphs.
- Every citation in the package must have passed verification. If a wanted
  authority will not verify, say so and either drop it or mark it "to be
  sourced" — never present it as established.
- Append the **NOT LEGAL ADVICE** disclaimer and reiterate that a qualified,
  jurisdictionally-licensed lawyer must settle anything relied on.
