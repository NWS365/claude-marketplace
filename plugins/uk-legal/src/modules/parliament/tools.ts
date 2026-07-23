/**
 * Registers the parliament module's tools.
 *
 * Exposes nine parliament_* tools wrapping the public Parliament web APIs:
 *   hansard-api.parliament.uk, members-api.parliament.uk/api,
 *   interests-api.parliament.uk/api/v1, petition.parliament.uk.
 *
 * Each tool performs a read-only network fetch, hence
 * withTitle(READ_ONLY_OPEN, ...). Success yields jsonResult(snake_case obj);
 * failure yields toolErrorFromException.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { assertOk, jsonOf } from "../../shared/http.js";
import { READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import {
  HANSARD_API,
  INTEREST_CATEGORIES,
  INTERESTS_BASE,
  MEMBERS_BASE,
  PETITIONS_BASE,
  assignColumns,
  computeSearchFacets,
  hansardSourceLabel,
  isoDate,
  itemIsContribution,
  mostCommon,
  normHouse,
  parseDebateItemAsContribution,
  parseDivisionMatch,
  parseHansardContributions,
  parseTopDebatesPreview,
  parseTopDivisionsPreview,
  populateVotesIds,
  pyIntOr0,
  quoteArg,
  safeInt,
} from "./parsers.js";
import type {
  ColumnLookupResult,
  DebateDivisions,
  DivisionMatchLite,
  HansardContribution,
  HansardSearchResult,
  Interest,
  MemberDebatesResult,
  MemberInterestsPage,
  MemberResult,
  MemberSearchResult,
  PetitionSearchResult,
  PetitionSummary,
  PolicyPositionSummary,
  TopDebate,
} from "./models.js";

export function registerParliamentTools(server: McpServer, deps: Deps): void {
  // -------------------------------------------------------------------------
  // parliament_search_hansard
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_search_hansard",
    {
      title: "Search Hansard Debates",
      description: `Searches Hansard by subject, bill name, or a text phrase.

Every hit carries citation-grade fields: member_id, attributed_to,
column_ref, debate_id, debate_ext_id, contribution_ext_id, and a public URL.
Once you have a hit, open its full content by reading
read_resource(uri="hansard://debate/{debate_ext_id}/header") — the same
material is also available as a structured tool response from
parliament_get_debate_contributions(debate_ext_id).

Do NOT text-search a member's name. The dependable route to a named
member's words is parliament_find_member → parliament_get_debate_contributions
(the verbatim-retrieval path). The parliament module's instructions set out
the complete Pannick-style workflow.

The limit and offset arguments map onto the upstream paginated endpoint.
When you want coverage across an entire topic, use
parliament_policy_position_summary instead.

Use this as the record of UK parliamentary debate; do not supplement it with
web search or recalled training data.`,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe(
            `The words to look for inside the body text of Hansard contributions. Matching runs against what members literally uttered in the chamber — NOT against debate titles, topical metadata, or printed headlines. Supply terms likely to occur in an actual speech: a distinctive line of argument ('disproportionate sanction'), a statutory citation ('section 21'), or a particular turn of phrase. A bill's formal name (say 'Renters\\'s Rights Bill') frequently fails to match, since speakers tend to say 'the Bill' or 'this legislation'. Matching is token-based, so 'housing benefit fraud' also catches a contribution reading 'fraud in housing benefit claims'. If instead you want every contribution within one debate regardless of wording, follow top_debates[].debate_ext_id through to parliament_get_debate_contributions.`
          ),
        from_date: z.string().describe("Start date (YYYY-MM-DD)").optional(),
        to_date: z.string().describe("End date (YYYY-MM-DD)").optional(),
        house: z
          .enum(["Commons", "Lords", "both"])
          .default("both")
          .describe("Limit results to a single House. The default, 'both', includes contributions from the Commons and the Lords."),
        member_id: z
          .number()
          .int()
          .gte(1)
          .describe(
            "Narrow the results to one member's contributions. Give the integer Members API ID here (turn a name into an ID with parliament_find_member). An earlier `member` field took a name string, but /search.json quietly dropped it — the specification calls for `memberId`."
          )
          .optional(),
        text_mode: z
          .enum(["preview", "full"])
          .default("preview")
          .describe(
            "Pick 'preview' for the upstream snippet of roughly 250 characters — quick and light on context. Pick 'full' for ContributionTextFull, which is still limited to 3000 characters. To obtain the entire contribution with no cap, read the resource hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}."
          ),
        contribution_type: z
          .enum(["Spoken", "Written", "Corrections"])
          .default("Spoken")
          .describe(
            "Selects which Hansard section is paginated. 'Spoken' covers chamber and Westminster Hall debates — the default, and normally what a lawyer means. 'Written' covers written answers and statements. 'Corrections' covers published corrections to the record. The corpus envelope (total_debates, total_divisions, and so on) does not depend on this setting and is filled in regardless."
          ),
        offset: z
          .number()
          .int()
          .gte(0)
          .lte(5000)
          .default(0)
          .describe(
            "How many contributions to bypass before the returned page begins. Defaults to 0. To page onward, call again with offset raised by the number just returned; has_more indicates whether further results exist."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(100)
          .default(20)
          .describe(
            "Upper bound on contributions per call, from 1 to 100. Defaults to 20. Use offset to walk through further pages; the full corpus size sits in total_corpus on the response."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search Hansard Debates"),
    },
    async (args) => {
      const { query, from_date, to_date, house, member_id, text_mode, contribution_type, offset, limit } = args;
      try {
        const params = new URLSearchParams();
        params.set("searchTerm", query);
        params.set("take", String(limit));
        params.set("skip", String(offset));
        if (from_date) params.set("startDate", from_date);
        if (to_date) params.set("endDate", to_date);
        if (house !== "both") params.set("house", house);
        if (member_id) params.set("memberId", String(member_id));

        // Envelope request: the same filters, minus take/skip.
        const envParams = new URLSearchParams(params);
        envParams.delete("take");
        envParams.delete("skip");

        const [contribsF, envelopeF] = await Promise.all([
          deps.jsonGet(`${HANSARD_API}/search/contributions/${contribution_type}.json?${params.toString()}`, {
            cacheTtl: TTL.HOUR,
          }),
          deps.jsonGet(`${HANSARD_API}/search.json?${envParams.toString()}`, { cacheTtl: TTL.HOUR }),
        ]);
        assertOk(contribsF);
        assertOk(envelopeF);
        const contribsPayload = jsonOf<any>(contribsF);
        const payload = jsonOf<any>(envelopeF);

        const contributions = parseHansardContributions(
          { Contributions: contribsPayload.Results ?? [] },
          text_mode
        );
        const totalCorpus = (contribsPayload.TotalResultCount || payload.TotalContributions) ?? null;
        const facets = computeSearchFacets(contributions);
        const result: HansardSearchResult = {
          query,
          from_date: from_date ?? null,
          to_date: to_date ?? null,
          house,
          member_id: member_id ?? null,
          text_mode,
          offset,
          limit,
          total: contributions.length,
          total_corpus: totalCorpus,
          total_debates: payload.TotalDebates ?? null,
          total_divisions: payload.TotalDivisions ?? null,
          total_written_statements: payload.TotalWrittenStatements ?? null,
          total_written_answers: payload.TotalWrittenAnswers ?? null,
          total_corrections: payload.TotalCorrections ?? null,
          total_petitions: payload.TotalPetitions ?? null,
          total_committees: payload.TotalCommittees ?? null,
          total_members: payload.TotalMembers ?? null,
          top_debates: parseTopDebatesPreview(payload),
          top_divisions: parseTopDivisionsPreview(payload),
          party_breakdown: facets.party,
          house_breakdown: facets.house,
          date_range: facets.dateRange,
          has_more: contributions.length === limit,
          contributions,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `parliament_search_hansard(query=${quoteArg(query)})`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_policy_position_summary
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_policy_position_summary",
    {
      title: "Hansard Policy Position Summary (deterministic facets)",
      description: `Rolls up debate-level corpus signals for a topic — the by_house, by_year, and by_section breakdowns — without reading every contribution.

It rolls up debate-level signals for a topic as plain tallies: no model in
the loop, no editorial characterisation. It pages through
/search/Debates.json (bounded by max_debates_scanned), then builds
by_house, by_section, by_year, by_month, and top_debates out of the debate
metadata. It also reads the corpus-wide envelope figures
(total_contributions, total_written_statements, total_divisions, and the
rest) from /search.json to give cross-section scope.

Having called it, choose a debate from top_debates and feed its debate_ext_id
to parliament_get_debate_contributions to see who said what.

A word on member-level facets: at the corpus level Hansard's search API
surfaces debate metadata, not the member identifiers attached to individual
contributions. by_party and top_contributors are consequently left out of
this deterministic summary. To learn who spoke within a given debate, read
hansard://debate/{debate_ext_id}/header for an ordered index of
contributions, or call parliament_member_debates for a single named member.

Use this for corpus-level signals across UK Hansard.`,
      inputSchema: {
        topic: z
          .string()
          .min(2)
          .max(200)
          .describe(
            `The phrase whose appearances in Hansard contribution bodies drive the facet aggregation. The meaning matches parliament_search_hansard.query: terms found in members' real speeches, not the names of bills or topical metadata. The aggregator works over the top_debates[] returned by /search/Debates.json, and those debates match when the phrase turns up in a title or in contribution text — so a bill's name (for instance 'Renters\\' Rights Bill') tends to work for THIS tool even though it would not for member-level text search, because debate-level matching draws on metadata as well as body text.`
          ),
        from_date: z.string().describe("Start date (YYYY-MM-DD)").optional(),
        to_date: z.string().describe("End date (YYYY-MM-DD)").optional(),
        house: z
          .enum(["Commons", "Lords", "both"])
          .default("both")
          .describe("Confine results to one House. Defaults to 'both'."),
        max_debates_scanned: z
          .number()
          .int()
          .gte(50)
          .lte(2000)
          .default(200)
          .describe(
            "Ceiling on how many debates are drawn from /search/Debates.json when building the facets. The default of 200 costs at most 4 upstream calls (50 per page). Push it to 2000 (up to 40 calls) for a thorough sweep of a heavily debated topic. Hansard's rate limit is 1000 req/5min."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Hansard Policy Position Summary (deterministic facets)"),
    },
    async (args) => {
      const { topic, from_date, to_date, house, max_debates_scanned } = args;
      try {
        const envParams = new URLSearchParams();
        envParams.set("searchTerm", topic);
        if (from_date) envParams.set("startDate", from_date);
        if (to_date) envParams.set("endDate", to_date);
        if (house !== "both") envParams.set("house", house);

        const envF = assertOk(await deps.jsonGet(`${HANSARD_API}/search.json?${envParams.toString()}`, { cacheTtl: TTL.HOUR }));
        const envelope = jsonOf<any>(envF);

        const allDebates: any[] = [];
        const pageSize = 50;
        let skip = 0;
        const target = max_debates_scanned;
        while (skip < target) {
          const take = Math.min(pageSize, target - skip);
          const qp = new URLSearchParams(envParams);
          qp.set("take", String(take));
          qp.set("skip", String(skip));
          let data: any;
          try {
            const f = assertOk(await deps.jsonGet(`${HANSARD_API}/search/Debates.json?${qp.toString()}`, { cacheTtl: TTL.HOUR }));
            data = jsonOf<any>(f);
          } catch (e) {
            if (allDebates.length === 0) throw e;
            break;
          }
          const results: any[] = data.Results ?? [];
          if (results.length === 0) break;
          allDebates.push(...results);
          if (results.length < take) break;
          skip += take;
        }

        const houseCounter = new Map<string, number>();
        const sectionCounter = new Map<string, number>();
        const yearCounter = new Map<number, number>();
        const ymCounter = new Map<string, number>();
        const topDebateModels: TopDebate[] = [];

        for (const d of allDebates) {
          let sittingDate: string;
          try {
            sittingDate = isoDate(d.SittingDate);
          } catch {
            continue;
          }
          const houseVal = normHouse(d.House);
          const section: string = d.DebateSection || houseVal;
          houseCounter.set(houseVal, (houseCounter.get(houseVal) ?? 0) + 1);
          sectionCounter.set(section, (sectionCounter.get(section) ?? 0) + 1);
          const year = parseInt(sittingDate.slice(0, 4), 10);
          yearCounter.set(year, (yearCounter.get(year) ?? 0) + 1);
          const ym = sittingDate.slice(0, 7);
          ymCounter.set(ym, (ymCounter.get(ym) ?? 0) + 1);
          const extId: string = d.DebateSectionExtId || "";
          if (extId && topDebateModels.length < 20) {
            topDebateModels.push({
              debate_id: 0,
              debate_ext_id: extId,
              debate_title: (d.Title || section || "Unknown").trim(),
              date: sittingDate,
              house: houseVal,
              relevance_rank: pyIntOr0(d.Rank),
              contribution_count: null,
              source_code: null,
              source: null,
            });
          }
        }

        const recent12 = [...ymCounter.entries()]
          .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
          .slice(0, 12);
        const byYear = [...yearCounter.entries()].sort((a, b) => b[0] - a[0]);

        const result: PolicyPositionSummary = {
          topic,
          from_date: from_date ?? null,
          to_date: to_date ?? null,
          house,
          total_contributions: pyIntOr0(envelope.TotalContributions),
          total_debates: pyIntOr0(envelope.TotalDebates),
          total_written_statements: pyIntOr0(envelope.TotalWrittenStatements),
          total_written_answers: pyIntOr0(envelope.TotalWrittenAnswers),
          total_divisions: pyIntOr0(envelope.TotalDivisions),
          debates_scanned: allDebates.length,
          by_party: [],
          by_house: mostCommon(houseCounter).map(([key, count]) => ({ key, count })),
          by_section: mostCommon(sectionCounter).map(([key, count]) => ({ key, count })),
          by_year: byYear.map(([k, count]) => ({ key: String(k), count })),
          by_month_recent_12: recent12.map(([key, count]) => ({ key, count })),
          top_contributors: [],
          top_debates: topDebateModels,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `parliament_policy_position_summary(topic=${quoteArg(topic)})`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_find_member
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_find_member",
    {
      title: "Find Member of Parliament",
      description: `Resolves a member's name to the integer member_id.

It hands back every member whose name matches the query, each carrying the
integer \`id\`, party, constituency, house, and whether they currently sit.
This resolves ambiguous names (asking for "Lord Smith", for instance, yields
several peers).

Run it ahead of any tool keyed on member_id — including
parliament_get_debate_contributions, parliament_member_debates, and
parliament_member_interests. Resolve the name to an ID first, then filter by
that ID. Skip this step and text-search the name instead and you get
unrelated matches (the Pannick case in parliament_search_hansard's
anti-bypass note shows why).`,
      inputSchema: {
        name: z
          .string()
          .min(2)
          .max(200)
          .describe("A full or partial name, for example 'Starmer' or 'Baroness Hale'"),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Find Member of Parliament"),
    },
    async (args) => {
      const { name } = args;
      try {
        const params = new URLSearchParams({ Name: name });
        const f = assertOk(await deps.jsonGet(`${MEMBERS_BASE}/Members/Search?${params.toString()}`, { cacheTtl: TTL.HOUR }));
        const data = jsonOf<any>(f);
        const members: MemberResult[] = [];
        for (const item of data.items ?? []) {
          const v = item.value ?? item;
          const houseId = v.latestHouseMembership?.house ?? 1;
          members.push({
            id: v.id ?? 0,
            name: v.nameDisplayAs ?? "Unknown",
            party: v.latestParty?.name ?? "Unknown",
            constituency: v.latestHouseMembership?.membershipFrom ?? null,
            house: houseId === 1 ? "Commons" : "Lords",
            is_current: v.latestHouseMembership?.membershipStatus?.statusIsActive ?? false,
          });
        }
        const result: MemberSearchResult = { query: name, total: members.length, members };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `parliament_find_member(name=${quoteArg(name)})`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_member_debates
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_member_debates",
    {
      title: "Get Member Debates",
      description: `Given a member_id, returns the contributions in which that member actually used a given topic phrase (a search over the text body).

First call parliament_find_member(name) to get the integer member_id.

This searches the text body: it returns contributions whose TEXT contains
your topic phrase. Any member who spoke in a debate without uttering your
phrase word-for-word drops out. To pull every contribution a member made in
a known debate no matter the wording, use
parliament_get_debate_contributions(debate_ext_id, member_id=...) instead.

The text field of each contribution is truncated at 3000 characters.`,
      inputSchema: {
        member_id: z
          .number()
          .int()
          .gte(1)
          .describe("The integer ID from the Parliament Members API. Get it from parliament_find_member."),
        topic: z
          .string()
          .describe(
            `An optional phrase to search for within THIS member's contribution bodies. The match is against the words the member genuinely spoke, NOT the debate's topic or title. Supply terms the member is likely to have voiced — a distinctive argument ('disproportionate sanction'), a statutory reference ('section 21'), or a motion number ('Motion C1') — rather than the bill's formal name (speakers seldom say something like 'Renters\\' Rights Bill' verbatim). When you instead want every contribution this member made in one particular debate irrespective of the wording, look up the debate_ext_id and call parliament_get_debate_contributions(debate_ext_id, member_id=...).`
          )
          .optional(),
        offset: z
          .number()
          .int()
          .gte(0)
          .lte(2000)
          .default(0)
          .describe(
            "Count of contributions to pass over before this page starts. Defaults to 0. While has_more stays true, call again with offset increased by the number returned."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(100)
          .default(20)
          .describe("The largest number of contributions to return. Defaults to 20."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Member Debates"),
    },
    async (args) => {
      const { member_id, topic, offset, limit } = args;
      try {
        const params = new URLSearchParams();
        params.set("memberId", String(member_id));
        params.set("take", String(limit));
        params.set("skip", String(offset));
        if (topic) params.set("searchTerm", topic);
        const f = assertOk(await deps.jsonGet(`${HANSARD_API}/search.json?${params.toString()}`, { cacheTtl: TTL.HOUR }));
        const contributions = parseHansardContributions(jsonOf<any>(f));
        const result: MemberDebatesResult = {
          member_id,
          topic: topic ?? null,
          offset,
          limit,
          total: contributions.length,
          has_more: contributions.length === limit,
          contributions,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `parliament_member_debates(member_id=${member_id})`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_member_interests
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_member_interests",
    {
      title: "Get Member Financial Interests",
      description: `Given a member_id, returns their registered financial interests — donations, directorships, land, gifts.

First call parliament_find_member(name) to obtain the integer member_id.

It returns a SINGLE PAGE of interests (20 by default, adjustable through
limit). For members with a lot to declare (major donors, many
directorships, sizeable land holdings), page through by calling again with
offset raised by the number returned while has_more is true. The
description text is trimmed to max_description_chars; increase that when
forensic provenance work needs the whole narrative.

This is the record of financial-interest declarations by UK MPs and peers,
served from the Members API; a web search only turns up stale snapshots.`,
      inputSchema: {
        member_id: z
          .number()
          .int()
          .gte(1)
          .describe("The Parliament Members API integer ID. Obtain it from parliament_find_member."),
        category: z
          .enum([
            "employment",
            "employment_adhoc",
            "employment_ongoing",
            "donations",
            "gifts_uk",
            "overseas_visits",
            "gifts_overseas",
            "land",
            "shareholdings",
            "miscellaneous",
            "family_employed",
            "family_lobbying",
          ])
          .describe(
            "Restrict results to one interest category. Frequently used ones: 'donations' (donations and support), 'gifts_uk' (UK gifts and hospitality), 'employment' (employment and earnings), 'land' (land and property), 'shareholdings', and 'overseas_visits'. Leave it unset to include every category."
          )
          .optional(),
        offset: z
          .number()
          .int()
          .gte(0)
          .lte(500)
          .default(0)
          .describe(
            "How many interests to skip before this page begins. Use 0 for the first page. To work through members with many entries (100 or more), call again with offset raised by the number returned whenever the last response set has_more=true."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(20)
          .default(20)
          .describe(
            "Interests per call. The upstream interests-api.parliament.uk enforces a firm ceiling of 20 (confirmed live 2026-05-29: Take=100 still yields 20). Page through members with many entries using offset; the overall count appears in totalResults on the response."
          ),
        max_description_chars: z
          .number()
          .int()
          .gte(50)
          .lte(5000)
          .default(500)
          .describe(
            "Limit applied to each entry's free-text description. The 500-character default keeps context from ballooning on members with long donation or directorship write-ups. Only push it to 2000 or more for forensic provenance work."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Member Financial Interests"),
    },
    async (args) => {
      const { member_id, category, offset, limit, max_description_chars } = args;
      try {
        const params = new URLSearchParams();
        params.set("MemberId", String(member_id));
        params.set("Skip", String(offset));
        params.set("Take", String(limit));
        if (category) params.set("CategoryId", String(INTEREST_CATEGORIES[category]));
        const f = assertOk(await deps.jsonGet(`${INTERESTS_BASE}/Interests?${params.toString()}`, { cacheTtl: TTL.HOUR }));
        const data = jsonOf<any>(f);
        const items: any[] = data.items ?? data.results ?? [];

        const interests: Interest[] = [];
        for (const item of items) {
          const created = item.registrationDate || item.publishedDate;
          const categoryObj = item.category ?? {};
          const categoryName =
            categoryObj && typeof categoryObj === "object" && !Array.isArray(categoryObj)
              ? categoryObj.name ?? "Unknown"
              : String(categoryObj);
          let desc: string = item.summary || "";
          if (desc.length > max_description_chars) {
            desc = desc.slice(0, max_description_chars) + " …[truncated]";
          }
          interests.push({
            category: categoryName,
            description: desc,
            date_created: created ? String(created).slice(0, 10) : null,
            date_amended: null,
          });
        }

        const result: MemberInterestsPage = {
          member_id,
          category: category ?? null,
          offset,
          limit,
          returned: interests.length,
          has_more: items.length === limit,
          interests,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `parliament_member_interests(member_id=${member_id})`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_search_petitions
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_search_petitions",
    {
      title: "Search UK Parliament Petitions",
      description: `Searches UK Parliament petitions by keyword or subject.

It returns each petition's title, state, and signature count, along with the
dates of any government response or scheduled debate. Filter on state (open,
closed, debated, and so on) to focus on live or past petitions.

This is the source for UK Parliament petitions (petition.parliament.uk).`,
      inputSchema: {
        query: z
          .string()
          .min(2)
          .max(300)
          .describe("The term to match against petition titles, for example 'ban trophy hunting' or 'NHS funding'."),
        state: z
          .enum(["open", "closed", "all"])
          .default("all")
          .describe("Narrow results by the petition's state."),
        offset: z
          .number()
          .int()
          .gte(0)
          .lte(2000)
          .default(0)
          .describe(
            "How many petitions to skip ahead of this page. Defaults to 0. Re-issue the call with offset increased by the number returned as long as has_more is true."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(100)
          .default(20)
          .describe("The maximum count of petitions to return. Defaults to 20."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search UK Parliament Petitions"),
    },
    async (args) => {
      const { query, state, offset, limit } = args;
      try {
        // petition.parliament.uk expects a 1-indexed `page` plus a `count` (page-size) param.
        const pageNum = Math.floor(offset / limit) + 1;
        const params = new URLSearchParams();
        params.set("q", query);
        params.set("count", String(limit));
        params.set("page", String(pageNum));
        if (state !== "all") params.set("state", state);
        const f = assertOk(await deps.jsonGet(`${PETITIONS_BASE}/petitions.json?${params.toString()}`, { cacheTtl: TTL.HOUR }));
        const data = jsonOf<any>(f);

        const petitions: PetitionSummary[] = [];
        for (const item of data.data ?? []) {
          const attrs = item.attributes ?? item;
          const petitionId = item.id ?? 0;
          const created = attrs.created_at;
          const govResp = attrs.government_response_at;
          const debate = attrs.scheduled_debate_date;
          petitions.push({
            id: petitionId ? safeInt(petitionId, 0) : 0,
            action: attrs.action ?? "Unknown",
            state: attrs.state ?? "unknown",
            signature_count: attrs.signature_count ?? 0,
            created_at: created ? String(created).slice(0, 10) : null,
            government_response_at: govResp ? String(govResp).slice(0, 10) : null,
            debate_date: debate ? String(debate).slice(0, 10) : null,
            url: `https://petition.parliament.uk/petitions/${petitionId}`,
          });
        }
        const result: PetitionSearchResult = {
          query,
          state,
          offset,
          limit,
          total: petitions.length,
          has_more: petitions.length === limit,
          petitions,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(err, `parliament_search_petitions(query=${quoteArg(query)})`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_get_debate_divisions
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_get_debate_divisions",
    {
      title: "Get Divisions Held In A Debate",
      description: `Given a debate_ext_id, returns the divisions — the formal votes — taken during that debate.

Most debates hold no divisions at all: Business of the House sittings,
statements, urgent questions, and any debate settled without a vote. A
non-empty list tends to appear around bill stages, motions, and contested
amendments. An empty list is a truthful answer, not a malfunction.

Every division returned comes with TWO identifiers:
  - \`id\` — the Hansard-side reference, handy for cross-referencing in Hansard.
  - \`votes_id\` — the Lords/Commons Votes API ID, matched up by date and number.
    Once you have it, hand \`votes_id\` to votes_get_division as \`division_id\`
    to obtain the complete member-by-member voting record.

The two upstreams number their divisions independently (a Hansard Number=3
may be Votes-API divisionId=3392). The match-up runs a single time for each
(date, house) group — usually one extra HTTP per debate. \`votes_id\` is None
whenever no match is found.`,
      inputSchema: {
        debate_ext_id: z
          .string()
          .min(8)
          .describe(
            "The debate GUID (DebateSectionExtId). Carry it over from parliament_search_hansard's contribution.debate_ext_id or top_debates[].debate_ext_id, or from parliament_policy_position_summary's top_debates[].debate_ext_id."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Divisions Held In A Debate"),
    },
    async (args) => {
      const { debate_ext_id } = args;
      try {
        const f = assertOk(await deps.jsonGet(`${HANSARD_API}/debates/divisions/${debate_ext_id}.json`, { cacheTtl: TTL.HOUR }));
        let items: any = jsonOf<any>(f);
        if (!Array.isArray(items)) items = [];
        const divisions: DivisionMatchLite[] = [];
        for (const item of items) {
          const parsed = item && typeof item === "object" ? parseDivisionMatch(item) : null;
          if (parsed !== null) divisions.push(parsed);
        }
        // Match the Hansard-side `id` onto the Lords/Commons Votes API `votes_id`.
        await populateVotesIds(deps, divisions);

        const result: DebateDivisions = { debate_ext_id, divisions };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(
          err,
          `parliament_get_debate_divisions(debate_ext_id=${quoteArg(debate_ext_id)})`
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_get_debate_contributions
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_get_debate_contributions",
    {
      title: "Get Contributions In A Debate",
      description: `Given a debate_ext_id, returns the contributions verbatim, optionally limited to one member.

This is the reliable route for "everything a member said in this debate" no
matter the wording. The text-search tools (parliament_member_debates,
parliament_search_hansard) filter on contribution TEXT and therefore lose
members who spoke without using your exact phrase. This tool filters on
MemberId within the debate's Items list, so wording is irrelevant.

A common sequence: parliament_find_member(name) gives a member_id, then
parliament_search_hansard or parliament_lookup_by_column gives a
debate_ext_id, and then you call this. The parliament module's instructions
lay out the full composition pattern.

Leave member_id unset and it returns every contribution (roughly 100-200
for a long debate).

If the wire comes back with no contributions for a member you expected to
have spoken, report that empty result plainly — do NOT fabricate quotes
from training data. This is the definitive source for member contributions.`,
      inputSchema: {
        debate_ext_id: z
          .string()
          .min(8)
          .describe(
            "The debate GUID (DebateSectionExtId). Bring it across from parliament_search_hansard's top_debates[].debate_ext_id, parliament_lookup_by_column's matches[].debate_ext_id, or any other tool that yields a debate identifier."
          ),
        member_id: z
          .number()
          .int()
          .gte(1)
          .describe(
            "An optional integer Members API ID. Supply it and only that member's contributions in the debate come back, whatever words they chose. Resolve it through parliament_find_member. Omit it and the whole debate's contributions are returned (a typical debate runs 100-200 items)."
          )
          .optional(),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Contributions In A Debate"),
    },
    async (args) => {
      const { debate_ext_id, member_id } = args;
      try {
        const f = assertOk(await deps.jsonGet(`${HANSARD_API}/debates/Debate/${debate_ext_id}.json`, { cacheTtl: TTL.HOUR }));
        const payload: any = f.text ? jsonOf<any>(f) : {};
        const overview = payload.Overview ?? {};
        const items: any[] = payload.Items ?? [];

        // Column carry-forward is derived over the entire Items list.
        const columnAssignment = assignColumns(items);

        const contributions: HansardContribution[] = [];
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          if (!item || typeof item !== "object") continue;
          if (!itemIsContribution(item)) continue;
          if (member_id !== undefined && item.MemberId !== member_id) continue;
          const parsed = parseDebateItemAsContribution(item, overview, columnAssignment, idx);
          if (parsed !== null) contributions.push(parsed);
        }

        const result: MemberDebatesResult = {
          member_id: member_id !== undefined ? member_id : 0,
          topic: null,
          offset: 0,
          limit: contributions.length,
          total: contributions.length,
          has_more: false,
          contributions,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(
          err,
          `parliament_get_debate_contributions(debate_ext_id=${quoteArg(debate_ext_id)})`
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // parliament_lookup_by_column
  // -------------------------------------------------------------------------
  server.registerTool(
    "parliament_lookup_by_column",
    {
      title: "Resolve A Hansard Column Citation",
      description: `Resolves an OSCOLA-style Hansard citation (column, volume, and house) to the debate it points to.

A sample input is 'HL Deb 14 Oct 2025, vol 849, col 200'. Once you have a
result, read the contribution at that column via
read_resource(uri="hansard://debate/{debate_ext_id}/header"), or get the
same list as a structured tool response from
parliament_get_debate_contributions(debate_ext_id).

Every match includes:
  - \`contribution_count\` — the actual number of contributions from the
    debate's Items
  - \`source\` / \`source_code\` — how final the citation is (1=Rolling,
    2=Daily, 3=BoundVolume, 4=Historic). Resolution does NOT depend on the
    publication state.

An empty \`matches\` usually points to a wrong volume_number (opposing
counsel sometimes cite the running volume rather than the bound one) or to a
column that lives in a Written Statement (pass the 'W'-suffixed column
unchanged). It does NOT imply the citation was invented — report the failure.

This is the definitive source for resolving OSCOLA Hansard columns.`,
      inputSchema: {
        column_number: z
          .string()
          .min(1)
          .max(20)
          .describe(
            "The Hansard column number taken from an OSCOLA footnote — '200', say, in 'HL Deb 14 Oct 2025, vol 849, col 200'. It is a string rather than an integer so that suffixed columns such as '1162W' for written answers are accepted."
          ),
        volume_number: z
          .number()
          .int()
          .gt(0)
          .describe(
            "The Hansard volume number — the 'vol 849' portion of an OSCOLA citation. It is mandatory: the endpoint resolves a citation only when the volume is supplied, and the sitting date will NOT stand in for it (verified live 2026-05-29)."
          ),
        house: z
          .enum(["Commons", "Lords", "both"])
          .default("both")
          .describe("Limit to a single House. The default 'both' covers both Houses."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Resolve A Hansard Column Citation"),
    },
    async (args) => {
      const { column_number, volume_number, house } = args;
      try {
        const params = new URLSearchParams();
        params.set("columnNumber", column_number);
        params.set("volumeNumber", String(volume_number));
        if (house !== "both") params.set("house", house);

        const f = assertOk(await deps.jsonGet(`${HANSARD_API}/search/debatebycolumn.json?${params.toString()}`, { cacheTtl: TTL.HOUR }));
        const payload: any = f.text ? jsonOf<any>(f) : {};
        const results: any[] = payload.Results ?? [];
        const matches: TopDebate[] = [];
        for (const item of results) {
          try {
            const extId: string = item.DebateSectionExtId || "";
            if (!extId) continue;
            const sittingDate = isoDate(item.SittingDate);
            const houseVal = normHouse(item.House);

            // Follow-up call: pull the debate's Items list to get the true count.
            let contributionCount: number | null = null;
            let sourceCode: number | null = null;
            let debateId = 0;
            try {
              const df = assertOk(await deps.jsonGet(`${HANSARD_API}/debates/Debate/${extId}.json`, { cacheTtl: TTL.HOUR }));
              const debatePayload: any = df.text ? jsonOf<any>(df) : {};
              const debateItems: any[] = debatePayload.Items ?? [];
              contributionCount = debateItems.reduce((acc: number, i: any) => acc + (itemIsContribution(i) ? 1 : 0), 0);
              const overview = debatePayload.Overview ?? {};
              sourceCode = overview.Source ?? null;
              debateId = safeInt(overview.Id, 0);
            } catch {
              // Keep count/source/id at their defaults instead of inventing values.
            }

            matches.push({
              debate_id: debateId,
              debate_ext_id: extId,
              debate_title: (item.Title || item.DebateSection || "Unknown").trim(),
              date: sittingDate,
              house: houseVal,
              relevance_rank: null,
              contribution_count: contributionCount,
              source_code: sourceCode,
              source: hansardSourceLabel(sourceCode),
            });
          } catch {
            continue;
          }
        }

        const result: ColumnLookupResult = {
          column_number,
          volume_number,
          house,
          total_results: safeInt(payload.TotalResultCount, matches.length),
          matches,
        };
        return jsonResult(result);
      } catch (err) {
        return toolErrorFromException(
          err,
          `parliament_lookup_by_column(column_number=${quoteArg(column_number)}, volume_number=${volume_number})`
        );
      }
    }
  );
}
