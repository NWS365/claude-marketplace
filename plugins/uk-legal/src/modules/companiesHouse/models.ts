/**
 * Compile-time-only interfaces for the companiesHouse module.
 *
 * They document the precise snake_case JSON shape sent on the wire; they carry
 * no runtime validation of their own (input validation lives in the zod
 * schemas). Fields the upstream may omit are typed as nullable.
 */

/** One hit from a Companies House company search. */
export interface CompanySearchItem {
  company_number: string | null;
  title: string | null;
  company_status: string | null;
  company_type: string | null;
  date_of_creation: string | null;
  address_snippet: string | null;
}

/** The full response wrapper for a Companies House company search. */
export interface CompanySearchResult {
  query: string;
  total: number;
  results: CompanySearchItem[];
}

/** A company's registered profile. */
export interface CompanyProfile {
  company_number: string | null;
  company_name: string | null;
  company_status: string | null;
  company_type: string | null;
  date_of_creation: string | null;
  jurisdiction: string | null;
  registered_office_address: string | null;
  sic_codes: string[];
  accounts_next_due: string | null;
  confirmation_statement_next_due: string | null;
}

/** One officer (director, secretary, etc.) appointed to a company. */
export interface CompanyOfficer {
  name: string | null;
  officer_role: string | null;
  appointed_on: string | null;
  resigned_on: string | null;
  nationality: string | null;
  occupation: string | null;
  country_of_residence: string | null;
}

/** The full response wrapper for a company's officers list. */
export interface CompanyOfficersResult {
  company_number: string;
  active_count: number | null;
  resigned_count: number | null;
  officers: CompanyOfficer[];
}

/** One person (or entity) with significant control over a company. */
export interface PscItem {
  name: string | null;
  kind: string | null;
  nationality: string | null;
  notified_on: string | null;
  ceased_on: string | null;
  natures_of_control: string[];
}

/** The full response wrapper for a company's persons-with-significant-control list. */
export interface CompanyPscResult {
  company_number: string;
  active_count: number | null;
  psc: PscItem[];
}
