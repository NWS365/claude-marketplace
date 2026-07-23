import { z } from "zod";
import { assertOk, jsonOf } from "../../shared/http.js";
import { jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import { BILLS_BASE, HOUSE_MAP, STAGE_ID_MAP, parseBillDetail, parseBillSummary } from "./parsers.js";
const SEARCH_BILLS_DESCRIPTION = `Reach for this tool to look up UK parliamentary bills, filtering by keyword, session, house, or where they are in the legislative process.

Hands back one page of short bill records — title, the stage each is at,
and whether it has passed into an Act. Take a bill_id from the results and
feed it to bills_get_bill for the complete picture (sponsors, long title,
Royal Assent date).

This is the definitive reference for where a UK parliamentary bill stands.`;
const GET_BILL_DESCRIPTION = `Reach for this tool once you hold a bill_id (obtained via bills_search_bills) and need the complete record.

Gives you the sponsors, present stage, long title, summary, and — for
enacted bills — the Royal Assent date. The summary is limited to
max_summary_chars; consult summary_truncated in the reply to know whether
it was clipped.

As a follow-up, run parliament_search_hansard(query=bill_short_title) to
surface the bill's debates, or call bills_search_bills again on a related
keyword to explore neighbouring bills.`;
export function registerBillsTools(server, deps) {
    server.registerTool("bills_search_bills", {
        title: "Search Parliamentary Bills",
        description: SEARCH_BILLS_DESCRIPTION,
        inputSchema: {
            query: z
                .string()
                .min(1)
                .max(500)
                .describe("Keyword matched against bill titles and descriptions, such as 'online safety' or 'financial services'."),
            session: z
                .number()
                .int()
                .gte(1)
                .optional()
                .describe("The parliamentary session as a number (for instance 40 for 2024-25, 39 for 2023-24) — not a year such as '2025'. When you only have the year, leave this out and narrow the returned results yourself. Left unset, every session is searched."),
            house: z
                .enum(["Commons", "Lords", "All"])
                .optional()
                .describe("Restrict to the house a bill started in. Leave unset to cover both houses."),
            stage: z
                .enum(["firstreading", "secondreading", "committee", "report", "thirdreading", "royalassent"])
                .optional()
                .describe("Restrict to bills currently at a given legislative stage."),
            offset: z
                .number()
                .int()
                .gte(0)
                .lte(2000)
                .default(0)
                .describe("How many matches to pass over ahead of this page. Starts at 0, which yields the first page. To page onward, keep calling with offset=offset+returned for as long as has_more stays true."),
            limit: z
                .number()
                .int()
                .gte(1)
                .lte(100)
                .default(20)
                .describe("Ceiling on how many bills come back from this call. The default of 20 keeps replies tight; push it as high as 100 when doing bulk exports."),
        },
        annotations: withTitle(READ_ONLY_OPEN, "Search Parliamentary Bills"),
    }, async (args) => {
        const { query, session, house, stage, offset, limit } = args;
        const params = new URLSearchParams();
        params.append("SearchTerm", query);
        params.append("Take", String(limit));
        params.append("Skip", String(offset));
        if (session !== undefined && session !== null)
            params.append("Session", String(session));
        if (house && house !== "All") {
            const h = HOUSE_MAP[house];
            if (h !== undefined)
                params.append("CurrentHouse", String(h));
        }
        if (stage) {
            for (const id of STAGE_ID_MAP[stage] ?? [])
                params.append("BillStage", String(id));
        }
        const url = `${BILLS_BASE}/Bills?${params.toString()}`;
        try {
            const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.HOUR }));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = jsonOf(f);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = Array.isArray(data?.items) ? data.items : [];
            const bills = items.map(parseBillSummary);
            const total = typeof data?.totalResults === "number" ? data.totalResults : null;
            const hasMore = total !== null ? offset + bills.length < total : bills.length === limit;
            const result = {
                query: query.trim(),
                offset,
                limit,
                returned: bills.length,
                total,
                has_more: hasMore,
                bills,
            };
            return jsonResult(result);
        }
        catch (err) {
            return toolErrorFromException(err, `bills_search_bills(query='${query}')`);
        }
    });
    server.registerTool("bills_get_bill", {
        title: "Get Bill Detail",
        description: GET_BILL_DESCRIPTION,
        inputSchema: {
            bill_id: z.number().int().gte(1).describe("A bill's ID, as returned by bills_search_bills."),
            max_summary_chars: z
                .number()
                .int()
                .gte(500)
                .lte(50000)
                .default(5000)
                .describe("Upper bound on how many characters of summary text are returned. The 5,000 default (roughly 1,250 tokens) suits most bills; increase it for weightier government bills (Finance Act, Levelling-up) with lengthier summaries. Look at summary_truncated in the reply to tell whether trimming occurred."),
        },
        annotations: withTitle(READ_ONLY_OPEN, "Get Bill Detail"),
    }, async (args) => {
        const { bill_id, max_summary_chars } = args;
        const url = `${BILLS_BASE}/Bills/${bill_id}`;
        try {
            const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.HOUR }));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = jsonOf(f);
            return jsonResult(parseBillDetail(data, max_summary_chars));
        }
        catch (err) {
            return toolErrorFromException(err, `bills_get_bill(bill_id=${bill_id})`);
        }
    });
}
