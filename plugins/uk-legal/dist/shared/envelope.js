/** Thrown by the HTTP layer when an upstream returns a non-2xx status. */
export class UpstreamHttpError extends Error {
    status;
    url;
    constructor(status, url, message) {
        super(message ?? `HTTP ${status} for ${url}`);
        this.status = status;
        this.url = url;
        this.name = "UpstreamHttpError";
    }
}
/** legislation.gov.uk WAF challenge / async-render / empty-body condition. */
export class LegislationUpstreamError extends Error {
    constructor(message) {
        super(message);
        this.name = "LegislationUpstreamError";
    }
}
/** Map an exception to (status, detail), including the legislation.gov.uk HTTP 437 case. */
export function classifyError(err) {
    if (err instanceof LegislationUpstreamError) {
        return { status: "upstream_unavailable", detail: err.message };
    }
    if (err instanceof UpstreamHttpError) {
        const s = err.status;
        if (s === 404)
            return { status: "not_found", detail: "the requested record was not found upstream (404) — check the identifier" };
        if (s === 401)
            return { status: "auth_required", detail: "this upstream needs credentials that are not configured here" };
        if (s === 403)
            return { status: "auth_required", detail: `access was refused by the upstream (403) — ${err.url}` };
        if (s === 429)
            return { status: "upstream_unavailable", detail: "hit the upstream rate limit — pause briefly and retry" };
        if (s === 437)
            return { status: "upstream_unavailable", detail: "the upstream WAF rejected the request (437) — pause briefly and retry" };
        if (s >= 400 && s < 500)
            return { status: "upstream_bad_request", detail: `the upstream rejected the request as invalid (${s}) — ${err.url}` };
        if (s >= 500)
            return { status: "upstream_unavailable", detail: `the upstream failed to serve the request (${s}) — retry later` };
    }
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(name) || /timed out|timeout|aborted/i.test(msg)) {
        return { status: "upstream_timeout", detail: "the request did not complete in time — the upstream may be slow; retry" };
    }
    if (/connect/i.test(name) || /ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
        return { status: "upstream_unavailable", detail: "no connection could be made to the upstream — a network or upstream fault" };
    }
    return { status: "error_unclassified", detail: `${name || "Error"}: ${msg}`.slice(0, 200) };
}
// --- Plain envelope objects (for resources / JSON returns) ---
export function errorEnvelope(err, extras = {}) {
    const { status, detail } = classifyError(err);
    return { status, detail, ...extras };
}
export function notFoundEnvelope(detail, extras = {}) {
    return { status: "not_found", detail, ...extras };
}
export function emptyEnvelope(detail = "the query ran but matched no records", extras = {}) {
    return { status: "no_results", data: [], detail, ...extras };
}
export function wrapResponse(data) {
    return { status: "ok", data };
}
// --- CallToolResult builders (tool return path) ---
/** Success: serialise `data` (already snake_case) as pretty JSON text content. */
export function jsonResult(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
/** Error result carrying a structured payload as text (NOT a thrown McpError). */
export function errorResult(payload) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}
/**
 * Convert any upstream exception into a structured tool-error result of the
 * form {error_category, is_retryable, attempted, description}.
 */
export function toolErrorFromException(err, attempted) {
    if (err instanceof LegislationUpstreamError) {
        return errorResult({ error_category: "transient", is_retryable: true, attempted, description: err.message });
    }
    if (err instanceof UpstreamHttpError) {
        const s = err.status;
        // Only 429/503 are treated as transient; only 403 is auth_required;
        // 401 and all other 5xx fall through to unknown.
        if (s === 404)
            return errorResult({ error_category: "not_found", is_retryable: false, attempted, description: `Nothing exists at that identifier (404). Confirm it is correct. URL: ${err.url}` });
        if (s === 403)
            return errorResult({ error_category: "auth_required", is_retryable: false, attempted, description: `The upstream refused access (403). URL: ${err.url}` });
        if (s === 429 || s === 503)
            return errorResult({ error_category: "transient", is_retryable: true, attempted, description: `The upstream returned ${s}; wait a moment and try again. URL: ${err.url}` });
        return errorResult({ error_category: "unknown", is_retryable: false, attempted, description: `The upstream returned ${s}. URL: ${err.url}` });
    }
    const { status, detail } = classifyError(err);
    const retryable = status === "upstream_timeout" || status === "upstream_unavailable";
    return errorResult({ error_category: retryable ? "transient" : "unknown", is_retryable: retryable, attempted, description: detail });
}
/** Build an explicit structured tool error from a known category. */
export function toolError(category, opts) {
    return errorResult({ error_category: category, is_retryable: opts.isRetryable, attempted: opts.attempted, description: opts.description });
}
