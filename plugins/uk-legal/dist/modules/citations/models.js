/**
 * Type-only interfaces for the citations module.
 *
 * These shapes mirror the serialised payloads exactly: snake_case keys, the
 * CitationType enum represented by its string value, and every optional field
 * always present — set to `null` rather than omitted when it has no value.
 * There are no runtime validators here; success payloads are assembled by hand
 * in tools.ts.
 */
export {};
