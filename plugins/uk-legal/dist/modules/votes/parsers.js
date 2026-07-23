export const COMMONS_VOTES_BASE = "https://commonsvotes-api.parliament.uk";
export const LORDS_VOTES_BASE = "https://lordsvotes-api.parliament.uk";
export const MAX_VOTERS_PER_SIDE = 100;
export function searchUrl(house) {
    if (house === "Lords")
        return `${LORDS_VOTES_BASE}/data/Divisions/search`;
    return `${COMMONS_VOTES_BASE}/data/divisions.json/search`;
}
export function detailUrl(house, divisionId) {
    if (house === "Lords")
        return `${LORDS_VOTES_BASE}/data/Divisions/${divisionId}`;
    return `${COMMONS_VOTES_BASE}/data/division/${divisionId}.json`;
}
export function asDict(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
/** Like Python's dict.get across several candidate keys: return the value of the first one present. */
export function firstOf(obj, keys, def) {
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k))
            return obj[k];
    }
    return def;
}
function num(v, def) {
    return typeof v === "number" ? v : def;
}
/** Strip surrounding whitespace from string fields, falling back to a default when absent. */
function strip(v, def) {
    if (typeof v === "string")
        return v.trim();
    return v == null ? def : String(v).trim();
}
/** Keep the leading 10 characters of an ISO timestamp, giving 'YYYY-MM-DD'. */
function toDateStr(v) {
    return String(v).slice(0, 10);
}
/** Build a DivisionSummary from a Commons search item. */
export function parseCommonsSummary(item) {
    const ayes = num(firstOf(item, ["AyeCount"], 0), 0);
    const noes = num(firstOf(item, ["NoCount"], 0), 0);
    return {
        id: num(firstOf(item, ["DivisionId"], 0), 0),
        title: strip(firstOf(item, ["Title"], "Unknown"), "Unknown"),
        date: toDateStr(firstOf(item, ["Date"], "1970-01-01")),
        house: "Commons",
        ayes,
        noes,
        passed: ayes > noes,
        is_government_win: null,
    };
}
/** Build a DivisionSummary from a Lords search item. */
export function parseLordsSummary(item) {
    const ayes = num(firstOf(item, ["authoritativeContentCount", "AuthoritativeContentCount"], 0), 0);
    const noes = num(firstOf(item, ["authoritativeNotContentCount", "AuthoritativeNotContentCount"], 0), 0);
    const gwin = firstOf(item, ["isGovernmentWin", "IsGovernmentWin"], null);
    return {
        id: num(firstOf(item, ["divisionId", "DivisionId"], 0), 0),
        title: strip(firstOf(item, ["title", "Title"], "Unknown"), "Unknown"),
        date: toDateStr(firstOf(item, ["date", "Date"], "1970-01-01")),
        house: "Lords",
        ayes,
        noes,
        passed: ayes > noes,
        is_government_win: gwin == null ? null : Boolean(gwin),
    };
}
/** Turn a raw voter array into Voter records. */
export function parseVoters(voterList) {
    const voters = [];
    for (const raw of voterList) {
        const v = asDict(raw);
        const party = firstOf(v, ["Party", "party"], null);
        voters.push({
            member_id: num(firstOf(v, ["MemberId", "memberId"], 0), 0),
            name: strip(firstOf(v, ["Name", "name"], "Unknown"), "Unknown"),
            party: party == null ? null : strip(party, ""),
        });
    }
    return voters;
}
/** Date helper for the detail path (exported for use by tools.ts). */
export function detailDate(v) {
    return toDateStr(v);
}
/** Title helper for the detail path (exported for tools.ts; trims surrounding whitespace). */
export function detailTitle(v) {
    return strip(v, "Unknown");
}
/** Coerce a possibly-absent value into a boolean or null (used for is_government_win). */
export function nullableBool(v) {
    return v == null ? null : Boolean(v);
}
