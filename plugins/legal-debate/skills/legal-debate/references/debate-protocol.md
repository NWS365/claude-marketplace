# Legal Debate Protocol Reference

Detailed facilitation rules for the multi-agent legal debate workflow.

## Round Structure

### Pre-Debate: Independent Development

Each agent develops its position independently. Critical rules:

- **No cross-pollination** — agents must not see each other's work during development
- **Time-box** — each agent should focus on building its case, not exhaustively surveying every alternative theory
- **Concrete positions** — agents must argue a specific legal conclusion, not an abstract recommendation. "The clause may be unenforceable" is insufficient; "The clause is an unenforceable penalty because the stipulated sum is not a genuine pre-estimate of loss under *Dunlop v New Garage* and is extravagant relative to the maximum conceivable breach" is concrete.
- **Citation discipline** — cite authority precisely (case name, section number, regulation). Never fabricate a citation. If unsure a source exists or is current, flag it as "to be verified" rather than asserting it.

### Round 1: Challenge Phase

Share all positions with all agents simultaneously. Each agent must:

1. **Acknowledge strengths** — start by noting what competing positions get right (prevents purely adversarial noise)
2. **Target weaknesses** — identify specific flaws: unmet elements of a cause of action, distinguishable or overruled authority, factual assumptions, or misapplied tests
3. **Provide grounds** — challenges must cite specific legal reasons, not vague concern. "This won't hold up" is insufficient; "This ignores the limitation period under s.2 Limitation Act — the cause of action accrued more than six years before filing" is concrete.
4. **Defend proactively** — anticipate and address likely challenges to their own position

### Round 2: Rebuttal Phase

Share Round 1 challenges with each agent. Each agent must:

1. **Address each challenge directly** — no deflecting or ignoring valid points
2. **Concede where appropriate** — if a challenge reveals a genuine flaw or controlling adverse authority, acknowledge it and either distinguish it, propose a mitigation, or concede the point
3. **Update position** — revise the original position to incorporate what the debate surfaced
4. **Rank competitors** — state which competing position is second-strongest and why. This forces honest evaluation.

## Facilitation Guidelines

### Maintaining Productive Debate

**Redirect if agents argue in circles:**
- If two agents repeat the same point/counterpoint, intervene: "This point has been addressed. Move to the next challenge."

**Prevent false consensus:**
- If agents converge too quickly (Round 1 produces no meaningful challenges), push back: "Identify at least one genuine risk, adverse authority, or factual dependency that could sink the leading position."

**Handle scope creep:**
- If agents introduce facts not in the record or a different jurisdiction's law, redirect: "Argue on the stated facts and governing law only. Flag missing facts as assumptions rather than inventing them."

### Citation Hygiene

- Treat every citation as suspect until it is anchored to a real, current authority. Prefer flagging "verify this holds in [jurisdiction]" over asserting certainty.
- If an agent relies on a case that another agent shows to be distinguishable, overruled, or from the wrong jurisdiction, that weakens the position materially — weight it accordingly in the verdict.
- Never present a fabricated or unverifiable citation as authority in the final output.

### Unproductive Argument Patterns

| Pattern | Detection | Resolution |
|---------|-----------|------------|
| **Circular argument** | Same claim repeated 2+ times with no new authority | Declare the point unresolved and move on |
| **Appeal to authority** | "It's well established that..." without a specific citation | Demand the specific case, statute, or section |
| **Strawman** | Agent misrepresents a competing position to attack it | Correct the misrepresentation, re-state the original position |
| **Scope creep** | Agent introduces facts not in the record or a different jurisdiction | Redirect to the stated facts and governing law |
| **Premature agreement** | All agents agree in Round 1 without substantive challenge | Push for devil's advocate — "What would opposing counsel argue?" |
| **Phantom citation** | Case or section cited without a verifiable anchor | Flag as unverified; do not rely on it in the verdict |

## Consensus Assessment

After Round 2, evaluate:

### Clear Consensus (proceed to output)

- 2+ agents explicitly endorse the same position
- Remaining agents rank the consensus choice as their second-strongest
- No unresolved controlling adverse authority against the consensus choice

### Narrow Margin (fallback to judge)

- Agents split evenly or nearly evenly
- Two positions have comparably strong authority
- Unresolved challenges exist against all positions

### No Convergence (fallback to judge)

- Agents maintain their original positions without meaningful concessions
- Arguments are equally strong but turn on unresolved facts or an open question of law

## Judge Synthesis Rules

When acting as judge:

1. **Review all arguments** — consider every point raised, not just final positions
2. **Weight by authority quality** — binding, on-point, current authority outweighs persuasive, distinguishable, or theoretical argument
3. **Identify the deciding factor** — which element, test, or authority tips the balance?
4. **Acknowledge trade-offs** — the verdict should not pretend the winning position is free of risk or adverse authority
5. **Produce a clear recommendation** — ambiguous verdicts defeat the purpose, but note the confidence level and what would change the answer

## Edge Cases

### Proposition with Two Advocates (for/against)

A 2-agent proposition debate is inherently adversarial (a straight for/against split, each side led by a KC/SC). Keep it honest by:
- Requiring each advocate to state, in Round 2, what facts or authority would make the opposing case prevail
- Requiring each advocate to identify any fallback or settlement position its client should consider

### Contested Proposition (two-a-side)

With 4 agents split two-a-side on one proposition, avoid duplication within a side:
- Give each side a **lead** (strongest primary line) and a **junior** (second-strongest / reserve line and procedural points)
- In Round 1, each side coordinates only implicitly — agents still develop independently; the facilitator, not the agents, deconflicts overlap when summarising

### Problem is Under-Specified

If agents struggle to argue concretely due to missing facts or unstated jurisdiction:
- Pause the debate
- Present the gaps to the user via AskUserQuestion (e.g., "Which jurisdiction's law governs?", "Is there a written contract?")
- Resume with clarified facts and governing law

### Agents Discover a Better Framing

If during debate an agent reframes the question in a way that changes the analysis (e.g., "this is really a limitation issue, not a merits issue"):
- Share the reframing with all agents
- Allow a brief additional development round with the new framing
- This is valuable — it means the debate surfaced a threshold or dispositive issue
