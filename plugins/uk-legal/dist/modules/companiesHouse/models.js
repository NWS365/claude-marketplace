/**
 * Compile-time-only interfaces for the companiesHouse module.
 *
 * They document the precise snake_case JSON shape sent on the wire; they carry
 * no runtime validation of their own (input validation lives in the zod
 * schemas). Fields the upstream may omit are typed as nullable.
 */
export {};
