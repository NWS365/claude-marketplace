export const TNA_BASE = "https://caselaw.nationalarchives.gov.uk";
export const LEGISLATION_BASE = "https://www.legislation.gov.uk";
export const AMBIGUOUS_COURTS = new Set(["EWHC", "UKUT", "UKFTT"]);
// --- Raw pattern fragments ---
//
// Compiled from primary sources, not from any third-party implementation. The
// neutral-citation court codes follow the neutral-citation scheme (Practice
// Direction (Citation of Authorities)) and the court/tribunal list published by
// The National Archives' Find Case Law — the same authority this module's
// resolver targets, so the matcher and the resolver stay in step. The law-report
// series abbreviations follow OSCOLA (4th edn). Both are factual reference data
// (official court codes; standard report-series abbreviations); the ordering
// here is our own — courts by hierarchy, report series by precedence.
//
// A neutral citation's parenthetical division (the "(KB)" in "[2024] EWHC 12
// (KB)") is captured by the trailing group in NEUTRAL_RE, NOT inside this list,
// because in a well-formed citation the division follows the number. Only the
// courts that carry no post-number division inline (EWCA Civ/Crim) spell it out.
// Codes are limited to those the resolver can map to a Find Case Law URL.
const NEUTRAL_COURT_PATTERN = String.raw `UKSC|UKPC|EWCA\s+(?:Civ|Crim)|EWHC|EWFC|EWCOP|UKUT|UKFTT|EAT`;
const REPORT_SERIES = String.raw `AC|QB|KB|Ch|Fam|WLR|All\s+ER(?:\s+\(Comm\))?|Cr\s+App\s+R|BCLC|ICR|IRLR|HLR|EMLR|CMLR|ELR|Lloyd's\s+Rep(?:\s+Med)?`;
// --- Compiled patterns (compile-once module singletons) ---
const NEUTRAL_RE = new RegExp(String.raw `\[(\d{4})\]\s+(` + NEUTRAL_COURT_PATTERN + String.raw `)\s+(\d+)(?:\s*\(([A-Za-z]+)\))?`, "gi");
const LAW_REPORT_RE = new RegExp(String.raw `\[(\d{4})\]\s+(?:(\d+)\s+)?(` + REPORT_SERIES + String.raw `)\s+(\d+)`, "gi");
const LEGISLATION_RE = new RegExp(String.raw `s(?:ection)?\.?\s*(\d+[A-Z]?)(?:\(\d+\))*\s+([A-Z][A-Za-z']+(?:\s+[A-Za-z']+)*\s+Act\s+\d{4})`, "g");
const SI_RE = new RegExp(String.raw `S\.?I\.?\s+(\d{4})\s*/\s*(\d+)`, "gi");
const EU_RETAINED_RE = new RegExp(String.raw `(?:Regulation|Directive|Decision)\s+\(EU(?:/EEA)?\)\s+(\d{4})/(\d+)`, "gi");
/** Hand back the compiled OSCOLA regex patterns, keyed by citation type. */
export function compilePatterns() {
    return {
        neutral: NEUTRAL_RE,
        law_report: LAW_REPORT_RE,
        legislation: LEGISLATION_RE,
        si: SI_RE,
        eu_retained: EU_RETAINED_RE,
    };
}
// --- Court / series normalisation and resolution ---
/**
 * Canonical OSCOLA display case for each recognised court-division qualifier.
 * Acronym divisions (KB, IPEC, TCC, IAC, …) stay upper-cased; word divisions
 * (Comm, Ch, Admin, …) are title-cased. Keyed by the upper-cased token.
 */
