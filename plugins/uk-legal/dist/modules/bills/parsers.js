export const BILLS_BASE = "https://bills-api.parliament.uk/api/v1";
export const HOUSE_MAP = { Commons: 1, Lords: 2 };
export const STAGE_ID_MAP = {
    firstreading: [6, 1],
    secondreading: [7, 2],
    committee: [8, 3, 48, 49],
    report: [9, 4],
    thirdreading: [10, 5],
    royalassent: [11],
};
/** Return the trimmed string when given one; anything else yields null. */
function trimStr(v) {
    return typeof v === "string" ? v.trim() : null;
}
/** Pass through a genuine boolean, otherwise fall back to the supplied default. */
function asBool(v, dflt) {
    return typeof v === "boolean" ? v : dflt;
}
/** Pass through a genuine number, otherwise fall back to the supplied default. */
function asNum(v, dflt) {
    return typeof v === "number" ? v : dflt;
}
/** Resolve a house value: an object contributes its name, a string is used as-is, otherwise null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHouse(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        const n = v.name;
        return n == null ? null : String(n);
    }
    if (typeof v === "string")
        return v;
    return null;
}
/** Check that a plain 'YYYY-MM-DD' string denotes an actual calendar date. */
function isValidIsoDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        return false;
    const parts = s.split("-");
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** Build a BillSummary from one raw upstream item. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseBillSummary(item) {
    const currentStageRaw = item?.currentStage;
    let currentStage = null;
    if (currentStageRaw && typeof currentStageRaw === "object" && !Array.isArray(currentStageRaw)) {
        const stageName = currentStageRaw.description || currentStageRaw.stageName || null;
        currentStage = stageName == null ? null : String(stageName);
    }
    const billId = asNum(item?.billId, 0);
    return {
        id: billId,
        short_title: trimStr(item?.shortTitle) ?? "Unknown",
        long_title: trimStr(item?.longTitle),
        current_house: trimStr(parseHouse(item?.currentHouse)),
        current_stage: trimStr(currentStage),
        is_act: asBool(item?.isAct, false),
        url: `https://bills.parliament.uk/bills/${billId}`,
    };
}
/** Build a BillDetail from the raw upstream bill payload. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseBillDetail(data, maxSummaryChars) {
    const sponsors = [];
    const rawSponsors = Array.isArray(data?.sponsors) ? data.sponsors : [];
    for (const s of rawSponsors) {
        const member = s && typeof s.member === "object" && s.member !== null ? s.member : {};
        let nameVal;
        if ("name" in member)
            nameVal = member.name;
        else if (s && typeof s === "object" && "name" in s)
            nameVal = s.name;
        else
            nameVal = "Unknown";
        sponsors.push({
            name: nameVal == null ? "Unknown" : String(nameVal).trim(),
            party: trimStr(member.party),
            house: trimStr(parseHouse(member.house)),
        });
    }
    const stages = [];
    let currentStageName = null;
    const csd = data?.currentStage;
    if (csd && typeof csd === "object" && !Array.isArray(csd)) {
        const desc = csd.description;
        const stageName = "stageName" in csd ? csd.stageName : "Unknown";
        const stageNameVal = desc || stageName;
        currentStageName = stageNameVal == null ? null : String(stageNameVal);
        let sittingDate = null;
        const sittings = csd.stageSittings;
        if (Array.isArray(sittings) && sittings.length > 0) {
            const first = sittings[0];
            const dateStr = first && typeof first.date === "string" ? first.date : "";
            if (dateStr) {
                const iso = dateStr.slice(0, 10);
                if (isValidIsoDate(iso))
                    sittingDate = iso;
            }
        }
        stages.push({
            name: stageNameVal == null ? "Unknown" : String(stageNameVal).trim(),
            house: trimStr(parseHouse(csd.house)),
            date: sittingDate,
            is_current: true,
        });
    }
    const royalAssentDate = null;
    const rawSummary = data?.summary;
    let summary;
    let summaryTruncated;
    let summaryOriginalLength;
    if (typeof rawSummary === "string" && rawSummary) {
        summaryOriginalLength = rawSummary.length;
        if (summaryOriginalLength > maxSummaryChars) {
            summaryTruncated = true;
            summary = rawSummary.slice(0, maxSummaryChars) + " …[truncated]";
        }
        else {
            summaryTruncated = false;
            summary = rawSummary;
        }
    }
    else {
        summary = null;
        summaryTruncated = false;
        summaryOriginalLength = 0;
    }
    if (summary != null)
        summary = summary.trim();
    const billId = asNum(data?.billId, 0);
    return {
        id: billId,
        short_title: trimStr(data?.shortTitle) ?? "Unknown",
        long_title: trimStr(data?.longTitle),
        summary,
        summary_truncated: summaryTruncated,
        summary_original_length: summaryOriginalLength,
        current_house: trimStr(parseHouse(data?.currentHouse)),
        originating_house: trimStr(parseHouse(data?.originatingHouse)),
        current_stage: trimStr(currentStageName),
        sponsors,
        stages,
        is_act: asBool(data?.isAct, false),
        royal_assent_date: royalAssentDate,
        url: `https://bills.parliament.uk/bills/${billId}`,
    };
}
