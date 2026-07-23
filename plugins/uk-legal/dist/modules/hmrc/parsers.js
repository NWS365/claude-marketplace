/** The 22 Nov 2023 Autumn Statement date attached to every static VAT lookup result. */
export const EFFECTIVE_DATE = "2023-11-22";
/**
 * Fixed VAT-rate reference table (refreshed at each Budget).
 *
 * Stored as an ordered array on purpose: lookupVat stops at the FIRST
 * two-way substring match, so a shorter key placed earlier (say "food")
 * can take precedence over a longer one later on (like "hot food"). Keeping
 * this order fixed makes the matching behaviour deterministic.
 *
 * Each entry is a tuple of [key, rate, rate_percentage, notes].
 */
const VAT_LOOKUP = [
    ["food", "zero", 0, "Most basic foods are zero-rated. Exceptions: hot food, catering, confectionery."],
    ["hot food", "standard", 20, "Hot food prepared for immediate consumption is standard-rated."],
    ["catering", "standard", 20, "Restaurant and catering services are standard-rated."],
    ["children's clothing", "zero", 0, "Clothing designed for children under 14 is zero-rated."],
    ["adult clothing", "standard", 20, "Adult clothing is standard-rated."],
    ["books", "zero", 0, "Physical books, booklets, brochures are zero-rated."],
    ["ebooks", "zero", 0, "E-books and digital publications are zero-rated since 1 May 2020."],
    ["newspapers", "zero", 0, "Newspapers and periodicals are zero-rated."],
    ["children's car seats", "reduced", 5, "Children's car seats are reduced-rated at 5%."],
    ["domestic fuel", "reduced", 5, "Gas and electricity for domestic use is reduced-rated at 5%."],
    ["energy saving materials", "reduced", 5, "Installation of energy-saving materials in residential properties."],
    ["medicine", "zero", 0, "Prescription and certain over-the-counter medicines are zero-rated."],
    ["financial services", "exempt", 0, "Most financial services are VAT-exempt."],
    ["insurance", "exempt", 0, "Insurance services are generally VAT-exempt."],
    ["health", "exempt", 0, "Medical and health services by registered practitioners are exempt."],
    ["education", "exempt", 0, "Education provided by eligible bodies (schools, universities) is exempt."],
    ["postage stamps", "exempt", 0, "Royal Mail postage services are VAT-exempt."],
    ["betting", "exempt", 0, "Betting, gaming, and lottery services are VAT-exempt."],
    ["land", "exempt", 0, "Sale or lease of bare land is VAT-exempt (unless opted to tax)."],
    ["residential property", "exempt", 0, "Sale and lease of residential property is VAT-exempt."],
    ["new build residential", "zero", 0, "First grant of a major interest in a new dwelling is zero-rated."],
    ["software", "standard", 20, "Software and digital services are standard-rated."],
    ["saas", "standard", 20, "Software as a Service is standard-rated."],
    ["consulting", "standard", 20, "Professional and consulting services are standard-rated."],
    ["legal services", "standard", 20, "Legal services are standard-rated."],
    ["transport", "zero", 0, "Most passenger transport is zero-rated. Exception: taxis, private hire."],
    ["taxi", "standard", 20, "Taxi and private hire vehicle services are standard-rated."],
    ["funeral", "zero", 0, "Burial and cremation services are zero-rated."],
    ["exports", "zero", 0, "Exports of goods outside the UK are zero-rated."],
    ["contraceptives", "zero", 0, "Contraceptive products are zero-rated."],
];
/**
 * Resolve a commodity code or free-text description against the fixed table.
 *
 * Matching is case-insensitive and ignores surrounding whitespace; a key
 * counts as a hit when either string contains the other, and the first such
 * key wins. With no match, the result falls back to the standard 20% band,
 * and its notes field quotes the caller's input exactly as supplied, before
 * any trimming.
 */
export function lookupVat(commodityCode) {
    const key = commodityCode.trim().toLowerCase();
    for (const [k, rate, percentage, notes] of VAT_LOOKUP) {
        if (key.includes(k) || k.includes(key)) {
            return {
                commodity_code: commodityCode.trim(),
                rate,
                rate_percentage: percentage,
                effective_from: EFFECTIVE_DATE,
                notes,
            };
        }
    }
    return {
        commodity_code: commodityCode.trim(),
        rate: "standard",
        rate_percentage: 20,
        effective_from: EFFECTIVE_DATE,
        notes: `No specific exemption found for '${commodityCode}'. ` +
            "Standard 20% rate assumed. Verify at https://www.gov.uk/guidance/rates-of-vat-on-different-goods-and-services",
    };
}
/**
 * Extract a date-only ISO string. Takes the first 10 characters and, when they
 * form a genuine YYYY-MM-DD calendar date, returns that string; anything else
 * — including empty or nullish input — yields null.
 */
export function isoDateOrNull(ts) {
    if (ts === null || ts === undefined || ts === "")
        return null;
    const s = String(ts).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m)
        return null;
    const [, ys, ms, ds] = m;
    if (ys === undefined || ms === undefined || ds === undefined)
        return null;
    const year = Number(ys);
    const month = Number(ms);
    const day = Number(ds);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return null;
    }
    return s;
}
/** Build an MTDStatus from the raw MTD obligations JSON. */
export function parseMtdStatus(vrn, raw) {
    const data = (raw ?? {});
    const obligations = Array.isArray(data.obligations) ? data.obligations : [];
    let effectiveDate = null;
    if (obligations.length > 0) {
        const first = (obligations[0] ?? {});
        if (first.start)
            effectiveDate = first.start;
    }
    return {
        vrn,
        mandated: obligations.length > 0,
        effective_date: effectiveDate,
        trading_name: data.tradingName ?? null,
    };
}
/** Convert a GOV.UK search.json payload into an HMRCGuidanceSearchResult. */
export function parseGuidanceResults(query, raw) {
    const data = (raw ?? {});
    const items = Array.isArray(data.results) ? data.results : [];
    const results = [];
    for (const entry of items) {
        const item = (entry ?? {});
        results.push({
            title: item.title ?? "Unknown",
            url: `https://www.gov.uk${item.link ?? ""}`,
            summary: item.description ?? null,
            updated: isoDateOrNull(item.public_timestamp),
        });
    }
    return {
        query,
        total: results.length,
        results,
    };
}
