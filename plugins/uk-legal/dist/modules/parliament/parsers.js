import { assertOk, jsonOf } from "../../shared/http.js";
import { UpstreamHttpError } from "../../shared/envelope.js";
import { TTL } from "../../shared/cache.js";
export const HANSARD_API = "https://hansard-api.parliament.uk";
export const MEMBERS_BASE = "https://members-api.parliament.uk/api";
export const PETITIONS_BASE = "https://petition.parliament.uk";
export const INTERESTS_BASE = "https://interests-api.parliament.uk/api/v1";
export const INTEREST_CATEGORIES = {
    employment: 12,
    employment_adhoc: 1,
    employment_ongoing: 2,
    donations: 3,
    gifts_uk: 4,
    overseas_visits: 5,
    gifts_overseas: 6,
    land: 7,
    shareholdings: 8,
    miscellaneous: 9,
    family_employed: 10,
    family_lobbying: 11,
};
// ---------------------------------------------------------------------------
// String / number helpers
// ---------------------------------------------------------------------------
/** Strip HTML tags out and squeeze runs of whitespace down to single spaces. */
export function stripHtml(text) {
    const clean = (text || "").replace(/<[^>]+>/g, "");
    return clean.replace(/\s+/g, " ").trim();
}
const SLUG_RE = /[^a-z0-9]+/g;
/** Turn a title into a URL slug. */
export function slugify(title) {
    const s = title.trim().toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "");
    return s || "debate";
}
/**
 * Convert a string or number to an integer, falling back to `def` when that is
 * not possible. Only strings consisting entirely of digits parse, staying close
 * to Python's int() behaviour.
 */
export function safeInt(value, def = 0) {
    if (typeof value === "number" && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === "string") {
        const t = value.trim();
        if (/^[+-]?\d+$/.test(t))
            return parseInt(t, 10);
    }
    return def;
}
/** Parse to an integer, or return null on failure; used by the votes cross-resolve. */
function strictInt(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === "string") {
        const t = value.trim();
        if (/^[+-]?\d+$/.test(t))
            return parseInt(t, 10);
    }
    return null;
}
/** Reproduces `int(x or 0)`: falsy inputs become 0, otherwise coerce to int. */
export function pyIntOr0(x) {
    return safeInt(x || 0, 0);
}
/**
 * Normalise a raw date: fall back to "1970-01-01" when empty, keep the leading
 * 10 characters, and check the YYYY-MM-DD shape. A malformed non-empty date
 * throws, letting per-item try/catch callers drop the offending row.
 */
