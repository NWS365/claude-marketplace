/**
 * OSCOLA citation parsing and resolution tools for the citations module.
 *
 * Self-contained, with no reliance on an external JSON API — everything runs on
 * regex plus optional MCP sampling. Only two of the tools reach the network:
 * citations_resolve fires a HEAD existence probe at TNA and citations_network
 * downloads a data.xml document. citations_parse and citations_format_oscola are
 * pure transforms that never make a request.
 */
import { z } from "zod";
import { performance } from "node:perf_hooks";
import { assertOk } from "../../shared/http.js";
import { errorResult, jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { READ_ONLY_CLOSED, READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import { AMBIGUOUS_COURTS, buildOscola, compilePatterns, extractAllCitations, resolveNeutralCitation, titleCase, TNA_BASE, } from "./parsers.js";
/** Render a scalar the way Python's repr() would, for the `attempted` error breadcrumb. */
function pyRepr(v) {
    if (v === undefined || v === null)
        return "None";
    if (typeof v === "string")
        return `'${v}'`;
    if (typeof v === "boolean")
        return v ? "True" : "False";
    return String(v);
}
/** Thrown once the TNA HEAD check has spent its single retry and is still failing. */
class TnaTransientError extends Error {
    constructor(message) {
        super(message);
        this.name = "TnaTransientError";
    }
}
/**
 * Check a neutral citation against TNA Find Case Law. Returns 0.0 when TNA
 * reports the document missing (any non-200 status) and null when it is present
 * (a 200, leaving confidence untouched). A transport failure that outlasts one
 * retry throws TnaTransientError.
 */
async function tnaHeadCheck(deps, url) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await deps.head(url, { timeoutMs: 3000 });
            return resp.status !== 200 ? 0.0 : null;
        }
        catch (exc) {
            if (attempt === 1) {
                const name = exc instanceof Error ? exc.name : "Error";
                throw new TnaTransientError(`TNA verification failed after retry (${name}).`);
            }
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    return null;
}
/** Pin down an ambiguous bare court code by asking the client's model over MCP sampling. */
async function disambiguateCitation(deps, citation) {
    if (!citation.court || !AMBIGUOUS_COURTS.has(citation.court))
        return citation;
    const prompt = `The neutral citation '${citation.raw}' uses '${citation.court}' without a division qualifier.\n` +
        `Respond with ONLY one abbreviation from: KB, Ch, Comm, Fam, Pat, IPEC, Admin, TCC, Costs, unknown\n` +
        `No explanation, no other text.`;
    try {
        const result = await deps.sample(prompt);
        // Degrade gracefully: if sampling is unavailable or comes back empty, leave the citation as-is.
        if (result == null)
            return citation;
        const division = result.trim().toUpperCase();
        const allowed = new Set(["KB", "CH", "COMM", "FAM", "PAT", "IPEC", "ADMIN", "TCC", "COSTS", "UNKNOWN"]);
        if (!allowed.has(division))
            return citation;
        if (division === "UNKNOWN")
            return citation;
        const newCourt = `${citation.court} (${titleCase(division)})`;
        const newUrl = citation.year && citation.number
            ? resolveNeutralCitation(citation.year, newCourt, citation.number)
            : null;
        return { ...citation, court: newCourt, resolved_url: newUrl, confidence: 0.75 };
    }
    catch {
        return citation;
    }
}
// --- Input schemas (ZodRawShape) ---
const parseInputSchema = {
    text: z
        .string()
        .min(1)
        .max(50_000)
        .describe("Prose to scan for OSCOLA citations. Recognised forms: neutral citations ([2024] UKSC 12), law reports ([2024] 1 WLR 100), legislation sections (s.47 Companies Act 2006), SIs (SI 2018/1234), retained EU law (Regulation (EU) 2016/679). Upper limit 50,000 characters."),
    disambiguate: z
        .boolean()
        .default(false)
        .describe("Left False, extraction is purely regex-driven with no model involved. Set True to route ambiguous citations (for example a bare EWHC that omits its division) through the connected client's own LLM via MCP sampling so the division can be inferred. Turn this on only when you want best-effort division inference and accept that a model shapes the outcome."),
};
const resolveInputSchema = {
    citation: z
        .string()
        .min(3)
        .max(500)
        .describe("One OSCOLA citation to parse and resolve, such as '[2024] UKSC 12', 'SI 2018/1234', or 's.47 Companies Act 2006'"),
};
const networkInputSchema = {
    case_uri: z
        .string()
        .min(5)
        .describe("Slug portion of a TNA judgment URI, e.g. 'uksc/2024/12' or 'ewca/civ/2023/450'. Take the 'uri' field returned by case_law_search rather than the full URL, and leave off the 'https://caselaw.nationalarchives.gov.uk/' prefix."),
};
const formatInputSchema = {
    citation_type: z
        .enum(["neutral", "law_report", "legislation", "si", "eu_retained"])
        .describe("The 'type' field as returned by citations_resolve."),
    confidence: z
        .number()
        .gte(0.0)
        .lte(1.0)
        .describe("The 'confidence' value from citations_resolve. A 0.0 here blocks formatting, since it signals that TNA confirmed the document is absent. Supply exactly what citations_resolve returned rather than guessing."),
    resolved_url: z
        .string()
        .nullable()
        .optional()
        .describe("The 'resolved_url' from citations_resolve. For neutral citations it cannot be null."),
    year: z.number().int().nullable().optional().describe("The 'year' field from citations_resolve."),
    court: z
        .string()
        .nullable()
        .optional()
        .describe("The 'court' field from citations_resolve, e.g. 'UKSC', 'EWCA CIV', 'EWHC (KB)'."),
    number: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("The 'number' field from citations_resolve — the judgment's number within its year."),
    report_series: z
        .string()
        .nullable()
        .optional()
        .describe("The 'report_series' field from citations_resolve, e.g. 'WLR', 'AC', 'QB'."),
    volume: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("The 'volume' field from citations_resolve — the law report volume, where one applies."),
    page: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("The 'page' field from citations_resolve — the opening page within the law report."),
    legislation_title: z
        .string()
        .nullable()
        .optional()
        .describe("The 'legislation_title' field from citations_resolve, e.g. 'Companies Act 2006'."),
    section: z
        .string()
        .nullable()
        .optional()
        .describe("The 'section' field from citations_resolve, e.g. '47', '12', '20A'."),
    si_year: z.number().int().nullable().optional().describe("The 'si_year' field from citations_resolve."),
    si_number: z.number().int().nullable().optional().describe("The 'si_number' field from citations_resolve."),
    raw: z
        .string()
        .nullable()
        .optional()
        .describe("The 'raw' field from citations_resolve. For retained EU law it is taken verbatim, because the original wording keeps the Regulation/Directive distinction intact."),
};
// --- Tool descriptions ---
const PARSE_DESCRIPTION = `REACH FOR THIS TOOL when you hold a block of free text (a memo, an email, a clause) and need every OSCOLA-style citation inside it pulled out and categorised.

Detects: neutral citations ([2024] UKSC 12), law reports ([2024] 1 WLR
100), legislation sections (s.47 Companies Act 2006), SIs (SI 2018/1234),
retained EU law (Regulation (EU) 2016/679).

By default the work is done entirely with regex. You MAY optionally
disambiguate uncertain citations (say a bare [2024] EWHC with no division)
by passing disambiguate=True, which hands the division decision to the
CONNECTED CLIENT's own model — not this server — over MCP sampling; that
stays off unless you enable it. Where possible, citations map to TNA /
legislation.gov.uk URLs.

ONCE you have the results, run each citation through citations_resolve to
confirm it truly points at a live document before quoting or formatting it —
this tool matches the SHAPE of a citation but does not guarantee the
document is real.`;
const RESOLVE_DESCRIPTION = `CALL THIS TOOL BEFORE you assemble an OSCOLA citation string out of fields you already hold, OR when you need to check that a citation really points at an existing document.

It parses and resolves a lone citation (neutral citation, SI, legislation
section, retained EU law) and returns the parsed fields together with
resolved_url. Neutral citations trigger a live TNA HEAD request — any
non-200 response drops confidence to 0.0 (document absent). Never format
or quote a citation whose confidence is 0.0.

Should the TNA HEAD request fail (a timeout or connection error), the tool
raises ToolError carrying {"error_category": "transient", "is_retryable":
true}. A single retry runs automatically — retry the call yourself or carry
on without TNA verification.

Building a citation from "known" fields without resolving first is the most
frequent path to fabrication. When this tool raises or comes back with no
resolved_url, do NOT invent a citation — report the failure and ask the
user for the source URL.

The definitive route for resolving UK legal citations.`;
const NETWORK_DESCRIPTION = `TURN TO THIS TOOL when you have a judgment slug and want a map of everything it cites — the cases it relies on, the legislation it references, SIs, retained EU law.

It pulls the judgment XML from TNA and extracts every OSCOLA citation it
contains, returning them bucketed by type, deduplicated and sorted.
AFTERWARDS, run any single citation through citations_resolve to check
that it resolves and to obtain its canonical URL.

Handy for authority-network work (which sources did this judgment lean
on?) and for mapping the legislative context a case sits within.`;
const FORMAT_DESCRIPTION = `RUN THIS TOOL AFTER citations_resolve to emit the properly formatted OSCOLA citation string.

Feed the parsed fields that citations_resolve produced straight into this
tool. It formats each citation type according to OSCOLA 4th edition rules.

It declines (status: upstream_validation) whenever confidence is 0.0 — TNA
has confirmed the document is not real — or whenever a neutral citation
lacks a resolved_url (an ambiguous court code, e.g. a bare EWHC missing its
division). Either way, do NOT invent a citation; report the failure and ask
the user for the source URL or stronger identifying details.

Do NOT assemble the input fields on your own. That structured input has to
originate from citations_resolve — guessing at fields is the main way
citations get fabricated, and this tool is the safeguard against it.

Definitive OSCOLA formatting for UK legal citations, with no network call.`;
export function registerCitationsTools(server, deps) {
    server.registerTool("citations_parse", {
        title: "Parse OSCOLA Citations",
        description: PARSE_DESCRIPTION,
        inputSchema: parseInputSchema,
        annotations: withTitle({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }, "Parse OSCOLA Citations"),
    }, async (args) => {
        const { text, disambiguate } = args;
        try {
            const t0 = performance.now();
            const patterns = compilePatterns();
            const [confident, ambiguousList] = extractAllCitations(text, patterns);
            let ambiguous = ambiguousList;
            if (disambiguate && ambiguous.length > 0) {
                const stillAmbiguous = [];
                for (const c of ambiguous) {
                    const result = await disambiguateCitation(deps, c);
                    (result.confidence >= 0.7 ? confident : stillAmbiguous).push(result);
                }
                ambiguous = stillAmbiguous;
            }
            const durationMs = Math.trunc(performance.now() - t0);
            const out = {
                citations: confident,
                ambiguous,
                text_length: text.length,
                parse_duration_ms: durationMs,
            };
            return jsonResult(out);
        }
        catch (err) {
            return toolErrorFromException(err, `citations_parse(text=<${text.length} chars>, disambiguate=${pyRepr(disambiguate)})`);
        }
    });
    server.registerTool("citations_resolve", {
        title: "Resolve Single OSCOLA Citation",
        description: RESOLVE_DESCRIPTION,
        inputSchema: resolveInputSchema,
        annotations: withTitle(READ_ONLY_OPEN, "Resolve Single OSCOLA Citation"),
    }, async (args) => {
        const { citation } = args;
        try {
            const patterns = compilePatterns();
            const [confident, ambiguous] = extractAllCitations(citation.trim(), patterns);
            const allFound = confident.concat(ambiguous);
            if (allFound.length === 0) {
                throw new Error(`No recognised OSCOLA citation found in '${citation}'. ` +
                    `Supported: [YYYY] COURT N, [YYYY] N SERIES PAGE, s.N Act YYYY, SI YYYY/N, Regulation (EU) YYYY/N`);
            }
            let parsed = allFound[0];
            // Neutral citations get a live existence probe — being able to build a URL
            // is not the same as a judgment actually living at it.
            if (parsed.resolved_url && parsed.type === "neutral") {
                const newConfidence = await tnaHeadCheck(deps, parsed.resolved_url);
                if (newConfidence !== null) {
                    parsed = { ...parsed, confidence: newConfidence };
                }
            }
            return jsonResult(parsed);
        }
        catch (err) {
            if (err instanceof TnaTransientError) {
                return errorResult({
                    error_category: "transient",
                    is_retryable: true,
                    message: `TNA verification failed after retry (${err.name}).`,
                });
            }
            return toolErrorFromException(err, `citations_resolve(citation=${pyRepr(citation)})`);
        }
    });
    server.registerTool("citations_network", {
        title: "Get Case Citation Network",
        description: NETWORK_DESCRIPTION,
        inputSchema: networkInputSchema,
        annotations: withTitle(READ_ONLY_OPEN, "Get Case Citation Network"),
    }, async (args) => {
        const { case_uri } = args;
        try {
            const uri = case_uri.replace(/^\/+/, "");
            const f = assertOk(await deps.xmlGet(`${TNA_BASE}/${uri}/data.xml`, { cacheTtl: TTL.HOUR }));
            const patterns = compilePatterns();
            const [confident, ambiguous] = extractAllCitations(f.text, patterns);
            const allCitations = confident.concat(ambiguous);
            const buckets = {
                neutral_citations: [],
                legislation_refs: [],
                si_refs: [],
                eu_refs: [],
                law_report_refs: [],
            };
            const typeMap = {
                neutral: "neutral_citations",
                legislation: "legislation_refs",
                si: "si_refs",
                eu_retained: "eu_refs",
                law_report: "law_report_refs",
            };
            for (const c of allCitations) {
                const key = typeMap[c.type];
                if (key)
                    buckets[key].push(c.raw);
            }
            for (const key of Object.keys(buckets)) {
                buckets[key] = [...new Set(buckets[key])].sort();
            }
            const out = {
                case_uri: uri,
                neutral_citations: buckets.neutral_citations,
                legislation_refs: buckets.legislation_refs,
                si_refs: buckets.si_refs,
                eu_refs: buckets.eu_refs,
                law_report_refs: buckets.law_report_refs,
                total_citations: Object.values(buckets).reduce((sum, v) => sum + v.length, 0),
            };
            return jsonResult(out);
        }
        catch (err) {
            return toolErrorFromException(err, `citations_network(case_uri=${pyRepr(case_uri)})`);
        }
    });
    server.registerTool("citations_format_oscola", {
        title: "Format OSCOLA Citation String",
        description: FORMAT_DESCRIPTION,
        inputSchema: formatInputSchema,
        annotations: withTitle(READ_ONLY_CLOSED, "Format OSCOLA Citation String"),
    }, async (args) => {
        const { citation_type, confidence, resolved_url, year, court, number: num, report_series, volume, page, legislation_title, section, si_year, si_number, raw, } = args;
        try {
            if (confidence === 0.0) {
                return jsonResult({
                    status: "upstream_validation",
                    detail: "Cannot format: citations_resolve returned confidence 0.0 — " +
                        "TNA confirmed this judgment does not exist at the resolved URL. " +
                        "Do not manufacture a citation. Ask the user for the source URL " +
                        "or better identifying details.",
                    is_retryable: false,
                });
            }
            if (citation_type === "neutral" && resolved_url == null) {
                return jsonResult({
                    status: "upstream_validation",
                    detail: "Cannot format: neutral citation has no resolved_url — the court " +
                        "code is ambiguous or unsupported (e.g. bare EWHC without a " +
                        "division). Call citations_resolve with disambiguate=True or ask " +
                        "the user for the full citation including the division.",
                    is_retryable: false,
                });
            }
            try {
                if (citation_type === "neutral" && !(year && court && num)) {
                    throw new Error("Neutral citation requires year, court, and number.");
                }
                if (citation_type === "law_report" && !(year && report_series && page)) {
                    throw new Error("Law report citation requires year, report_series, and page.");
                }
                if (citation_type === "legislation" && !(section && legislation_title)) {
                    throw new Error("Legislation citation requires section and legislation_title.");
                }
                if (citation_type === "si" && !(si_year && si_number)) {
                    throw new Error("SI citation requires si_year and si_number.");
                }
                if (citation_type === "eu_retained" && !raw) {
                    throw new Error("EU retained law citation requires the raw field.");
                }
                const oscola = buildOscola(citation_type, year, court, num, report_series, volume, page, legislation_title, section, si_year, si_number, raw);
                return jsonResult({
                    status: "ok",
                    oscola,
                    citation_type,
                    resolved_url: resolved_url ?? null,
                });
            }
            catch (exc) {
                return jsonResult({
                    status: "upstream_validation",
                    detail: exc instanceof Error ? exc.message : String(exc),
                    is_retryable: false,
                });
            }
        }
        catch (err) {
            return toolErrorFromException(err, `citations_format_oscola(citation_type=${pyRepr(citation_type)})`);
        }
    });
}
