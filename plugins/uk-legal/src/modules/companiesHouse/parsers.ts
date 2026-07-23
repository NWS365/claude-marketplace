/**
 * Stateless response-shaping helpers for the companiesHouse module.
 *
 * Nothing here touches the network: the handlers in tools.ts do the fetching,
 * and these functions turn raw Companies House JSON responses into the
 * snake_case wire objects defined in models.ts. Every field is read
 * defensively — arrays may be missing and scalars may be absent.
 */
import type {
  CompanySearchItem,
  CompanySearchResult,
  CompanyProfile,
  CompanyOfficer,
  CompanyOfficersResult,
  PscItem,
  CompanyPscResult,
} from "./models.js";

/** Convert a company-search payload into a CompanySearchResult. */
export function parseCompanySearch(query: string, raw: unknown): CompanySearchResult {
  const data = (raw ?? {}) as { items?: unknown; total_results?: unknown };
  const items: unknown[] = Array.isArray(data.items) ? data.items : [];
  const results: CompanySearchItem[] = [];
  for (const entry of items) {
    const item = (entry ?? {}) as {
      company_number?: string | null;
      title?: string | null;
      company_status?: string | null;
      company_type?: string | null;
      date_of_creation?: string | null;
      address_snippet?: string | null;
    };
    results.push({
      company_number: item.company_number ?? null,
      title: item.title ?? null,
      company_status: item.company_status ?? null,
      company_type: item.company_type ?? null,
      date_of_creation: item.date_of_creation ?? null,
      address_snippet: item.address_snippet ?? null,
    });
  }
  const total = typeof data.total_results === "number" ? data.total_results : results.length;
  return { query, total, results };
}

/** Build a CompanyProfile from a raw company-profile payload. */
export function parseCompanyProfile(raw: unknown): CompanyProfile {
  const data = (raw ?? {}) as {
    company_number?: string | null;
    company_name?: string | null;
    company_status?: string | null;
    type?: string | null;
    date_of_creation?: string | null;
    jurisdiction?: string | null;
    registered_office_address?: unknown;
    sic_codes?: unknown;
    accounts?: { next_accounts?: { due_on?: string | null } | null; next_due?: string | null } | null;
    confirmation_statement?: { next_due?: string | null } | null;
  };

  const address = (data.registered_office_address ?? {}) as {
    address_line_1?: string | null;
    address_line_2?: string | null;
    locality?: string | null;
    region?: string | null;
    postal_code?: string | null;
    country?: string | null;
  };
  const addressParts = [
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  const registered_office_address = addressParts.length > 0 ? addressParts.join(", ") : null;

  const sic_codes: string[] = Array.isArray(data.sic_codes)
    ? data.sic_codes.filter((c): c is string => typeof c === "string")
    : [];

  const accounts_next_due =
    data.accounts?.next_accounts?.due_on ?? data.accounts?.next_due ?? null;
  const confirmation_statement_next_due = data.confirmation_statement?.next_due ?? null;

  return {
    company_number: data.company_number ?? null,
    company_name: data.company_name ?? null,
    company_status: data.company_status ?? null,
    company_type: data.type ?? null,
    date_of_creation: data.date_of_creation ?? null,
    jurisdiction: data.jurisdiction ?? null,
    registered_office_address,
    sic_codes,
    accounts_next_due,
    confirmation_statement_next_due,
  };
}

/** Convert an officers payload into a CompanyOfficersResult. */
export function parseOfficers(companyNumber: string, raw: unknown): CompanyOfficersResult {
  const data = (raw ?? {}) as {
    items?: unknown;
    active_count?: unknown;
    resigned_count?: unknown;
    total_results?: unknown;
  };
  const items: unknown[] = Array.isArray(data.items) ? data.items : [];
  const officers: CompanyOfficer[] = [];
  for (const entry of items) {
    const item = (entry ?? {}) as {
      name?: string | null;
      officer_role?: string | null;
      appointed_on?: string | null;
      resigned_on?: string | null;
      nationality?: string | null;
      occupation?: string | null;
      country_of_residence?: string | null;
    };
    officers.push({
      name: item.name ?? null,
      officer_role: item.officer_role ?? null,
      appointed_on: item.appointed_on ?? null,
      resigned_on: item.resigned_on ?? null,
      nationality: item.nationality ?? null,
      occupation: item.occupation ?? null,
      country_of_residence: item.country_of_residence ?? null,
    });
  }
  return {
    company_number: companyNumber,
    active_count: typeof data.active_count === "number" ? data.active_count : null,
    resigned_count: typeof data.resigned_count === "number" ? data.resigned_count : null,
    officers,
  };
}

/** Convert a persons-with-significant-control payload into a CompanyPscResult. */
export function parsePsc(companyNumber: string, raw: unknown): CompanyPscResult {
  const data = (raw ?? {}) as { items?: unknown; active_count?: unknown };
  const items: unknown[] = Array.isArray(data.items) ? data.items : [];
  const psc: PscItem[] = [];
  for (const entry of items) {
    const item = (entry ?? {}) as {
      name?: string | null;
      kind?: string | null;
      nationality?: string | null;
      notified_on?: string | null;
      ceased_on?: string | null;
      natures_of_control?: unknown;
    };
    psc.push({
      name: item.name ?? null,
      kind: item.kind ?? null,
      nationality: item.nationality ?? null,
      notified_on: item.notified_on ?? null,
      ceased_on: item.ceased_on ?? null,
      natures_of_control: Array.isArray(item.natures_of_control)
        ? item.natures_of_control.filter((n): n is string => typeof n === "string")
        : [],
    });
  }
  return {
    company_number: companyNumber,
    active_count: typeof data.active_count === "number" ? data.active_count : null,
    psc,
  };
}