export function isoDate(raw) {
    const base = raw || "1970-01-01";
    const s = String(base).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw new Error(`invalid isoformat string: ${s}`);
    return s;
}
/** Quote a string for the `attempted=` error breadcrumb: wrap in quotes and escape control characters. */
export function quoteArg(s) {
    const hasSingle = s.includes("'");
    const hasDouble = s.includes('"');
    const quote = hasSingle && !hasDouble ? '"' : "'";
    let body = s.replace(/\\/g, "\\\\");
    body = body.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    if (quote === "'")
        body = body.replace(/'/g, "\\'");
    else
        body = body.replace(/"/g, '\\"');
    return quote + body + quote;
}
/**
 * Translate the usual upstream exceptions into a human-actionable message.
 * Used only by the resource error envelopes.
 */
export function formatHttpError(e) {
    if (e instanceof UpstreamHttpError) {
        const status = e.status;
        if (status === 404)
            return "Error 404: Resource not found — check the URI or identifier is correct.";
        if (status === 403)
            return `Error 403: Access denied by upstream API. URL: ${e.url}`;
        if (status === 429)
            return "Error 429: Rate limit hit — upstream API is throttling. Try again shortly.";
        if (status === 503)
            return "Error 503: Upstream service unavailable — try again later.";
        return `Error ${status}: Upstream API returned unexpected status. URL: ${e.url}`;
    }
    const name = e instanceof Error ? e.name : "Error";
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(name) || /timed out|timeout|aborted/i.test(msg)) {
        return "Error: Request timed out (30s). Upstream API may be slow — retry.";
    }
    if (/connect/i.test(name) || /ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
        return "Error: Could not connect to upstream API. Check network or try again.";
    }
    return `Error: Unexpected error — ${name}: ${msg}`;
}
/** Order a string counter by descending count, keeping first-seen order for ties. */
export function mostCommon(counter) {
    return [...counter.entries()].sort((a, b) => b[1] - a[1]);
}
/** Coerce an upstream House value to Commons or Lords, defaulting to Commons. */
export function normHouse(raw) {
    const h = raw || "Commons";
    return h === "Commons" || h === "Lords" ? h : "Commons";
}
// ---------------------------------------------------------------------------
// Hansard URL synthesis
// ---------------------------------------------------------------------------
/** Build the public hansard.parliament.uk URL that points at a contribution. */
export function hansardContributionUrl(house, sittingDate, debateExtId, contributionExtId, debateTitle) {
    const houseSeg = house === "Commons" || house === "Lords" ? house.toLowerCase() : "commons";
    return (`https://hansard.parliament.uk/${houseSeg}/${sittingDate}` +
        `/debates/${debateExtId}/${slugify(debateTitle)}` +
        `#contribution-${contributionExtId}`);
}
// ---------------------------------------------------------------------------
// Column extraction helpers
// ---------------------------------------------------------------------------
const SPAN_RE = /<span\b([^>]*)>/gi;
const COL_NUM_ATTR_RE = /\bdata-column-number="(\d+)"/;
const IS_COLUMN_MARKER_RE = /\bclass="column-number[\s"]/;
/** Collect each data-column-number integer sitting on a column-boundary span. */
export function extractColumnNumbers(html) {
    if (!html)
        return [];
    const out = [];
    SPAN_RE.lastIndex = 0;
    let m;
    while ((m = SPAN_RE.exec(html)) !== null) {
        const attrs = m[1] ?? "";
        if (!IS_COLUMN_MARKER_RE.test(attrs))
            continue;
        const colM = COL_NUM_ATTR_RE.exec(attrs);
        if (colM)
            out.push(parseInt(colM[1], 10));
    }
    return out;
}
/** Compute carry-forward column numbers, indexed by item position. */
export function assignColumns(items) {
    const out = [];
    let currentColumn = null;
    for (let idx = 0; idx < items.length; idx++) {
        const markers = extractColumnNumbers(items[idx]?.Value || "");
        const colStart = markers.length ? markers[0] : currentColumn;
        if (markers.length)
            currentColumn = markers[markers.length - 1];
        out[idx] = [colStart, currentColumn];
    }
    return out;
}
/** Screen out column-number markers and other non-speech items. */
export function itemIsContribution(item) {
    if ((item?.ItemType || "") !== "Contribution")
        return false;
    const hrs = item?.HRSTag || "";
    if (hrs === "hs_ColumnNumber")
        return false;
    return Boolean(item?.Value);
}
const HANSARD_SOURCE_LABELS = {
    1: "RollingHansard",
    2: "DailyHansard",
    3: "BoundVolume",
    4: "Historic",
};
/** Translate a raw Hansard Overview.Source ordinal into its Swagger enum name. */
export function hansardSourceLabel(code) {
    if (code === null || code === undefined)
        return null;
    return HANSARD_SOURCE_LABELS[code] ?? `Unknown source code ${code}`;
}
// ---------------------------------------------------------------------------
// Contribution parsers
// ---------------------------------------------------------------------------
/** Parse the contributions out of a hansard-api search.json response. */
export function parseHansardContributions(data, textMode = "preview", maxTextChars = 3000) {
    const contributions = [];
    for (const item of data?.Contributions ?? []) {
        try {
            const attr = item.AttributedTo || item.MemberName || "";
            const name = item.MemberName || "Unknown";
            let party = null;
            if (attr.includes("(") && attr.includes(")")) {
                party = attr.slice(attr.lastIndexOf("(") + 1, attr.lastIndexOf(")"));
            }
            const rawTextField = textMode === "full" ? "ContributionTextFull" : "ContributionText";
            const text = stripHtml(item[rawTextField] || item.ContributionText || "");
            const sittingDate = isoDate(item.SittingDate);
            const house = item.House || "Commons";
            const debateExtId = item.DebateSectionExtId || "";
            const contributionExtId = item.ContributionExtId || "";
            const debateTitle = (item.DebateSection || item.DebateSectionName || "Unknown").trim() || "Unknown";
            const url = debateExtId && contributionExtId
                ? hansardContributionUrl(house, sittingDate, debateExtId, contributionExtId, debateTitle)
                : "";
            contributions.push({
                member_name: name,
                member_id: item.MemberId ?? null,
                attributed_to: attr || name,
                party,
                constituency: null,
                date: sittingDate,
                debate_title: debateTitle,
                debate_id: safeInt(item.DebateSectionId, 0),
                debate_ext_id: debateExtId,
                contribution_ext_id: contributionExtId,
                column_ref: item.HansardSection || null,
                column_start: null,
                column_end: null,
                chamber_section: item.Section || house,
                house: house === "Commons" || house === "Lords" ? house : "Commons",
                rank: item.Rank ?? null,
                text: text.slice(0, maxTextChars),
                url,
            });
        }
        catch {
            continue;
        }
    }
    return contributions;
}
/** Convert one /debates/Debate Items entry into a HansardContribution. */
export function parseDebateItemAsContribution(item, overview, columnAssignment, itemIndex, maxTextChars = 3000) {
    try {
        const attr = (item.AttributedTo || "").trim();
        if (!attr)
            return null;
        let name = attr;
        let party = null;
        if (attr.includes("(") && attr.endsWith(")")) {
            party = attr.slice(attr.lastIndexOf("(") + 1, -1);
            name = attr.slice(0, attr.lastIndexOf("(")).trim();
            if (name.endsWith(")") && name.includes("(")) {
                name = name.slice(name.lastIndexOf("(") + 1, -1).trim();
            }
        }
        const text = stripHtml(item.Value || "");
        if (!text)
            return null;
        const sittingDate = isoDate(overview.Date);
        const house = normHouse(overview.House);
        const debateExtId = overview.ExtId || "";
        const debateId = safeInt(overview.Id, 0);
        const debateTitle = (overview.Title || "Unknown").trim() || "Unknown";
        const chamberSection = overview.Location || `${house} Chamber`;
        const contributionExtId = item.ExternalId || "";
        const [colStart, colEnd] = columnAssignment[itemIndex] ?? [null, null];
        const url = debateExtId && contributionExtId
            ? hansardContributionUrl(house, sittingDate, debateExtId, contributionExtId, debateTitle)
            : "";
        return {
            member_name: name || "Unknown",
            member_id: item.MemberId ?? null,
            attributed_to: attr,
            party,
            constituency: null,
            date: sittingDate,
            debate_title: debateTitle,
            debate_id: debateId,
            debate_ext_id: debateExtId,
            contribution_ext_id: contributionExtId,
            column_ref: item.HansardSection || null,
            column_start: colStart,
            column_end: colEnd,
            chamber_section: chamberSection,
            house,
            rank: null,
            text: text.slice(0, maxTextChars),
            url,
        };
    }
    catch {
        return null;
    }
}
/** Tally party and house breakdowns plus the date range across a page of contributions. */
export function computeSearchFacets(contributions) {
    const party = {};
    const house = {};
    for (const c of contributions) {
        const p = c.party || "Unknown";
        party[p] = (party[p] ?? 0) + 1;
        house[c.house] = (house[c.house] ?? 0) + 1;
    }
    let dateRange = null;
    if (contributions.length) {
        let mn = contributions[0].date;
        let mx = contributions[0].date;
        for (const c of contributions) {
            if (c.date < mn)
                mn = c.date;
            if (c.date > mx)
                mx = c.date;
        }
        dateRange = [mn, mx];
    }
    return { party, house, dateRange };
}
/** Parse the Debates[] preview block into TopDebate entries. */
export function parseTopDebatesPreview(payload) {
    const out = [];
    for (const item of payload?.Debates ?? []) {
        try {
            const extId = item.DebateSectionExtId || "";
            if (!extId)
                continue;
            const sittingDate = isoDate(item.SittingDate);
            const house = normHouse(item.House);
            out.push({
                debate_id: 0,
                debate_ext_id: extId,
                debate_title: (item.Title || item.DebateSection || "Unknown").trim(),
                date: sittingDate,
                house,
                relevance_rank: safeInt(item.Rank, 0),
                contribution_count: null,
                source_code: null,
                source: null,
            });
        }
        catch {
            continue;
        }
    }
    return out;
}
/** Parse a single DivisionOverview-shaped item into DivisionMatchLite. */
export function parseDivisionMatch(item) {
    try {
        const extId = item.ExternalId || "";
        if (!extId)
            return null;
        const sittingDate = isoDate(item.Date);
        const house = normHouse(item.House);
        const timeRaw = item.Time;
        let timeClean = null;
        if (typeof timeRaw === "string" && timeRaw && timeRaw !== "None" && timeRaw !== "null") {
            timeClean = timeRaw.includes("T") ? timeRaw.slice(-8) : timeRaw;
        }
        return {
            id: safeInt(item.Id, 0),
            votes_id: null,
            external_id: extId,
            number: String(item.Number || ""),
            date: sittingDate,
            time: timeClean,
            house,
            ayes_count: safeInt(item.AyesCount, 0),
            noes_count: safeInt(item.NoesCount, 0),
            motion_text: item.TextBeforeVote || null,
            result_text: item.TextAfterVote || null,
            debate_section: item.DebateSection || null,
            debate_section_ext_id: item.DebateSectionExtId || null,
        };
    }
    catch {
        return null;
    }
}
/** Parse the Divisions[] preview block into DivisionMatchLite entries. */
export function parseTopDivisionsPreview(payload) {
    const out = [];
    for (const item of payload?.Divisions ?? []) {
        const parsed = item && typeof item === "object" ? parseDivisionMatch(item) : null;
        if (parsed !== null)
            out.push(parsed);
    }
    return out;
}
/**
 * Fill in each division's `votes_id` by matching the Hansard `id` against the
 * Lords/Commons Votes API. Mutates in place, issuing one upstream request per
 * (date, house) group.
 */
