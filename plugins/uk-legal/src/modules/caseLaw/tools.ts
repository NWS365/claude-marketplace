/**
 * Wires up the case_law module: its search tools, the companion retrieval
 * tools, and the judgment:// resources.
 *
 * Data comes from TNA's Find Case Law public API, which serves Atom/XML and
 * caps callers at 1,000 requests every 5 minutes.
 */
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { assertOk } from "../../shared/http.js";
import { READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import {
  TNA_BASE,
  parseAtomFeed,
  grepParagraphs,
  extractHeader,
  extractIndex,
  extractParagraph,
} from "./parsers.js";
import type { GrepResult } from "./models.js";

/** Pull a slug's LegalDocML XML once and hold it for an hour, so the header, index, and paragraph calls all reuse the same fetch. */
async function fetchJudgmentXml(deps: Deps, slug: string): Promise<string> {
  const cleaned = slug.replace(/^\/+/, "");
  const url = `${TNA_BASE}/${cleaned}/data.xml`;
  const f = assertOk(await deps.xmlGet(url, { cacheTtl: TTL.HOUR }));
  return f.text;
}

export function registerCaseLawTools(server: McpServer, deps: Deps): void {
  // ------------------------------------------------------------------ search
  server.registerTool(
    "case_law_search",
    {
      title: "Search UK Case Law",
      description: `Reach for this to look up UK judgments — whether by the parties, the court, a named judge, a date, or plain keywords.

You get back a paged list of judgment summaries, each carrying a neutral
citation, court, the relevant dates, a slug, and a durable TNA URI. From a
result: hand its slug to judgment_get_header, judgment_get_index, or
judgment_get_paragraph (or the equivalent judgment:// resources) to fetch
content; run its neutral citation through citations_resolve to confirm it
before you build an OSCOLA reference; and use case_law_grep_judgment to
search text inside one judgment. Where a party name produces a long list,
tighten it with the court and year filters first — homing in on the likely
case beats grepping through every candidate's full text.

What is indexed: Find Case Law's holdings reach back to roughly the early
2000s. To get at an older authority, track down a recent judgment that
cites it and read the citing paragraph.

This is the definitive source for UK case law; ordinary web search returns
stale or fragile links, so don't lean on it as a supplement.`,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("Free-text query, for example 'negligence duty of care'"),
        court: z
          .string()
          .optional()
          .describe(
            "Restrict to one court, given as its slug. Accepted values: 'uksc', 'ukpc', 'ewca/civ', 'ewca/crim', 'ewhc/kb', 'ewhc/ch', 'ewhc/comm', 'ewhc/fam', 'ewhc/pat', 'ewhc/ipec', 'ewhc/admin', 'ewhc/tcc', 'ewhc/costs', 'ewfc', 'ewcop', 'eat', 'ukut/iac', 'ukut/aac', 'ukut/tcc', 'ukut/lc', 'ukftt/tc', 'ukftt/grc', 'nica', 'niqb'.",
          ),
        judge: z
          .string()
          .optional()
          .describe(
            "Restrict to a named judge by surname. Matching is case-insensitive against any substring of the indexed name. Give just the surname ('Reed', 'Sumption'), optionally with a plain title in front ('Lord Reed'). Trailing honorifics quietly empty the result set, so leave off 'JSC', 'of Allermuir', 'KC' and similar. Guessing at a fuller form than the one TNA holds returns 0 hits and no error.",
          ),
        party: z.string().optional().describe("Restrict to a named party"),
        from_date: z
          .string()
          .optional()
          .describe(
            "Lower date bound (YYYY-MM-DD) on the judgment date. Heads up: as things stand the TNA atom.xml endpoint seems to disregard this parameter, returning the same results either way. Don't count on it to trim output — sort and slice on your side, or sharpen `query`, instead.",
          ),
        to_date: z
          .string()
          .optional()
          .describe(
            "Upper date bound (YYYY-MM-DD) on the judgment date. Carries the same warning as `from_date`: upstream drops it without comment for now, so any real narrowing must happen client-side.",
          ),
        page: z
          .number()
          .int()
          .gte(1)
          .lte(50)
          .default(1)
          .describe("Which page of results to fetch (starts at 1)"),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(50)
          .default(10)
          .describe(
            "How many results to hand back (1–50). Since TNA sends at most 50 per call, this trims the list locally. The default of 10 keeps the shortlist tight; raise it for wider coverage (say 50 to sweep the entire batch).",
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search UK Case Law"),
    },
    async (args) => {
      const { query, court, judge, party, from_date, to_date, page, limit } = args;
      const qp = new URLSearchParams();
      qp.set("query", query);
      qp.set("page", String(page));
      if (court) qp.set("court", court);
      if (judge) qp.set("judge", judge);
      if (party) qp.set("party", party);
      if (from_date) qp.set("from", from_date);
      if (to_date) qp.set("to", to_date);
      try {
        const f = assertOk(
          await deps.xmlGet(`${TNA_BASE}/atom.xml?${qp.toString()}`, { cacheTtl: TTL.HOUR }),
        );
        return jsonResult(parseAtomFeed(f.text, limit));
      } catch (err) {
        return toolErrorFromException(err, `case_law_search(query='${query}')`);
      }
    },
  );

  // ----------------------------------------------------------- grep_judgment
  server.registerTool(
    "case_law_grep_judgment",
    {
      title: "Search within a UK Court Judgment",
      description: `Turn to this once you hold a judgment slug and want the paragraphs whose text matches some pattern.

Each hit comes back as \`{eId, snippet, match}\`, the snippet being a short
excerpt built around where the pattern landed. To read a match in full,
follow up with judgment_get_paragraph(slug, eId) or the
judgment://{slug}/para/{eId} resource.

When to use it: searching the body of a single judgment for wording (say
"negligence", "test for foreseeability", or "Donoghue"). If instead you
want to browse by paragraph number via eId, use judgment_get_index.

The pattern is read as a regular expression; should it fail to compile,
the search degrades to a plain substring match.`,
      inputSchema: {
        slug: z
          .string()
          .min(8)
          .describe("A TNA judgment slug such as 'uksc/2024/12' or 'ewca/civ/2023/450'."),
        pattern: z
          .string()
          .min(2)
          .max(200)
          .describe(
            "The regular expression (or literal substring) to look for across paragraph text. When it won't compile as regex, the tool searches for it as a plain substring instead.",
          ),
        case_insensitive: z
          .boolean()
          .default(true)
          .describe("Defaults to true; pass false to make matching respect letter case."),
        max_hits: z
          .number()
          .int()
          .gte(1)
          .lte(100)
          .default(25)
          .describe("Upper limit on how many hits come back."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search within a UK Court Judgment"),
    },
    async (args) => {
      const cleaned = args.slug.replace(/^\/+/, "");
      const { pattern, case_insensitive, max_hits } = args;
      try {
        const xml = await fetchJudgmentXml(deps, cleaned);
        const hits = grepParagraphs(xml, pattern, case_insensitive, max_hits);
        const result: GrepResult = {
          slug: cleaned,
          pattern,
          hits,
          truncated: hits.length >= max_hits,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `case_law_grep_judgment(slug='${cleaned}')`);
      }
    },
  );

  // ------------------------------------------------------ judgment_get_header
  server.registerTool(
    "judgment_get_header",
    {
      title: "Get Judgment Header",
      description: `Use this once you have a judgment slug and want its metadata — the parties, judges, neutral citation, court, and dates.

Run case_law_search beforehand to obtain the slug. From here, reach for
judgment_get_index to enumerate the paragraphs, then judgment_get_paragraph
to read particular ones. This is the definitive source for UK judgment
metadata.`,
      inputSchema: {
        slug: z
          .string()
          .min(3)
          .max(200)
          .describe("A judgment slug, e.g. 'uksc/2024/12' or 'ewca/civ/2023/450'"),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Judgment Header"),
    },
    async (args) => {
      try {
        const xml = await fetchJudgmentXml(deps, args.slug);
        return jsonResult({ slug: args.slug, header: extractHeader(xml) });
      } catch (err) {
        return toolErrorFromException(err, `judgment_get_header(slug='${args.slug}')`);
      }
    },
  );

  // ------------------------------------------------------- judgment_get_index
  server.registerTool(
    "judgment_get_index",
    {
      title: "Get Judgment Paragraph Index",
      description: `Use this when you hold a judgment slug and want its paragraph navigation index — an eId plus a preview line for each paragraph.

Get the slug from case_law_search first. Then take any eId from the
returned list and pass it to judgment_get_paragraph for that paragraph's
full text, or run case_law_grep_judgment to search the wording across every
paragraph.`,
      inputSchema: {
        slug: z.string().min(3).max(200).describe("A judgment slug, e.g. 'uksc/2024/12'"),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Judgment Paragraph Index"),
    },
    async (args) => {
      try {
        const xml = await fetchJudgmentXml(deps, args.slug);
        const raw = extractIndex(xml);
        const paragraphs: Array<{ eId: string; preview: string }> = [];
        for (const line of raw.trim().split("\n")) {
          const idx = line.indexOf(":");
          if (idx !== -1) {
            paragraphs.push({
              eId: line.slice(0, idx).trim(),
              preview: line.slice(idx + 1).trim(),
            });
          }
        }
        return jsonResult({ slug: args.slug, paragraphs });
      } catch (err) {
        return toolErrorFromException(err, `judgment_get_index(slug='${args.slug}')`);
      }
    },
  );

  // --------------------------------------------------- judgment_get_paragraph
  server.registerTool(
    "judgment_get_paragraph",
    {
      title: "Get Judgment Paragraph",
      description: `Use this when you have both a judgment slug and a LegalDocML eId and want the full text of that paragraph.

First find the available eIds through judgment_get_index (or pinpoint
paragraphs by their wording with case_law_grep_judgment). The response is
the paragraph's XML content, typically somewhere between 400 and 1,700
tokens.`,
      inputSchema: {
        slug: z.string().min(3).max(200).describe("A judgment slug, e.g. 'uksc/2024/12'"),
        eId: z
          .string()
          .min(1)
          .max(100)
          .describe(
            "A paragraph eId taken from judgment_get_index, such as 'para_12'. A bare number like '12' is also accepted and gets rewritten to 'para_12'.",
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Judgment Paragraph"),
    },
    async (args) => {
      try {
        const xml = await fetchJudgmentXml(deps, args.slug);
        let normalized = args.eId.trim();
        if (/^\d+$/.test(normalized)) normalized = `para_${normalized}`;
        const content = extractParagraph(xml, normalized);
        return jsonResult({ slug: args.slug, eId: normalized, content });
      } catch (err) {
        return toolErrorFromException(err, `judgment_get_paragraph(slug='${args.slug}')`);
      }
    },
  );

  registerCaseLawResources(server, deps);
}

/**
 * The judgment:// resource templates. The `{+slug}` form (RFC 6570 reserved
 * expansion) captures slugs that contain slashes, e.g. "uksc/2024/12";
 * `{slug*}` would not.
 */
function registerCaseLawResources(server: McpServer, deps: Deps): void {
  server.registerResource(
    "UK Court Judgment — metadata header",
    new ResourceTemplate("judgment://{+slug}/header", { list: undefined }),
    {
      description:
        "A TNA judgment's metadata — parties, judges, neutral citation, court, and dates — around 1,000 tokens. Read this first to get your bearings on a judgment. Example slugs: 'uksc/2024/12', 'ewca/civ/2023/450'.",
      mimeType: "application/xml",
    },
    async (uri, variables) => {
      const slug = String(variables.slug);
      const xml = await fetchJudgmentXml(deps, slug);
      return { contents: [{ uri: uri.href, mimeType: "application/xml", text: extractHeader(xml) }] };
    },
  );

  server.registerResource(
    "UK Court Judgment — paragraph index",
    new ResourceTemplate("judgment://{+slug}/index", { list: undefined }),
    {
      description:
        "A navigation index of 'eId: first_line' rows, one per paragraph in the judgment (roughly 4,000 tokens for a typical Supreme Court decision). Use it to learn the paragraph identifiers, then open individual paragraphs through judgment://{slug}/para/{eId}. To locate paragraphs by their content instead, use the case_law_grep_judgment tool.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const slug = String(variables.slug);
      const xml = await fetchJudgmentXml(deps, slug);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: extractIndex(xml) }] };
    },
  );

  server.registerResource(
    "UK Court Judgment — single paragraph",
    new ResourceTemplate("judgment://{+slug}/para/{eId}", { list: undefined }),
    {
      description:
        "One <paragraph> element identified by its LegalDocML eId (for example 'para_12'), together with whatever sub-paragraphs sit inside it. Usually 400-1,700 tokens. Consult the index resource to find which eIds are available.",
      mimeType: "application/xml",
    },
    async (uri, variables) => {
      const slug = String(variables.slug);
      const eId = String(variables.eId);
      const xml = await fetchJudgmentXml(deps, slug);
      return {
        contents: [{ uri: uri.href, mimeType: "application/xml", text: extractParagraph(xml, eId) }],
      };
    },
  );
}
