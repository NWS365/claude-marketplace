/**
 * Tool registrations for the committees module.
 *
 * Backing service (public, no credentials needed):
 *   - committees-api.parliament.uk — select committees, membership, evidence
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Deps } from "../../shared/deps.js";
import { assertOk, jsonOf } from "../../shared/http.js";
import { jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import type {
  CommitteeDetail,
  CommitteeEvidencePage,
  CommitteeMember,
  CommitteeSearchResult,
  CommitteeSummary,
  EvidenceItem,
} from "./models.js";
import { extractItems, isObj, mapMember, mapOral, mapWritten, parseHouse, optStr, reqStr } from "./parsers.js";

const COMMITTEES_BASE = "https://committees-api.parliament.uk/api";

const HOUSE_MAP: Record<"Commons" | "Lords" | "Joint", number> = { Commons: 1, Lords: 2, Joint: 0 };

/** Propagates the per-branch `attempted` label when an evidence request fails. */
class EvidenceFetchError extends Error {
  constructor(
    public readonly underlying: unknown,
    public readonly attempted: string,
  ) {
    super("evidence fetch failed");
    this.name = "EvidenceFetchError";
  }
}

export function registerCommitteesTools(server: McpServer, deps: Deps): void {
  // --- committees_search_committees ------------------------------------------
  server.registerTool(
    "committees_search_committees",
    {
      title: "Search Parliamentary Committees",
      description: `Reach for this tool to look up or enumerate UK parliamentary select committees, filtering by name, chamber, or whether they are still sitting.

Each result is a committee summary (ID, name, house, active flag). Once
you hold a committee_id, feed it to committees_get_committee to see who
currently sits on the committee, or to committees_search_evidence to pull
the oral and written evidence submitted to it.`,
      inputSchema: {
        query: z
          .string()
          .max(300)
          .describe(
            "Text to match against committee names, such as 'defence' or 'treasury'. Matching is performed locally on the returned names. Leave unset to enumerate every committee.",
          )
          .optional(),
        house: z.enum(["Commons", "Lords", "Joint"]).describe("Restrict results to a single chamber.").optional(),
        active_only: z.boolean().describe("When set, limit results to committees that are currently sitting.").default(true),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(500)
          .describe(
            "Upper bound on how many committees come back. The default of 100 is more than enough for every UK select committee sitting today; raise it only when reaching back through historical records.",
          )
          .default(100),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search Parliamentary Committees"),
    },
    async (args): Promise<CallToolResult> => {
      const { query, house, active_only, limit } = args;
      try {
        const qp = new URLSearchParams();
        qp.set("Take", String(limit));
        if (active_only) qp.set("CommitteeStatus", "Current");
        if (house) qp.set("House", String(HOUSE_MAP[house]));

        const f = assertOk(await deps.jsonGet(`${COMMITTEES_BASE}/Committees?${qp.toString()}`, { cacheTtl: TTL.HOUR }));
        const data = jsonOf(f);
        const items = extractItems(data);

        const committees: CommitteeSummary[] = [];
        for (const raw of items) {
          if (!isObj(raw)) continue;
          const name = reqStr(raw, "name", "Unknown");
          if (query && !name.toLowerCase().includes(query.toLowerCase())) continue;
          const cid = typeof raw["id"] === "number" ? raw["id"] : 0;
          committees.push({
            id: cid,
            name,
            house: parseHouse(raw["house"]),
            is_active: active_only ? true : null,
            url: `https://committees.parliament.uk/committee/${cid}/`,
          });
        }

        const result: CommitteeSearchResult = {
          query: query === undefined ? null : query.trim(),
          house: house ?? null,
          active_only,
          total: committees.length,
          committees,
        };
        return jsonResult(result);
      } catch (err) {
        const queryRepr = query === undefined ? "None" : `'${query}'`;
        return toolErrorFromException(err, `committees_search_committees(query=${queryRepr})`);
      }
    },
  );

  // --- committees_get_committee ----------------------------------------------
  server.registerTool(
    "committees_get_committee",
    {
      title: "Get Committee Detail",
      description: `Use this once you hold a committee_id and need the committee's metadata together with who currently serves on it.

The committee record and its roster are retrieved concurrently.
Afterwards, hand the committee_id to committees_search_evidence to find
out which submissions have been made to the committee and on which
subjects.`,
      inputSchema: {
        committee_id: z
          .number()
          .int()
          .gte(1)
          .describe("A committee's ID, as returned by committees_search_committees."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get Committee Detail"),
    },
    async (args): Promise<CallToolResult> => {
      const { committee_id } = args;
      try {
        const [detailFetched, membersFetched] = await Promise.all([
          deps.jsonGet(`${COMMITTEES_BASE}/Committees/${committee_id}`, { cacheTtl: TTL.HOUR }),
          deps.jsonGet(`${COMMITTEES_BASE}/Committees/${committee_id}/Members`, { cacheTtl: TTL.HOUR }),
        ]);
        assertOk(detailFetched);
        assertOk(membersFetched);

        const detailData = jsonOf(detailFetched);
        const membersData = jsonOf(membersFetched);

        const members: CommitteeMember[] = [];
        for (const raw of extractItems(membersData)) {
          if (isObj(raw)) members.push(mapMember(raw));
        }

        const dd = isObj(detailData) ? detailData : {};
        const detail: CommitteeDetail = {
          id: committee_id,
          name: reqStr(dd, "name", "Unknown"),
          house: parseHouse(dd["house"]),
          phone: optStr(dd["phone"]),
          email: optStr(dd["email"]),
          url: `https://committees.parliament.uk/committee/${committee_id}/`,
          members,
        };
        return jsonResult(detail);
      } catch (err) {
        return toolErrorFromException(err, `committees_get_committee(committee_id=${committee_id})`);
      }
    },
  );

  // --- committees_search_evidence --------------------------------------------
  server.registerTool(
    "committees_search_evidence",
    {
      title: "Search Committee Evidence",
      description: `Turn to this tool when you have a committee_id and want the oral and written evidence lodged with that committee.

A single page comes back per call (20 items by default). Long titles are
trimmed to max_title_chars, and each item lists at most 10 witnesses.
Where a committee has received a great deal of material, page through it
by calling again with offset=offset+returned for as long as has_more
stays true.

This is the definitive record of evidence given to parliamentary committees.`,
      inputSchema: {
        committee_id: z
          .number()
          .int()
          .gte(1)
          .describe("A committee's ID, as returned by committees_search_committees."),
        evidence_type: z
          .enum(["oral", "written", "both"])
          .describe("Which category of evidence to look up.")
          .default("both"),
        offset: z
          .number()
          .int()
          .gte(0)
          .lte(2000)
          .describe(
            "How many evidence items to pass over before this page begins. Starts at 0. To advance, call again with offset=offset+returned while has_more remains true.",
          )
          .default(0),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(100)
          .describe(
            "Cap on evidence items per page, defaulting to 20. With evidence_type='both', that budget is divided between oral and written submissions, roughly half to each.",
          )
          .default(20),
        max_title_chars: z
          .number()
          .int()
          .gte(50)
          .lte(2000)
          .describe(
            "Length limit applied to each item's title text. The default of 300 keeps lengthy inquiry titles from flooding the context; push it to 1000 or more only when the whole title matters.",
          )
          .default(300),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search Committee Evidence"),
    },
    async (args): Promise<CallToolResult> => {
      const { committee_id, evidence_type, offset, limit, max_title_chars } = args;

      const capTitle = (t: string): string =>
        t.length > max_title_chars ? t.slice(0, max_title_chars) + " …[truncated]" : t;

      const fetchEvidence = async (
        path: "OralEvidence" | "WrittenEvidence",
        skip: number,
        take: number,
        attemptedType: "oral" | "written",
        mapFn: (item: Record<string, unknown>, cap: (t: string) => string) => EvidenceItem,
      ): Promise<[EvidenceItem[], number]> => {
        const qp = new URLSearchParams();
        qp.set("CommitteeId", String(committee_id));
        qp.set("Skip", String(skip));
        qp.set("Take", String(take));
        let f;
        try {
          f = assertOk(await deps.jsonGet(`${COMMITTEES_BASE}/${path}?${qp.toString()}`, { cacheTtl: TTL.HOUR }));
        } catch (err) {
          throw new EvidenceFetchError(
            err,
            `committees_search_evidence(committee_id=${committee_id}, evidence_type='${attemptedType}')`,
          );
        }
        const items = extractItems(jsonOf(f));
        const results: EvidenceItem[] = [];
        for (const raw of items) {
          if (isObj(raw)) results.push(mapFn(raw, capTitle));
        }
        return [results, items.length];
      };

      const fetchOral = (skip: number, take: number) => fetchEvidence("OralEvidence", skip, take, "oral", mapOral);
      const fetchWritten = (skip: number, take: number) =>
        fetchEvidence("WrittenEvidence", skip, take, "written", mapWritten);

      try {
        let evidence: EvidenceItem[] = [];
        let has_more = false;

        if (evidence_type === "oral") {
          const [ev, raw] = await fetchOral(offset, limit);
          evidence = ev;
          has_more = raw === limit;
        } else if (evidence_type === "written") {
          const [ev, raw] = await fetchWritten(offset, limit);
          evidence = ev;
          has_more = raw === limit;
        } else {
          const oralTake = Math.floor((limit + 1) / 2); // remainder to oral
          const writtenTake = Math.floor(limit / 2);
          const [[oral, oralRaw], [written, writtenRaw]] = await Promise.all([
            fetchOral(offset, oralTake),
            fetchWritten(offset, writtenTake),
          ]);
          evidence = [...oral, ...written];
          has_more = oralRaw === oralTake || writtenRaw === writtenTake;
        }

        const page: CommitteeEvidencePage = {
          committee_id,
          evidence_type,
          offset,
          limit,
          returned: evidence.length,
          has_more,
          evidence,
        };
        return jsonResult(page);
      } catch (err) {
        if (err instanceof EvidenceFetchError) return toolErrorFromException(err.underlying, err.attempted);
        return toolErrorFromException(err, `committees_search_evidence(committee_id=${committee_id})`);
      }
    },
  );
}