export async function populateVotesIds(deps, divisions) {
    if (!divisions.length)
        return;
    const groups = new Map();
    for (const d of divisions) {
        const key = `${d.date}|${d.house}`;
        const g = groups.get(key);
        if (g)
            g.push(d);
        else
            groups.set(key, [d]);
    }
    for (const [key, group] of groups) {
        const sep = key.indexOf("|");
        const dateIso = key.slice(0, sep);
        const house = key.slice(sep + 1);
        let url;
        let params;
        if (house === "Lords") {
            url = "https://lordsvotes-api.parliament.uk/data/Divisions/search";
            params = new URLSearchParams({ StartDate: dateIso, EndDate: dateIso });
        }
        else {
            url = "https://commonsvotes-api.parliament.uk/data/divisions.json/search";
            params = new URLSearchParams({ startDate: dateIso, endDate: dateIso });
        }
        let payload;
        try {
            const f = assertOk(await deps.jsonGet(`${url}?${params.toString()}`, { cacheTtl: TTL.HOUR }));
            payload = jsonOf(f);
        }
        catch {
            continue;
        }
        if (!Array.isArray(payload))
            continue;
        const byNumber = {};
        for (const entry of payload) {
            if (!entry || typeof entry !== "object")
                continue;
            const n = "number" in entry ? entry.number : entry.Number;
            const divId = "divisionId" in entry ? entry.divisionId : entry.DivisionId;
            if (n === null || n === undefined || divId === null || divId === undefined)
                continue;
            const parsed = strictInt(divId);
            if (parsed === null)
                continue;
            byNumber[String(n)] = parsed;
        }
        for (const div of group) {
            if (div.number && Object.prototype.hasOwnProperty.call(byNumber, div.number)) {
                div.votes_id = byNumber[div.number];
            }
        }
    }
}
