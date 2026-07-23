/**
 * Legislation module tool registrations.
 *
 * Search hits the legislation.gov.uk Atom feed; section and TOC lookups hit
 * the legislation.gov.uk API and return CLML XML. Every request is issued via
 * deps.legislationGet (which impersonates Chrome through impit) and is held in
 * cache for 24 hours.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { jsonResult, toolErrorFromException, LegislationUpstreamError } from "../../shared/envelope.js";
import { assertOk } from "../../shared/http.js";
import { withTitle, READ_ONLY_OPEN } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import type { LegislationTOC } from "./models.js";
import {
  LEGISLATION_BASE,
  normaliseSectionId,
  parseSearchAtom,
  parseClmlSection,
  parseHtmlSection,
  parseTocXml,
  reprStr,
} from "./parsers.js";

const SEARCH_DESC = `REACH FOR THIS TOOL to locate UK Acts and Statutory Instruments — by their title, by a phrase, or across their full text.

Each hit comes back ranked and carries a title, type, year, number, the
legislation.gov.uk URL, plus next_steps pointers (a toc URI and a section
template). Once you have a match, follow it into legislation_get_toc and then
legislation_get_section to drill into the structure.

Be disciplined with the filters. Both \`type\` and \`year\` match exactly, so
only supply them when the value is genuinely known. When the search is driven
by how recent something is ("the recent Renters' Rights Act"), search on the
phrase on its own and pick the year out of the results — a guessed year that
turns out wrong empties the result set entirely. To range across the body of
legislation rather than titles, turn on \`fulltext=True\`.

This is the authoritative feed for UK primary and secondary legislation
(legislation.gov.uk).`;

const GET_SECTION_DESC = `REACH FOR THIS TOOL once you have identified an Act or SI and need the parsed wording of one specific section, together with its extent and in-force metadata.

The response carries the full section text, its territorial extent, whether it
is in force, and a prospective flag. The text is limited by max_chars (default
10,000, roughly 2,500 tokens); bump this up for the rare definition section
that runs long, and consult content_truncated to see whether anything was cut.

Never skip \`extent\`. A provision can be live in England & Wales yet have no
application in Scotland or Northern Ireland, and quoting a section without
verifying its extent is a mistake that comes up again and again in legal
research.

If instead you want the untouched CLML XML, call
read_resource(uri="legislation://{type}/{year}/{number}/section/{section}").
Use this tool when the parsed, structured form is what you are after.`;

const GET_TOC_DESC = `REACH FOR THIS TOOL once you know which Act or SI you want and need its structural table of contents — parts, chapters, sections, schedules.

Every structural element comes back with its XML id and title, such as
'section-47: Definitions'. When you then call legislation_get_section, feed it
the numeric identifier only ('47', not 'section-47').

Long statutes — the Companies Act 2006 alone has many hundreds of entries —
are served in pages through offset/limit, so watch has_more and total_items.

For the whole TOC in one go, call
read_resource(uri="legislation://{type}/{year}/{number}/toc"), which returns a
newline-separated \`id: title\` string with no paging. Prefer this tool when
you want the structured response and its offset / limit / has_more fields to
walk through a large statute a page at a time.`;

export function registerTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "legislation_search",
    {
      title: "Search UK Legislation",
      description: SEARCH_DESC,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("What to search for — for instance 'Housing Act 1988' or 'data protection personal data'"),
        type: z
          .string()
          .optional()
          .describe(
            "Restrict to one type: 'ukpga' (Acts), 'uksi' (SIs), 'asp' (Scottish Acts), 'nia' (NI Acts). This matches exactly, so leave it off when you are not yet sure whether you want an Act or an SI."
          ),
        year: z
          .number()
          .int()
          .gte(1800)
          .lte(2100)
          .optional()
          .describe(
            "Restrict to a single year of enactment — one integer, matched exactly, never a span. Leave it off unless the Act's year is already known to you. A guessed year (say, assuming something recent must be 2026) that misses will wipe out every result, so the safer approach is to search without `year` and then take the year from what comes back."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(50)
          .default(20)
          .describe("How many results to return, from 1 to 50. Forwarded to the upstream results-count parameter."),
        fulltext: z
          .boolean()
          .default(false)
          .describe(
            "Left false, only Act/SI titles are searched — ideal for pinning down a named Act, so 'Housing Act 1988' surfaces ukpga/1988/50 at the top. Set it true to search inside the full text of every Act and SI, which brings back the SIs and regulations that mention the term (for example, 'rental deposits' would return the many instruments that implement it)."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search UK Legislation"),
    },
    async (args) => {
      const { query, type, year, limit, fulltext } = args;
      try {
        const path = type ? `/${type}` : "/search";
        const params = new URLSearchParams();
        params.set("results-count", String(limit));
        params.set(fulltext ? "text" : "title", query);
        if (year !== undefined) params.set("year", String(year));
        const url = `${LEGISLATION_BASE}${path}?${params.toString()}`;
        const f = assertOk(await deps.legislationGet(url, { cacheTtl: TTL.DAY }));
        return jsonResult(parseSearchAtom(f.text));
      } catch (err) {
        return toolErrorFromException(err, `legislation_search(query=${reprStr(query)})`);
      }
    }
  );

  server.registerTool(
    "legislation_get_section",
    {
      title: "Get Legislation Section",
      description: GET_SECTION_DESC,
      inputSchema: {
        type: z
          .string()
          .min(2)
          .max(10)
          .describe(
            "The type code for the legislation: 'ukpga' (Acts), 'uksi' (SIs), 'asp' (Scottish Acts), 'nia' (NI Acts). Take this straight from a legislation_search result."
          ),
        year: z.number().int().gte(1800).lte(2100).describe("The year it was enacted"),
        number: z.number().int().gte(1).describe("The chapter number (Acts) or SI number"),
        section: z
          .string()
          .min(1)
          .max(50)
          .describe(
            "The section number, such as '47' or '12A'. Give the number on its own, not 'section-47'. Schedules cannot be fetched yet."
          ),
        max_chars: z
          .number()
          .int()
          .gte(500)
          .lte(200000)
          .default(10000)
          .describe(
            "Upper bound on how many characters of section content come back. The default of 10,000 (about 2,500 tokens) is enough for nearly every section; only push it to 50,000 or beyond for the sprawling definition sections you find in Finance Acts. The response's content_truncated flag tells you whether anything was trimmed."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Legislation Section"),
    },
    async (args) => {
      const { type, year, number, max_chars } = args;
      const section = normaliseSectionId(args.section);
      const url = `${LEGISLATION_BASE}/${type}/${year}/${number}/section/${section}/data.xml`;
      const attempted = `legislation_get_section(type=${reprStr(type)}, year=${year}, number=${number}, section=${reprStr(section)})`;
      try {
        const f = assertOk(await deps.legislationGet(url, { cacheTtl: TTL.DAY }));
        return jsonResult(parseClmlSection(f.text, section, max_chars));
      } catch (err) {
        if (err instanceof LegislationUpstreamError) {
          try {
            const htmlUrl = `${LEGISLATION_BASE}/${type}/${year}/${number}/section/${section}`;
            const htmlResp = assertOk(await deps.legislationGetHtml(htmlUrl, { cacheTtl: TTL.DAY }));
            return jsonResult(parseHtmlSection(htmlResp.text, section, max_chars, err.message));
          } catch (innerErr) {
            return toolErrorFromException(innerErr, attempted);
          }
        }
        return toolErrorFromException(err, attempted);
      }
    }
  );

  server.registerTool(
    "legislation_get_toc",
    {
      title: "Get Legislation Table of Contents",
      description: GET_TOC_DESC,
      inputSchema: {
        type: z
          .string()
          .min(2)
          .max(10)
          .describe(
            "The type code for the legislation: 'ukpga' (Acts), 'uksi' (SIs), 'asp' (Scottish Acts), 'nia' (NI Acts). Take this straight from a legislation_search result."
          ),
        year: z.number().int().gte(1800).lte(2100).describe("The year it was enacted"),
        number: z.number().int().gte(1).describe("The chapter number (Acts) or SI number"),
        offset: z
          .number()
          .int()
          .gte(0)
          .default(0)
          .describe(
            "How many entries to skip over in the flattened TOC. Combine it with limit to page through enormous statutes such as the Companies Act 2006 (over 1300 entries)."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(1000)
          .default(200)
          .describe(
            "How many entries this one call returns (defaults to 200, up to 1000). Only increase it when you genuinely need a bigger slice at once. The has_more and total_items fields tell you whether more pages are waiting."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Legislation Table of Contents"),
    },
    async (args) => {
      const { type, year, number, offset, limit } = args;
      const url = `${LEGISLATION_BASE}/${type}/${year}/${number}/data.xml`;
      const attempted = `legislation_get_toc(type=${reprStr(type)}, year=${year}, number=${number})`;
      try {
        const f = assertOk(await deps.legislationGet(url, { cacheTtl: TTL.DAY }));
        const allItems = parseTocXml(f.text);
        const totalItems = allItems.length;
        const page = allItems.slice(offset, offset + limit);
        const toc: LegislationTOC = {
          type,
          year,
          number,
          offset,
          limit,
          returned: page.length,
          total_items: totalItems,
          has_more: offset + page.length < totalItems,
          items: page,
        };
        return jsonResult(toc);
      } catch (err) {
        return toolErrorFromException(err, attempted);
      }
    }
  );
}
