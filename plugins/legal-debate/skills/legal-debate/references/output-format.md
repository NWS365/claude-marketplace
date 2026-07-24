# Output Format Reference

Templates and guidance for producing the legal debate output.

## Comparison Table

The primary output is a weighted scored comparison table.

### Template

```markdown
| Criteria (weight) | [Position A] | [Position B] | [Position C] |
|-------------------|--------------|--------------|--------------|
| [Criterion 1] (x2) | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| [Criterion 2] (x1) | ★★★☆☆ | ★★★★★ | ★★☆☆☆ |
| [Criterion 3] (x1) | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| [Criterion 4] (x2) | ★★★★☆ | ★★☆☆☆ | ★★★★☆ |
| **Weighted Total** | **25/30** | **21/30** | **24/30** |

**Rationale**: Brief note on any non-obvious scores.
```

### Rules

- **3-5 criteria** per table — fewer is clearer
- **Weight by importance**: x1 (standard), x2 (critical to the question), x0.5 (nice-to-have)
- **Score 1-5 stars** per criterion per position
- **Weighted Total** row sums (stars x weight) for each position
- **Rationale row** explains any score that would surprise the user
- Column headers use the position's short name, not the agent's name

### Criteria Selection Guidance

Select criteria based on the problem classification:

**Litigation / dispute strategy:**
| Criteria | Why |
|----------|-----|
| Strength of authority (x2) | Must rest on binding, on-point law |
| Likelihood of success (x2) | The ultimate question for the client |
| Cost & time to run (x1) | Proportionality drives real-world decisions |
| Downside / adverse costs risk (x1) | What is lost if the position fails |

**Contract drafting / negotiation:**
| Criteria | Why |
|----------|-----|
| Enforceability (x2) | An unenforceable clause protects nothing |
| Risk allocation (x2) | Who bears which risk is the core purpose |
| Clarity / dispute-resistance (x1) | Ambiguity invites litigation |
| Commercial acceptability (x1) | The counterparty must actually sign it |

**Statutory / regulatory interpretation:**
| Criteria | Why |
|----------|-----|
| Textual fit (x2) | Must be consistent with the words used |
| Consistency with purpose / precedent (x2) | Courts weigh intent and prior construction |
| Practical workability (x1) | Interpretations that produce absurdity fail |
| Regulatory / enforcement risk (x1) | Cost of being wrong before a regulator |

**Risk & enforceability assessment:**
| Criteria | Why |
|----------|-----|
| Severity of exposure (x2) | Magnitude of the downside |
| Probability of crystallising (x1) | How likely the risk actually bites |
| Mitigation availability (x1) | Whether the risk can be managed down |
| Evidence / documentary support (x1) | Strength of the record backing the position |

Custom criteria are encouraged when the question demands it. The above are starting points, not exhaustive lists.

## Brief Verdict

Follow the comparison table with a concise verdict:

### Template

```markdown
**Verdict:** [Position name] is the strongest position. [1-2 sentences explaining the primary
reason it wins — the deciding authority or element]. [1 sentence noting the key caveat, adverse
authority, or factual dependency to watch for].
```

### Rules

- **Maximum 3 sentences** — brevity forces clarity
- **Name the winner explicitly** — no hedging with "it depends"
- **State the deciding factor** — which authority, element, or test tipped the balance?
- **Acknowledge the main trade-off** — what risk or adverse authority does the winning position carry?

### Examples

**Good:**
> **Verdict:** The "unenforceable penalty" position is strongest. The stipulated sum is not a
> genuine pre-estimate of loss and is extravagant relative to the maximum conceivable breach, which
> engages the penalty rule under the governing authority. Watch for the counter-argument that the
> clause protects a legitimate commercial interest — confirm no such interest is pleaded.

**Bad:**
> **Verdict:** Both positions have merit. The penalty argument is strong but the liquidated-damages
> argument also has support. It depends on the facts and the court's view.

The bad example hedges instead of recommending, and pushes the decision back to the user without a clear winner.

## Complete Output Structure

The full output presented to the user follows this order:

1. **Question restatement** (1 sentence — confirms shared understanding, including jurisdiction/governing law)
2. **Positions argued** (bullet list of positions with one-line descriptions)
3. **Comparison table** (weighted scored table)
4. **Verdict** (2-3 sentences)
5. **Key authorities & open points** (optional — controlling authorities relied on, plus any citations flagged for verification or facts still needed)
6. **Disclaimer** (always — see below)

Keep the total output concise. The debate was thorough — the summary should be crisp.

## File output

Every deliverable is written to a file **in addition to** being rendered inline. The files supplement the conversation; they **never replace** it — inline rendering is always still required.

**Target directory:** a `legal-review/` directory in the current working directory, unless the user specifies another path. Create it if it does not exist.

**Filenames** (kebab-case, numbered):

| File | When written | Produced by |
|------|--------------|-------------|
| `01-debate-verdict.md` | **Always** | Phase 5 — the packaged verdict (the 6-part structure above) |
| `02-judges-ruling.md` | Only if a judge's ruling is produced | Phase 4 (offered ruling on consensus, or the fallback synthesis) |
| `03-case-strengthening.md` | Only if the winning package is produced | Phase 7 |
| `04-appeal-ruling.md` | Only if an appeal is run | Phase 6 |

**Every written file must:**

- Open with an italic provenance line: `*<one-line description> (legal-debate skill, Phase N). Generated <currentDate>. Jurisdiction: <jurisdiction>.*`
- State the **jurisdiction / governing law**.
- Carry a **generation date** — taken from the session's `currentDate` context (`Date.now()` is unavailable in this environment; never fabricate a date — if none is available, ask the user).
- Close with the **NOT LEGAL ADVICE** disclaimer below.

The 6-part structure above and these file conventions are the complete reference format for each document — no external exemplar files are required.

## Disclaimer

Always append the following (or equivalent) to the final output:

```markdown
---
**Not legal advice.** This analysis is generated for informational and preparatory purposes only,
may not reflect the current law of the relevant jurisdiction, and does not create a lawyer–client
relationship. Verify all cited authorities and have the analysis reviewed by a qualified,
jurisdictionally-licensed attorney before relying on it.
```
