/**
 * Side-effect-free parsing helpers for the committees module: house-code
 * normalisation, unwrapping the items/results/data envelope, and shaping the
 * member, oral-evidence, and written-evidence records.
 *
 * String values are trimmed as they come out of the upstream JSON, so the
 * output matches the whitespace-stripped model fields.
 */
import type { CommitteeMember, EvidenceItem } from "./models.js";

export type JsonObj = Record<string, unknown>;

export function isObj(v: unknown): v is JsonObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trim a string; return null for any non-string input (optional field). */
export function optStr(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

/** Read a string field, using the fallback when it is missing or non-string. */
export function reqStr(obj: JsonObj, key: string, fallback: string): string {
  const v = key in obj ? obj[key] : fallback;
  return typeof v === "string" ? v.trim() : fallback;
}

/** Read a numeric field, using the fallback when it is missing or non-numeric. */
export function pickNum(obj: JsonObj, key: string, fallback: number): number {
  const v = key in obj ? obj[key] : fallback;
  return typeof v === "number" ? v : fallback;
}

/**
 * Normalise the house value, which may turn up as a numeric code, a plain
 * string, or an object carrying a `name`. Everything else yields null.
 */
export function parseHouse(houseVal: unknown): string | null {
  if (typeof houseVal === "number") {
    const map: Record<number, string | undefined> = { 1: "Commons", 2: "Lords", 0: "Joint" };
    return map[houseVal] ?? null;
  }
  if (typeof houseVal === "string") return houseVal.trim();
  if (isObj(houseVal)) {
    const name = houseVal["name"];
    return typeof name === "string" ? name.trim() : null;
  }
  return null;
}

/**
 * Pull the payload array out of its envelope: prefer an `items` key, then a
 * `results` key, otherwise the object itself; a bare array passes straight
 * through. Anything that is not ultimately an array becomes an empty array.
 */
export function extractItems(data: unknown): unknown[] {
  if (isObj(data)) {
    const candidate = "items" in data ? data["items"] : "results" in data ? data["results"] : data;
    return Array.isArray(candidate) ? candidate : [];
  }
  return Array.isArray(data) ? data : [];
}

/** Shape a single committee member record. */
export function mapMember(m: JsonObj): CommitteeMember {
  const memberInfo = m["memberInfo"];
  const roles = m["roles"];
  let roleName: string | null = null;
  if (Array.isArray(roles) && roles.length > 0) {
    const first = roles[0];
    const roleObj = isObj(first) ? first["role"] ?? {} : {};
    if (isObj(roleObj)) {
      roleName = optStr(roleObj["name"]);
      if (roleObj["isChair"]) roleName = "Chair";
    }
  }
  const party = isObj(memberInfo) ? optStr(memberInfo["party"]) : null;
  return {
    name: reqStr(m, "name", "Unknown"),
    party,
    role: roleName,
  };
}

/** Take the leading 'YYYY-MM-DD' from an ISO date/datetime string, else null. */
function isoDate(v: unknown): string | null {
  return v ? String(v).slice(0, 10) : null;
}

/** Shape a single oral-evidence item. */
export function mapOral(item: JsonObj, capTitle: (t: string) => string): EvidenceItem {
  const evDate = item["evidenceDate"] || item["date"];
  const witnessesRaw = Array.isArray(item["witnesses"]) ? item["witnesses"] : [];
  const witnesses: string[] = [];
  for (const w of witnessesRaw) {
    if (typeof w === "string") witnesses.push(w);
    else if (isObj(w)) {
      const nm = w["name"];
      witnesses.push(typeof nm === "string" ? nm : String(w));
    }
  }
  const titleRaw =
    "title" in item
      ? item["title"]
      : "sessionTitle" in item
        ? item["sessionTitle"]
        : "Oral evidence session";
  const title = capTitle(typeof titleRaw === "string" ? titleRaw : String(titleRaw ?? "")).trim();
  const sliced = witnesses.slice(0, 10).map((x) => x.trim());
  return {
    id: pickNum(item, "id", 0),
    type: "oral",
    title,
    date: isoDate(evDate),
    witnesses: sliced.length ? sliced : null,
    url: optStr(item["url"]),
  };
}

/** Shape a single written-evidence item. */
export function mapWritten(item: JsonObj, capTitle: (t: string) => string): EvidenceItem {
  const evDate = item["dateReceived"] || item["date"];
  const titleRaw = "title" in item ? item["title"] : "Written evidence";
  const title = capTitle(typeof titleRaw === "string" ? titleRaw : String(titleRaw ?? "")).trim();
  return {
    id: pickNum(item, "id", 0),
    type: "written",
    title,
    date: isoDate(evDate),
    witnesses: null,
    url: optStr(item["url"]),
  };
}
