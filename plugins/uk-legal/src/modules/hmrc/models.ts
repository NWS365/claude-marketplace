/**
 * Compile-time-only interfaces for the hmrc module.
 *
 * They document the precise snake_case JSON shape sent on the wire; they carry
 * no runtime validation of their own (input validation lives in the zod
 * schemas). The union members below enumerate the recognised rate categories.
 */

/** The set of VAT rate categories a VATRate.rate may take. */
export type VatRateCategory = "standard" | "reduced" | "zero" | "exempt" | "outside_scope";

/** VAT treatment of a given commodity or service. */
export interface VATRate {
  commodity_code: string;
  rate: VatRateCategory;
  rate_percentage: number;
  effective_from: string; // ISO date string (YYYY-MM-DD)
  notes: string | null;
}

/** MTD VAT registration status for one VRN. */
export interface MTDStatus {
  vrn: string;
  mandated: boolean;
  effective_date: string | null; // ISO date string (YYYY-MM-DD)
  trading_name: string | null;
}

/** One entry returned from an HMRC guidance search. */
export interface HMRCGuidanceResult {
  title: string;
  url: string;
  summary: string | null;
  updated: string | null; // ISO date string (YYYY-MM-DD)
}

/** The full response wrapper for an HMRC guidance search on GOV.UK. */
export interface HMRCGuidanceSearchResult {
  query: string;
  total: number;
  results: HMRCGuidanceResult[];
}
