/**
 * Type-only interfaces for the parliament module.
 *
 * They capture the snake_case JSON shape that goes out on the wire. There are
 * no runtime validators — success payloads are assembled as plain objects and
 * serialised through jsonResult().
 *
 * Dates travel as 'YYYY-MM-DD' strings, never Date objects.
 */
export {};
