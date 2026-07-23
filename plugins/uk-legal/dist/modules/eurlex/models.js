/**
 * Compile-time-only interfaces for the eurlex module.
 *
 * They document the precise snake_case JSON shape sent on the wire; they carry
 * no runtime validation of their own (input validation lives in the zod
 * schemas). Every record is keyed by a CELEX identifier — the EU's canonical
 * document number (e.g. 32016R0679 for the GDPR).
 */
export {};
