import { describe, it, expect } from "vitest";
import {
  UpstreamHttpError,
  LegislationUpstreamError,
  classifyError,
  errorEnvelope,
  notFoundEnvelope,
  emptyEnvelope,
  wrapResponse,
  jsonResult,
  errorResult,
  toolErrorFromException,
  toolError,
} from "../../src/shared/envelope.js";

const httpErr = (status: number, url = "https://u.test/x") => new UpstreamHttpError(status, url);

describe("classifyError", () => {
  it("maps LegislationUpstreamError to upstream_unavailable", () => {
    expect(classifyError(new LegislationUpstreamError("waf"))).toEqual({
      status: "upstream_unavailable",
      detail: "waf",
    });
  });

  it("maps HTTP statuses to the source taxonomy", () => {
    expect(classifyError(httpErr(404)).status).toBe("not_found");
    expect(classifyError(httpErr(401)).status).toBe("auth_required");
    expect(classifyError(httpErr(403)).status).toBe("auth_required");
    expect(classifyError(httpErr(429)).status).toBe("upstream_unavailable");
    expect(classifyError(httpErr(437)).status).toBe("upstream_unavailable");
    expect(classifyError(httpErr(422)).status).toBe("upstream_bad_request");
    expect(classifyError(httpErr(500)).status).toBe("upstream_unavailable");
  });

  it("classifies timeout errors by name and message", () => {
    const byName = Object.assign(new Error("x"), { name: "TimeoutError" });
    expect(classifyError(byName).status).toBe("upstream_timeout");
    expect(classifyError(new Error("the request timed out")).status).toBe("upstream_timeout");
    expect(classifyError(new Error("operation aborted")).status).toBe("upstream_timeout");
  });

  it("classifies connection errors by name and message", () => {
    const byName = Object.assign(new Error("x"), { name: "ConnectError" });
    expect(classifyError(byName).status).toBe("upstream_unavailable");
    expect(classifyError(new Error("ECONNREFUSED 127.0.0.1")).status).toBe("upstream_unavailable");
    expect(classifyError(new Error("ENOTFOUND host")).status).toBe("upstream_unavailable");
  });

  it("falls back to error_unclassified and truncates the detail to 200 chars", () => {
    const long = "z".repeat(500);
    const { status, detail } = classifyError(new Error(long));
    expect(status).toBe("error_unclassified");
    expect(detail.length).toBe(200);
  });

  it("handles a non-Error thrown value", () => {
    const { status, detail } = classifyError("plain string");
    expect(status).toBe("error_unclassified");
    expect(detail).toContain("plain string");
  });
});

describe("plain envelopes", () => {
  it("errorEnvelope embeds the classification and extras", () => {
    expect(errorEnvelope(httpErr(404), { url: "u" })).toMatchObject({
      status: "not_found",
      url: "u",
    });
  });
  it("notFoundEnvelope / emptyEnvelope / wrapResponse shapes", () => {
    expect(notFoundEnvelope("gone", { id: 1 })).toEqual({ status: "not_found", detail: "gone", id: 1 });
    expect(emptyEnvelope()).toEqual({ status: "no_results", data: [], detail: "the query ran but matched no records" });
    expect(emptyEnvelope("custom", { q: "x" })).toEqual({
      status: "no_results",
      data: [],
      detail: "custom",
      q: "x",
    });
    expect(wrapResponse([1, 2])).toEqual({ status: "ok", data: [1, 2] });
  });
});

describe("CallToolResult builders", () => {
  it("jsonResult pretty-prints structured data as text content", () => {
    const r = jsonResult({ a: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((r.content[0] as any).text)).toEqual({ a: 1 });
  });

  it("errorResult carries the payload as text with isError", () => {
    const r = errorResult({ error_category: "unknown", is_retryable: false });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as any).text)).toMatchObject({ error_category: "unknown" });
  });
});

describe("toolErrorFromException", () => {
  const parse = (r: ReturnType<typeof toolErrorFromException>) => JSON.parse((r.content[0] as any).text);

  it("maps a legislation WAF error to a retryable transient", () => {
    const r = toolErrorFromException(new LegislationUpstreamError("waf challenge"), "attempt");
    expect(parse(r)).toMatchObject({ error_category: "transient", is_retryable: true, description: "waf challenge" });
  });

  it("maps 404 to not_found (non-retryable)", () => {
    expect(parse(toolErrorFromException(httpErr(404), "a"))).toMatchObject({
      error_category: "not_found",
      is_retryable: false,
    });
  });

  it("maps 403 to auth_required (non-retryable)", () => {
    expect(parse(toolErrorFromException(httpErr(403), "a"))).toMatchObject({
      error_category: "auth_required",
      is_retryable: false,
    });
  });

  it("maps 429 and 503 to retryable transient", () => {
    expect(parse(toolErrorFromException(httpErr(429), "a"))).toMatchObject({ error_category: "transient", is_retryable: true });
    expect(parse(toolErrorFromException(httpErr(503), "a"))).toMatchObject({ error_category: "transient", is_retryable: true });
  });

  it("maps other HTTP statuses (401, 500) to non-retryable unknown", () => {
    expect(parse(toolErrorFromException(httpErr(401), "a"))).toMatchObject({ error_category: "unknown", is_retryable: false });
    expect(parse(toolErrorFromException(httpErr(500), "a"))).toMatchObject({ error_category: "unknown", is_retryable: false });
  });

  it("maps a generic timeout to retryable transient and other errors to unknown", () => {
    expect(parse(toolErrorFromException(new Error("timed out"), "a"))).toMatchObject({
      error_category: "transient",
      is_retryable: true,
    });
    expect(parse(toolErrorFromException(new Error("boom"), "a"))).toMatchObject({
      error_category: "unknown",
      is_retryable: false,
    });
  });
});

describe("toolError", () => {
  it("builds an explicit structured error", () => {
    const r = toolError("configuration", { isRetryable: false, attempted: "cfg", description: "missing key" });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as any).text)).toEqual({
      error_category: "configuration",
      is_retryable: false,
      attempted: "cfg",
      description: "missing key",
    });
  });
});

describe("error classes", () => {
  it("UpstreamHttpError carries status/url and a default message", () => {
    const e = new UpstreamHttpError(500, "https://u.test/y");
    expect(e.status).toBe(500);
    expect(e.url).toBe("https://u.test/y");
    expect(e.message).toContain("500");
    expect(new UpstreamHttpError(500, "u", "custom").message).toBe("custom");
  });
});
