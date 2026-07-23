/**
 * Tool registrations for the votes module.
 *
 * Backed by two open, unauthenticated Parliament endpoints:
 *   - commonsvotes-api.parliament.uk — division data for the Commons
 *   - lordsvotes-api.parliament.uk   — division data for the Lords
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { assertOk, jsonOf } from "../../shared/http.js";
import { jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import type { DivisionDetail, DivisionSummary, DivisionsSearchResult } from "./models.js";
import {
  asDict,
  detailDate,
  detailTitle,
  detailUrl,
  firstOf,
  MAX_VOTERS_PER_SIDE,
  nullableBool,
  parseCommonsSummary,
  parseLordsSummary,
  parseVoters,
  searchUrl,
} from "./parsers.js";

/** Quote a scalar for the `attempted` error breadcrumb. */
function quoteArg(v: unknown): string {
  if (v === undefined || v === null) return "None";
  if (typeof v === "string") return `'${v}'`;
  return String(v);
}

const searchInputSchema = {
  query: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Keyword matched against division titles, such as 'Rwanda' or 'Online Safety Bill'. Leave blank to list the latest divisions.",
    ),
  house: z.enum(["Commons", "Lords"]).default("Commons").describe("The chamber to query."),
  from_date: z.string().optional().describe("Earliest date to include (YYYY-MM-DD)."),
  to_date: z.string().optional().describe("Latest date to include (YYYY-MM-DD)."),
  member_id: z
    .number()
    .int()
    .gte(1)
    .optional()
    .describe(
      "Restrict results to divisions in which this member cast a vote. Look up the member ID via parliament_find_member.",
    ),
  offset: z
    .number()
    .int()
    .gte(0)
    .lte(2000)
    .default(0)
    .describe(
      "How many divisions to skip ahead of this page. Defaults to 0. While has_more stays true, call again with offset set to offset plus the number just returned.",
    ),
  limit: z
    .number()
    .int()
    .gte(1)
    .lte(100)
    .default(25)
    .describe("Cap on divisions returned. Defaults to 25, the Commons API per-page ceiling."),
} as const;

const getInputSchema = {
  division_id: z.number().int().gte(1).describe("The division's ID, taken from votes_search_divisions output."),
  house: z
    .enum(["Commons", "Lords"])
    .default("Commons")
    .describe("The chamber in which this division took place."),
} as const;

const SEARCH_DESCRIPTION = `REACH FOR THIS TOOL to look up recorded Commons or Lords votes by subject, date range, or the member involved.

Each hit is a division summary carrying the title, date, tallies, and whether
it carried. Once you have one, feed its division_id together with house to
votes_get_division to retrieve the individual voter breakdown.

This is the definitive record of formal votes in the UK Parliament.`;

const GET_DESCRIPTION = `REACH FOR THIS TOOL once you hold a division_id and its house and need to see how every member voted.

To stay within response size limits each side lists at most 100 voters, but the
reported totals stay correct even when the lists are cut short. Feed it from
votes_search_divisions, or from parliament_get_debate_divisions, which maps
Hansard division references onto the votes-API division_ids.`;

export function registerVotesTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "votes_search_divisions",
    {
      title: "Search Parliamentary Divisions",
      description: SEARCH_DESCRIPTION,
      inputSchema: searchInputSchema,
      annotations: withTitle(READ_ONLY_OPEN, "Search Parliamentary Divisions"),
    },
    async (args) => {
      const { query, house, from_date, to_date, member_id, offset, limit } = args;
      try {
        const params = new URLSearchParams();
        params.append("queryParameters.take", String(limit));
        params.append("queryParameters.skip", String(offset));
        if (query) params.append("queryParameters.searchTerm", query);
        if (from_date) params.append("queryParameters.startDate", from_date);
        if (to_date) params.append("queryParameters.endDate", to_date);
        if (member_id) params.append("queryParameters.memberId", String(member_id));

        const url = `${searchUrl(house)}?${params.toString()}`;
        const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.DAY }));
        const data = jsonOf(f);

        const items: unknown[] = Array.isArray(data)
          ? data
          : (firstOf(asDict(data), ["results", "items"], []) as unknown[]);

        const divisions: DivisionSummary[] =
          house === "Lords"
            ? items.map((item) => parseLordsSummary(asDict(item)))
            : items.map((item) => parseCommonsSummary(asDict(item)));

        const result: DivisionsSearchResult = {
          query: query == null ? null : query.trim(),
          house,
          offset,
          limit,
          total: divisions.length,
          has_more: divisions.length === limit,
          divisions,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(
          err,
          `votes_search_divisions(query=${quoteArg(query)}, house=${quoteArg(house)})`,
        );
      }
    },
  );

  server.registerTool(
    "votes_get_division",
    {
      title: "Get Division Detail",
      description: GET_DESCRIPTION,
      inputSchema: getInputSchema,
      annotations: withTitle(READ_ONLY_OPEN, "Get Division Detail"),
    },
    async (args) => {
      const { division_id, house } = args;
      try {
        const url = detailUrl(house, division_id);
        const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.DAY }));
        const data = asDict(jsonOf(f));

        let title: string;
        let divDate: string;
        let ayeList: unknown[];
        let noeList: unknown[];
        let isGovWin: boolean | null;

        if (house === "Lords") {
          title = detailTitle(firstOf(data, ["title", "Title"], "Unknown"));
          divDate = detailDate(firstOf(data, ["date", "Date"], "1970-01-01"));
          ayeList = firstOf(data, ["contents", "Contents"], []) as unknown[];
          noeList = firstOf(data, ["notContents", "NotContents"], []) as unknown[];
          isGovWin = nullableBool(firstOf(data, ["isGovernmentWin", "IsGovernmentWin"], null));
        } else {
          title = detailTitle(firstOf(data, ["Title"], "Unknown"));
          divDate = detailDate(firstOf(data, ["Date"], "1970-01-01"));
          ayeList = firstOf(data, ["Ayes"], []) as unknown[];
          noeList = firstOf(data, ["Noes"], []) as unknown[];
          isGovWin = null;
        }

        const allAyes = parseVoters(Array.isArray(ayeList) ? ayeList : []);
        const allNoes = parseVoters(Array.isArray(noeList) ? noeList : []);

        const truncated =
          allAyes.length > MAX_VOTERS_PER_SIDE || allNoes.length > MAX_VOTERS_PER_SIDE;

        const result: DivisionDetail = {
          id: division_id,
          title,
          date: divDate,
          house,
          ayes_count: allAyes.length,
          noes_count: allNoes.length,
          passed: allAyes.length > allNoes.length,
          is_government_win: isGovWin,
          aye_voters: allAyes.slice(0, MAX_VOTERS_PER_SIDE),
          noe_voters: allNoes.slice(0, MAX_VOTERS_PER_SIDE),
          truncated,
          total_aye_voters: allAyes.length,
          total_noe_voters: allNoes.length,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(
          err,
          `votes_get_division(division_id=${division_id}, house=${quoteArg(house)})`,
        );
      }
    },
  );
}
