/**
 * Compiled OSCOLA citation regex patterns together with the pure
 * parse-and-format engine.
 *
 * Nothing here does network I/O — every function is a side-effect-free
 * transform. Each compiled pattern carries the `g` flag so that
 * `String.prototype.matchAll` (our finditer equivalent) can iterate it. Because
 * matchAll clones the RegExp on every pass, the module-level patterns never
 * accumulate lastIndex state from one call to the next.
 */
import type { CitationType, ParsedCitation } from "./models.js";

export const TNA_BASE = "https://caselaw.nationalarchives.gov.uk";
export const LEGISLATION_BASE = "https://www.legislation.gov.uk";

export const AMBIGUOUS_COURTS = new Set<string>(["EWHC", "UKUT", "UKFTT"]);

// --- Raw pattern fragments ---
//
// Provenance: the NEUTRAL_COURT_PATTERN and REPORT_SERIES fragments below are
// incorporated and adapted from uk-legal-mcp (© 2026 Paul Boucherat), used under
// the MIT Licence (see the repository NOTICE). Their token content is the set of
// real UK neutral-citation court codes and the OSCOLA 4th-edition law-report
// series abbreviations; the selection/arrangement follows that project's.

const NEUTRAL_COURT_PATTERN = String.raw`EWCA\s+(?:Civ|Crim)|EWHC\s*\([A-Za-z]+\)|EWHC|EWFC\s*(?:\(Fam\))?|EWCOP|UKUT\s*\([A-Za-z]+\)|UKUT|UKFTT\s*\([A-Za-z]+\)|UKFTT|UKSC|UKPC|EAT|NICA|NIQB|CSOH|CSIH`;

const REPORT_SERIES = String.raw`AC|WLR|All\s+ER(?:\s+\(Comm\))?|QB|KB|Ch|Fam|BCLC|IRLR|ICR|HLR|Lloyd's\s+Rep(?:\s+Med)?|EMLR|CMLR|ELR|Cr\s+App\s+R`;

// --- Compiled patterns (compile-once module singletons) ---

const NEUTRAL_RE = new RegExp(
  String.raw`\[(\d{4})\]\s+(` + NEUTRAL_COURT_PATTERN + String.raw`)\s+(\d+)(?:\s*\(([A-Za-z]+)\))?`,
  "gi",
);
const LAW_REPORT_RE = new RegExp(
  String.raw`\[(\d{4})\]\s+(?:(\d+)\s+)?(` + REPORT_SERIES + String.raw`)\s+(\d+)`,
  "gi",
);
const LEGISLATION_RE = new RegExp(
  String.raw`s(?:ection)?\.?\s*(\d+[A-Z]?)(?:\(\d+\))*\s+([A-Z][A-Za-z']+(?:\s+[A-Za-z']+)*\s+Act\s+\d{4})`,
  "g",
);
const SI_RE = new RegExp(String.raw`S\.?I\.?\s+(\d{4})\s*/\s*(\d+)`, "gi");
const EU_RETAINED_RE = new RegExp(
  String.raw`(?:Regulation|Directive|Decision)\s+\(EU(?:/EEA)?\)\s+(\d{4})/(\d+)`,
  "gi",
);

/** Hand back the compiled OSCOLA regex patterns, keyed by citation type. */
export function compilePatterns(): Record<CitationType, RegExp> {
  return {
    neutral: NEUTRAL_RE,
    law_report: LAW_REPORT_RE,
    legislation: LEGISLATION_RE,
    si: SI_RE,
    eu_retained: EU_RETAINED_RE,
  };
}

// --- Court / series normalisation and resolution ---

/** Title-case a single alphabetic run: leading character upper-cased, the rest lower-cased. */
export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** True when the court code is missing a division qualifier that it needs. */
export function courtIsAmbiguous(courtRaw: string): boolean {
  const normalized = courtRaw.trim().toUpperCase().replace(/ /g, "");
  return AMBIGUOUS_COURTS.has(normalized);
}

const TNA_COURT_SLUGS: Record<string, string> = {
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
  NICA: "nica",
  NIQB: "niqb",
};

/** Build the TNA Find Case Law URL that corresponds to a neutral citation. */
export function resolveNeutralCitation(year: number, court: string, num: number): string | null {
  const slug = TNA_COURT_SLUGS[court.trim().toUpperCase()];
  return slug ? `${TNA_BASE}/${slug}/${year}/${num}` : null;
}

export function resolveSi(siYear: number, siNumber: number): string {
  return `${LEGISLATION_BASE}/uksi/${siYear}/${siNumber}`;
}

export function resolveLegislation(title: string, _section?: string | null): string {
  const encoded = title.replace(/ /g, "+");
  return `${LEGISLATION_BASE}/search?title=${encoded}`;
}

// --- OSCOLA display labels and string formatting ---