const DIVISION_DISPLAY = {
    // EWHC divisions
    KB: "KB", CH: "Ch", COMM: "Comm", FAM: "Fam", PAT: "Pat", IPEC: "IPEC",
    ADMIN: "Admin", TCC: "TCC", COSTS: "Costs",
    // UKUT chambers
    IAC: "IAC", AAC: "AAC", LC: "LC",
    // UKFTT chambers
    TC: "TC", GRC: "GRC",
};
/** Normalise a division qualifier to its canonical OSCOLA case; an unknown token is upper-cased. */
export function normaliseDivision(raw) {
    const key = raw.trim().toUpperCase();
    return DIVISION_DISPLAY[key] ?? key;
}
/** True when the court code is missing a division qualifier that it needs. */
export function courtIsAmbiguous(courtRaw) {
    const normalized = courtRaw.trim().toUpperCase().replace(/ /g, "");
    return AMBIGUOUS_COURTS.has(normalized);
}
const TNA_COURT_SLUGS = {
    UKSC: "uksc",
    UKPC: "ukpc",
    "EWCA CIV": "ewca/civ",
    "EWCA CRIM": "ewca/crim",
    "EWHC (KB)": "ewhc/kb",
    "EWHC (CH)": "ewhc/ch",
    "EWHC (COMM)": "ewhc/comm",
    "EWHC (FAM)": "ewhc/fam",
    "EWHC (PAT)": "ewhc/pat",
    "EWHC (IPEC)": "ewhc/ipec",
    "EWHC (ADMIN)": "ewhc/admin",
    "EWHC (TCC)": "ewhc/tcc",
    "EWHC (COSTS)": "ewhc/costs",
    EWFC: "ewfc",
    EWCOP: "ewcop",
    "UKUT (IAC)": "ukut/iac",
    "UKUT (TCC)": "ukut/tcc",
    "UKUT (AAC)": "ukut/aac",
    "UKUT (LC)": "ukut/lc",
    EAT: "eat",
    "UKFTT (TC)": "ukftt/tc",
    "UKFTT (GRC)": "ukftt/grc",
    // Note: Scottish and Northern Irish courts are deliberately absent — TNA Find
    // Case Law does not host them, so a slug here would resolve to a URL that 404s.
};
/** Build the TNA Find Case Law URL that corresponds to a neutral citation. */
export function resolveNeutralCitation(year, court, num) {
    const slug = TNA_COURT_SLUGS[court.trim().toUpperCase()];
    return slug ? `${TNA_BASE}/${slug}/${year}/${num}` : null;
}
export function resolveSi(siYear, siNumber) {
    return `${LEGISLATION_BASE}/uksi/${siYear}/${siNumber}`;
}
export function resolveLegislation(title, _section) {
    const encoded = title.replace(/ /g, "+");
    return `${LEGISLATION_BASE}/search?title=${encoded}`;
}
// --- OSCOLA display labels and string formatting ---
const COURT_DISPLAY = {
    UKSC: "UKSC",
    UKPC: "UKPC",
    "EWCA CIV": "EWCA Civ",
    "EWCA CRIM": "EWCA Crim",
    EWHC: "EWHC",
    "EWHC (KB)": "EWHC (KB)",
    "EWHC (CH)": "EWHC (Ch)",
    "EWHC (COMM)": "EWHC (Comm)",
    "EWHC (FAM)": "EWHC (Fam)",
    "EWHC (PAT)": "EWHC (Pat)",
    "EWHC (IPEC)": "EWHC (IPEC)",
    "EWHC (ADMIN)": "EWHC (Admin)",
    "EWHC (TCC)": "EWHC (TCC)",
    "EWHC (COSTS)": "EWHC (Costs)",
    EWFC: "EWFC",
    EWCOP: "EWCOP",
    UKUT: "UKUT",
    "UKUT (IAC)": "UKUT (IAC)",
    "UKUT (TCC)": "UKUT (TCC)",
    "UKUT (AAC)": "UKUT (AAC)",
    "UKUT (LC)": "UKUT (LC)",
    EAT: "EAT",
    UKFTT: "UKFTT",
    "UKFTT (TC)": "UKFTT (TC)",
    "UKFTT (GRC)": "UKFTT (GRC)",
};
export function buildOscola(citationType, year, court, num, reportSeries, volume, page, legislationTitle, section, siYear, siNumber, raw) {
    if (citationType === "neutral") {
        const key = court || "";
        const display = COURT_DISPLAY[key] ?? key;
        // For the EWHC/UKUT/UKFTT families the division is parenthetical and, in
        // OSCOLA, follows the number: "[2024] EWHC 123 (KB)". EWCA Civ/Crim and the
        // divisionless courts carry no parenthetical and format as "[year] court num".
        const divisioned = display.match(/^(.*?)\s*\(([^)]+)\)$/);
        if (divisioned)
            return `[${year}] ${divisioned[1]} ${num} (${divisioned[2]})`;
        return `[${year}] ${display} ${num}`;
    }
    if (citationType === "law_report") {
        if (volume)
            return `[${year}] ${volume} ${reportSeries} ${page}`;
        return `[${year}] ${reportSeries} ${page}`;
    }
    if (citationType === "legislation") {
        return `s.${section} ${legislationTitle}`;
    }
    if (citationType === "si") {
        return `SI ${siYear}/${siNumber}`;
    }
    // For eu_retained and anything unrecognised, the raw text is the canonical form
    return raw ?? "";
}
/** Produce a ParsedCitation with every key present, defaulting anything unset to null. */
function makeCitation(p) {
    return {
        raw: p.raw,
        type: p.type,
        year: p.year ?? null,
        court: p.court ?? null,
        number: p.number ?? null,
        report_series: p.report_series ?? null,
        volume: p.volume ?? null,
        page: p.page ?? null,
        legislation_title: p.legislation_title ?? null,
        section: p.section ?? null,
        si_year: p.si_year ?? null,
        si_number: p.si_number ?? null,
        resolved_url: p.resolved_url ?? null,
        confidence: p.confidence,
    };
}
/** Turn a regex match into a ParsedCitation, populating the fields that apply to its type. */
export function parseCitationFromMatch(m, ctype) {
    const raw = m[0];
    if (ctype === "neutral") {
        const year = parseInt(m[1], 10);
        let court = m[2].trim().replace(/\s+/g, " ").toUpperCase();
        const num = parseInt(m[3], 10);
        const trailingDivision = m[4];
        if (trailingDivision && AMBIGUOUS_COURTS.has(court)) {
            court = `${court} (${normaliseDivision(trailingDivision)})`;
        }
        // A neutral citation is confident only when it resolves to a specific court.
        // A bare EWHC/UKUT/UKFTT (no division) and any unrecognised court+division
        // do not resolve, so they surface as ambiguous rather than falsely confident.
        const resolved = resolveNeutralCitation(year, court, num);
        const confidence = resolved ? 1.0 : 0.5;
        return makeCitation({ raw, type: ctype, year, court, number: num, resolved_url: resolved, confidence });
    }
    if (ctype === "law_report") {
        const year = parseInt(m[1], 10);
        const volume = m[2] ? parseInt(m[2], 10) : null;
        const series = m[3].trim().replace(/\s+/g, " ");
        const page = parseInt(m[4], 10);
        return makeCitation({ raw, type: ctype, year, report_series: series, volume, page, confidence: 0.9 });
    }
    if (ctype === "legislation") {
        const section = m[1];
        const title = m[2].trim();
        const yearM = title.match(/\d{4}$/);
        const year = yearM ? parseInt(yearM[0], 10) : null;
        const resolved = resolveLegislation(title, section);
        return makeCitation({ raw, type: ctype, year, legislation_title: title, section, resolved_url: resolved, confidence: 0.95 });
    }
    if (ctype === "si") {
        const siYear = parseInt(m[1], 10);
        const siNumber = parseInt(m[2], 10);
        return makeCitation({ raw, type: ctype, year: siYear, si_year: siYear, si_number: siNumber, resolved_url: resolveSi(siYear, siNumber), confidence: 1.0 });
    }
    if (ctype === "eu_retained") {
        const year = parseInt(m[1], 10);
        const num = parseInt(m[2], 10);
        return makeCitation({ raw, type: ctype, year, number: num, confidence: 0.9 });
    }
    return makeCitation({ raw, type: ctype, confidence: 0.5 });
}
/** Apply every compiled pattern to the text, returning a [confident, ambiguous] pair of lists. */
export function extractAllCitations(text, patterns) {
    const seenSpans = [];
    const confident = [];
    const ambiguous = [];
    const priority = ["neutral", "legislation", "si", "eu_retained", "law_report"];
    for (const ctype of priority) {
        const pattern = patterns[ctype];
        if (!pattern)
            continue;
        for (const match of text.matchAll(pattern)) {
            const start = match.index ?? 0;
            const end = start + match[0].length;
            const overlaps = seenSpans.some(([s, e]) => (s <= start && start < e) || (s < end && end <= e));
            if (overlaps)
                continue;
            seenSpans.push([start, end]);
            const parsed = parseCitationFromMatch(match, ctype);
            (parsed.confidence >= 0.7 ? confident : ambiguous).push(parsed);
        }
    }
    return [confident, ambiguous];
}
