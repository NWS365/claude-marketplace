# Evidence Digest Reference

Mechanics for **Phase 0 — Evidence pre-processing**. When the debate is supplied with evidence (contracts, correspondence, pleadings, witness statements, exhibit bundles, transcripts, long pasted text, or attached files), read it and distil it into a single **greppable structured digest file** *before any debate begins*. The digest — not the raw evidence — is what grounds the debate after the `/clear` handoff.

## Why a digest, and why `/clear`

Raw evidence is token-heavy and its useful facts are diffuse. Ingesting it directly bloats the debate context, crowds out the multi-agent argument, and re-reads the same material for every advocate. The digest solves this: read the evidence **once**, distil it into a compact, structured, ID'd record written to a file that survives a context reset, then have the human `/clear` and start the debate fresh. Advocates then **grep the digest** for the facts they need rather than each re-ingesting the bundle.

The `/clear` is not optional and not cosmetic — it is what makes the digest worthwhile. Producing the digest and then continuing to debate *in the same context* defeats the purpose.

## Hard rules

- **Extraction, not adjudication.** The digest records what the evidence *says* and flags the legal issues it *raises*. It does **not** decide any issue, weigh any argument, or reach a conclusion — that is the debate's job. Spotting "this raises a limitation question" is in scope; answering it is not.
- **No fabrication.** Every fact must trace to a source in the evidence. If something is inferred rather than stated, tag it `[INFERENCE]` and give the basis. If it is missing, record it under *Gaps & unknowns* — never invent it.
- **Provenance on every fact.** Each fact line drawn from a document carries the `[DOCUMENT:D##]` tag **and** ends with a standard `Source:` locator (see the greppability contract) precise enough to find and quote later — page / paragraph / clause / line, or a timestamp for a transcript.
- **Verbatim where it matters.** Capture operative wording — the clause, the admission, the key sentence — as an exact quote in a **quote block** (a markdown `>` blockquote on the line immediately below the fact), not a paraphrase. Paraphrase is fine for context; a quote block is required for anything an advocate might read to the bench, and its fact line carries `[QUOTE]`.
- **Authorities are captured, not verified.** Any case, statute, section, or citation *mentioned inside the evidence* is recorded verbatim and tagged `[AUTHORITY][TO-VERIFY]`. Do **not** run the uk-legal verification protocol here — that happens in the debate. The digest only preserves what the evidence cited.
- **No privilege / confidentiality laundering.** If a document is marked privileged, "without prejudice", or confidential, record that status against it in the document index and carry the flag onto any fact drawn from it. Do not strip such markings.

## Greppability contract

The digest is written to be searched by an LLM or `grep`/ripgrep, so structure is fixed and tags are literal:

- **Stable section headers** — use the exact `##` headers listed in the template below, unchanged, so a reader can jump to a section by name.
- **Stable IDs** — every fact `[F###]`, every document `[D##]`, every actor `[P##]` is **zero-padded** (`F001`, `D01`, `P01`); spotted issues use a plain sequence `[ISSUE-N]` (not padded). Facts run **one global `F###` sequence** across every fact section (Agreed, Disputed, Key terms, Admissions, Authorities) — never restarted per section and never reused. Advocates cite them ("per F014") and the digest cross-references them.
- **Literal bracketed tags** — one or more per fact, drawn from the closed vocabulary below, so `grep '\[DISPUTED\]'` or `grep 'ISSUE-3'` returns every relevant line. Tags are UPPERCASE, in square brackets, no spaces inside a tag.
- **Document provenance is doubly greppable** — a fact drawn from a document carries the `[DOCUMENT:D##]` tag in its tag block **and** a standard `Source:` locator, so `grep '\[DOCUMENT:D01\]'` reliably returns every fact from document D01.
- **Standard `Source:` format** — always `Source: D## · <locator>`, leading with the document ID, where `<locator>` is `p.N`, `clause N`, `para N`, `line N`, or a transcript timestamp (e.g. `Source: D01 · clause 7.1`). Lead with `D##` so provenance sorts and greps cleanly.
- **ISO dates** — always `[DATE:YYYY-MM-DD]` (or `YYYY-MM` / `YYYY` if that is all the evidence gives). Never prose dates in the tag.
- **One fact per line** — each fact is a single bullet so a grep hit returns a complete, self-contained statement. **Sanctioned exception:** a `[QUOTE]` fact may place its verbatim wording in a `>` blockquote on the immediately following line(s); grep the `[QUOTE]` tag (or the fact ID) to find the fact, then read the block beneath it. This is the only case where a fact spans more than one line.

### Tag vocabulary (closed set)