const COURT_DISPLAY: Record<string, string> = {
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
  UKUT: "UKUT",
  "UKUT (IAC)": "UKUT (IAC)",
  "UKUT (TCC)": "UKUT (TCC)",
  "UKUT (AAC)": "UKUT (AAC)",
  "UKUT (LC)": "UKUT (LC)",
  EAT: "EAT",
  "UKFTT (TC)": "UKFTT (TC)",
  "UKFTT (GRC)": "UKFTT (GRC)",
};

export function buildOscola(
  citationType: CitationType,
  year: number | null | undefined,
  court: string | null | undefined,
  num: number | null | undefined,
  reportSeries: string | null | undefined,
  volume: number | null | undefined,
  page: number | null | undefined,
  legislationTitle: string | null | undefined,
  section: string | null | undefined,
  siYear: number | null | undefined,
  siNumber: number | null | undefined,
  raw: string | null | undefined,
): string {
  if (citationType === "neutral") {
    const key = court || "";
    const display = COURT_DISPLAY[key] ?? key;
    return `[${year}] ${display} ${num}`;
  }
  if (citationType === "law_report") {
    if (volume) return `[${year}] ${volume} ${reportSeries} ${page}`;
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

// --- Core parsing engine ---

interface CitationInit {
  raw: string;
  type: CitationType;
  year?: number | null;
  court?: string | null;
  number?: number | null;
  report_series?: string | null;
  volume?: number | null;
  page?: number | null;
  legislation_title?: string | null;
  section?: string | null;
  si_year?: number | null;
  si_number?: number | null;
  resolved_url?: string | null;
  confidence: number;
}

/** Produce a ParsedCitation with every key present, defaulting anything unset to null. */
function makeCitation(p: CitationInit): ParsedCitation {
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
export function parseCitationFromMatch(m: RegExpMatchArray, ctype: CitationType): ParsedCitation {
  const raw = m[0]!;

  if (ctype === "neutral") {
    const year = parseInt(m[1]!, 10);
    let courtRaw = m[2]!.trim().replace(/\s+/g, " ").toUpperCase();
    const num = parseInt(m[3]!, 10);
    const trailingDivision = m[4];
    let confidence = 1.0;
    if (trailingDivision && AMBIGUOUS_COURTS.has(courtRaw)) {
      courtRaw = `${courtRaw} (${titleCase(trailingDivision)})`;
    }
    if (courtIsAmbiguous(courtRaw)) confidence = 0.5;
    const resolved = resolveNeutralCitation(year, courtRaw, num);
    return makeCitation({ raw, type: ctype, year, court: courtRaw, number: num, resolved_url: resolved, confidence });
  }

  if (ctype === "law_report") {
    const year = parseInt(m[1]!, 10);
    const volume = m[2] ? parseInt(m[2], 10) : null;
    const series = m[3]!.trim().replace(/\s+/g, " ");
    const page = parseInt(m[4]!, 10);
    return makeCitation({ raw, type: ctype, year, report_series: series, volume, page, confidence: 0.9 });
  }

  if (ctype === "legislation") {
    const section = m[1]!;
    const title = m[2]!.trim();
    const yearM = title.match(/\d{4}$/);
    const year = yearM ? parseInt(yearM[0], 10) : null;
    const resolved = resolveLegislation(title, section);
    return makeCitation({ raw, type: ctype, year, legislation_title: title, section, resolved_url: resolved, confidence: 0.95 });
  }

  if (ctype === "si") {
    const siYear = parseInt(m[1]!, 10);
    const siNumber = parseInt(m[2]!, 10);
    return makeCitation({ raw, type: ctype, year: siYear, si_year: siYear, si_number: siNumber, resolved_url: resolveSi(siYear, siNumber), confidence: 1.0 });
  }

  if (ctype === "eu_retained") {
    const year = parseInt(m[1]!, 10);
    const num = parseInt(m[2]!, 10);
    return makeCitation({ raw, type: ctype, year, number: num, confidence: 0.9 });
  }

  return makeCitation({ raw, type: ctype, confidence: 0.5 });
}

/** Apply every compiled pattern to the text, returning a [confident, ambiguous] pair of lists. */
export function extractAllCitations(
  text: string,
  patterns: Record<CitationType, RegExp>,
): [ParsedCitation[], ParsedCitation[]] {
  const seenSpans: Array<[number, number]> = [];
  const confident: ParsedCitation[] = [];
  const ambiguous: ParsedCitation[] = [];

  const priority: CitationType[] = ["neutral", "legislation", "si", "eu_retained", "law_report"];

  for (const ctype of priority) {
    const pattern = patterns[ctype];
    if (!pattern) continue;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0]!.length;
      const overlaps = seenSpans.some(([s, e]) => (s <= start && start < e) || (s < end && end <= e));
      if (overlaps) continue;
      seenSpans.push([start, end]);
      const parsed = parseCitationFromMatch(match, ctype);
      (parsed.confidence >= 0.7 ? confident : ambiguous).push(parsed);
    }
  }

  return [confident, ambiguous];
}
