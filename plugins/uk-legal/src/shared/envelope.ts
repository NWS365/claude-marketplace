/**
 * Response envelope + error taxonomy for tool and resource results.
 *
 * Two distinct error surfaces are modelled:
 *  - tool results: return `{ isError:true, content:[text JSON] }` (NOT thrown),
 *    so the structured error payload travels as an ordinary tool result.
 *  - resource returns / domain "no match": plain envelope objects with `status`.
 *
 * Tool results are `content:[{type:'text', text: JSON.stringify(payload)}]` with
 * snake_case keys + exact enum literals. We deliberately do not advertise an
 * outputSchema/structuredContent (max cross-client compatibility); data parity
 * is preserved in the JSON body.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type EnvelopeStatus =
  | "ok"
  | "empty"
  | "not_found"
  | "auth_required"
  | "upstream_validation"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "unknown_error";

export type ErrorCategory = "transient" | "not_found" | "auth_required" | "configuration" | "unknown";

/** Thrown by the HTTP layer when an upstream returns a non-2xx status. */
export class UpstreamHttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "UpstreamHttpError";
  }
}

/** legislation.gov.uk WAF challenge / async-render / empty-body condition. */
export class LegislationUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegislationUpstreamError";
  }
}

/** Map an exception to (status, detail), including the legislation.gov.uk HTTP 437 case. */
export function classifyError(err: unknown): { status: EnvelopeStatus; detail: string } {
  if (err instanceof LegislationUpstreamError) {
    return { status: "upstream_unavailable", detail: err.message };
  }
  if (err instanceof UpstreamHttpError) {
    const s = err.status;
    if (s === 404) return { status: "not_found", detail: "upstream returned 404 — the URI or identifier is wrong" };
    if (s === 401) return { status: "auth_required", detail: "upstream requires credentials not configured on this server" };
    if (s === 403) return { status: "auth_required", detail: `upstream denied access — ${err.url}` };
    if (s === 429) return { status: "upstream_unavailable", detail: "upstream rate-limit hit — retry shortly" };
    if (s === 437) return { status: "upstream_unavailable", detail: "upstream WAF blocked the request (437) — retry shortly" };
    if (s >= 400 && s < 500) return { status: "upstream_validation", detail: `upstream rejected request (${s}) — ${err.url}` };
    if (s >= 500) return { status: "upstream_unavailable", detail: `upstream returned ${s} — try again later` };
  }
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(name) || /timed out|timeout|aborted/i.test(msg)) {
    return { status: "upstream_timeout", detail: "request timed out — upstream may be slow, retry" };
  }
  if (/connect/i.test(name) || /ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
    return { status: "upstream_unavailable", detail: "could not connect to upstream — network or upstream issue" };
  }
  return { status: "unknown_error", detail: `${name || "Error"}: ${msg}`.slice(0, 200) };
}

// --- Plain envelope objects (for resources / JSON returns) ---

export function errorEnvelope(err: unknown, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const { status, detail } = classifyError(err);
  return { status, detail, ...extras };
}
export function notFoundEnvelope(detail: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "not_found", detail, ...extras };
}
export function emptyEnvelope(detail = "no results matched the query", extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "empty", data: [], detail, ...extras };
}
export function wrapResponse(data: unknown): Record<string, unknown> {
  return { status: "ok", data };
}

// --- CallToolResult builders (tool return path) ---

/** Success: serialise `data` (already snake_case) as pretty JSON text content. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Error result carrying a structured payload as text (NOT a thrown McpError). */
export function errorResult(payload: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/**
 * Convert any upstream exception into a structured tool-error result of the
 * form {error_category, is_retryable, attempted, description}.
 */
export function toolErrorFromException(err: unknown, attempted: string): CallToolResult {
  if (err instanceof LegislationUpstreamError) {
    return errorResult({ error_category: "transient", is_retryable: true, attempted, description: err.message });
  }
  if (err instanceof UpstreamHttpError) {
    const s = err.status;
    // Only 429/503 are treated as transient; only 403 is auth_required;
    // 401 and all other 5xx fall through to unknown.
    if (s === 404)
      return errorResult({ error_category: "not_found", is_retryable: false, attempted, description: `Resource not found (404). Check the identifier is correct. URL: ${err.url}` });
    if (s === 403)
      return errorResult({ error_category: "auth_required", is_retryable: false, attempted, description: `Access denied (403). URL: ${err.url}` });
    if (s === 429 || s === 503)
      return errorResult({ error_category: "transient", is_retryable: true, attempted, description: `Upstream returned ${s} — retry after a short delay. URL: ${err.url}` });
    return errorResult({ error_category: "unknown", is_retryable: false, attempted, description: `Upstream returned ${s}. URL: ${err.url}` });
  }
  const { status, detail } = classifyError(err);
  const retryable = status === "upstream_timeout" || status === "upstream_unavailable";
  return errorResult({ error_category: retryable ? "transient" : "unknown", is_retryable: retryable, attempted, description: detail });
}

/** Build an explicit structured tool error from a known category. */
export function toolError(category: ErrorCategory, opts: { isRetryable: boolean; attempted: string; description: string }): CallToolResult {
  return errorResult({ error_category: category, is_retryable: opts.isRetryable, attempted: opts.attempted, description: opts.description });
}