| Tag | Meaning |
|-----|---------|
| `[AGREED]` | Fact common ground / admitted / uncontested on the evidence |
| `[DISPUTED]` | Fact contested between the parties |
| `[DATE:YYYY-MM-DD]` | Anchors the fact to a date (chronology) |
| `[PARTY:P##]` | Attributes the fact to an actor by ID |
| `[DOCUMENT:D##]` | Fact is drawn from / concerns a specific document |
| `[ADMISSION]` | An admission against a party's own interest |
| `[TERM]` | A contractual term, clause, or obligation |
| `[EVENT]` | A dated occurrence (breach, notice, payment, meeting) |
| `[ISSUE-N]` | Links the fact to a spotted legal issue |
| `[AUTHORITY]` | A case/statute/citation appearing in the evidence |
| `[TO-VERIFY]` | Must be checked in the debate (pairs with `[AUTHORITY]`, or with `[INFERENCE]` where the inference needs confirming) |
| `[INFERENCE]` | Not stated; inferred — basis given inline |
| `[QUOTE]` | Fact carries operative verbatim wording in a `>` blockquote on the line below |
| `[PRIVILEGED]` | Drawn from a privileged / without-prejudice / confidential document |

## Template

Write the file as `legal-evidence-digest-{matter-slug}.md` in the current working directory, where `{matter-slug}` is a short lowercase-hyphenated identifier derived from the matter or the parties (e.g. `acme-v-brown`, `delay-clause-penalty`). Use these headers verbatim and in this order.

```markdown
# Legal Evidence Digest — {Matter name}

> **NOT LEGAL ADVICE.** A factual extraction for debate preparation only; records the evidence, decides nothing. To be reviewed by a qualified, jurisdictionally-licensed lawyer.

## Matter summary
- **Matter slug:** {matter-slug}
- **Question(s) the debate will address:** {the legal question(s), as understood so far}
- **Jurisdiction / governing law:** {or "UNKNOWN — to confirm at debate start"}
- **Digest generated:** {date}
- **Sources ingested:** {count} document(s) — see Documents index

## Parties & actors
| ID | Name / role | Interest / side | Notes |
|----|-------------|-----------------|-------|
| P01 | {name} | {claimant / defendant / third party / witness} | {} |

## Documents index
| ID | Document | Date | Type | Status | Source locator |
|----|----------|------|------|--------|----------------|
| D01 | {title} | YYYY-MM-DD | {contract / letter / statement / pleading …} | {none / PRIVILEGED / WITHOUT-PREJUDICE / DRAFT} | {file name} |

## Chronology
Dated events in ascending order; one per line, each linked to its fact ID.
- **YYYY-MM-DD** — {event} — [F###]

## Agreed facts
- **[F001]** [AGREED] [EVENT] [DATE:YYYY-MM-DD] [PARTY:P01] [DOCUMENT:D01] {dated occurrence, e.g. notice served}. Source: D01 · p.3. Relates to: [ISSUE-1].

## Disputed facts
- **[F002]** [DISPUTED] [PARTY:P01] [DOCUMENT:D03] {P01's version} — contrast [PARTY:P02] {P02's version}. Source: D03 · para 12. Relates to: [ISSUE-2].

## Key terms & obligations
- **[F003]** [TERM] [QUOTE] [DOCUMENT:D01] {what the clause does}. Source: D01 · clause 7.1.
  > "{exact clause text}"

## Admissions & statements against interest
- **[F004]** [ADMISSION] [QUOTE] [PARTY:P02] [DOCUMENT:D04] {what was admitted and why it cuts against P02}. Source: D04 · p.2.
  > "{exact wording}"

## Authorities cited in the evidence
- **[F005]** [AUTHORITY] [TO-VERIFY] [DOCUMENT:D06] {case/section as it appears in the evidence, verbatim}. Source: D06 · para 12. (Verify in debate.)

## Spotted legal issues
Issues the evidence *raises*. Flagged only — **not** analysed or decided.
- **[ISSUE-1]** {the question, e.g. "Was notice validly served under clause 12?"} — turns on: [F014], [F015], [F031].

## Gaps & unknowns
- {facts, dates, documents, or jurisdictional points the evidence does not establish and the debate will need}
```

## Handoff prompt

After writing the file, **stop** and prompt the human — do not enter Phase 1 in the same context:

> ✅ Evidence digest written to `./legal-evidence-digest-{matter-slug}.md` — {N} facts, {M} documents, {K} spotted issues, {D} disputed points.
>
> The raw evidence is now distilled into a greppable factual record that will survive a context reset. To keep the debate focused and independent, **run `/clear` now**, then start the debate — for example:
>
> > *"Debate whether {question}, grounded in `legal-evidence-digest-{matter-slug}.md`."*
>
> The debate will read the digest as its factual record and grep it for specifics, rather than re-ingesting the raw evidence.

## After `/clear` — picking the digest back up

When the debate starts in the fresh context, Phase 1 loads the digest as the **factual record**:

- Treat the digest's *Agreed facts*, *Disputed facts*, *Key terms*, and *Chronology* as the record; argue on those, not on re-read raw evidence.
- Carry the digest's *Spotted legal issues* into problem classification and into the positions each advocate develops.
- Pass the digest **file path** into every advocate prompt (Phase 2) with an instruction to **grep it by fact ID / tag** for what they need and to **cite facts by ID** (e.g. "per F014") in their submissions.
- Run the uk-legal verification protocol on every `[AUTHORITY][TO-VERIFY]` entry before it is relied on — the digest preserved the citation; the debate must verify it.
- If the digest flags the jurisdiction as UNKNOWN, resolve it with the user before spawning, per the standard Phase 1 rule.
