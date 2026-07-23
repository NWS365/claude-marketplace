import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "../../src/shared/cache.js";
import { LegislationUpstreamError, UpstreamHttpError } from "../../src/shared/envelope.js";

// --- impit mock (constructed in HttpClients ctor; .fetch drives legislation.gov.uk) ---
const impit = vi.hoisted(() => ({
  responses: [] as any[],
  calls: [] as any[],
}));
vi.mock("impit", () => ({
  Impit: class {
    opts: any;
    constructor(opts: any) {
      this.opts = opts;
    }
    async fetch(url: string, init: any) {
      impit.calls.push({ url, init });
      const r = impit.responses.shift();
      if (!r) throw new Error("no impit response queued");
      return r;
    }
  },
}));

// Imported after the mock is declared.
const { HttpClients, assertOk, jsonOf, USER_AGENT } = await import("../../src/shared/http.js");

/** Build a fetch/impit Response-like object. */
function resp(opts: {
  status?: number;
  ok?: boolean;
  contentType?: string | null;
  text?: string;
  url?: string;
}) {
  const status = opts.status ?? 200;
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  return {
    status,
    ok: opts.ok ?? (status >= 200 && status < 300),
    url: opts.url ?? "https://upstream.test/x",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => opts.text ?? "",
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  impit.responses = [];
  impit.calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const client = () => new HttpClients(new TtlCache());

describe("assertOk / jsonOf / USER_AGENT", () => {
  it("assertOk passes an ok Fetched through", () => {
    const f = { status: 200, ok: true, url: "u", contentType: "", text: "{}" };
    expect(assertOk(f)).toBe(f);
  });
  it("assertOk throws UpstreamHttpError on non-ok", () => {
    const f = { status: 500, ok: false, url: "https://u.test/y", contentType: "", text: "" };
    expect(() => assertOk(f)).toThrow(UpstreamHttpError);
  });
  it("jsonOf parses the text body", () => {
    expect(jsonOf({ status: 200, ok: true, url: "", contentType: "", text: '{"a":1}' })).toEqual({ a: 1 });
  });
  it("exports a descriptive User-Agent", () => {
    expect(USER_AGENT).toContain("uk-legal-ts");
  });
});

describe("native GET (jsonGet / xmlGet)", () => {
  it("returns a Fetched and sends UA + Accept headers", async () => {
    fetchMock.mockResolvedValueOnce(resp({ text: "{}", url: "https://api.test/a" }));
    const f = await client().jsonGet("https://api.test/a");
    expect(f).toMatchObject({ status: 200, ok: true, url: "https://api.test/a", text: "{}" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers["User-Agent"]).toBe(USER_AGENT);
    expect(init.headers.Accept).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("xmlGet sends an XML Accept header and merges caller headers/timeout", async () => {
    fetchMock.mockResolvedValueOnce(resp({ contentType: "application/xml", text: "<x/>" }));
    await client().xmlGet("https://api.test/x", { headers: { "X-Test": "1" }, timeoutMs: 5000 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Accept).toContain("xml");
    expect(init.headers["X-Test"]).toBe("1");
  });

  it("defaults contentType to '' when the response has no content-type header", async () => {
    fetchMock.mockResolvedValueOnce(resp({ contentType: null, text: "x" }));
    const f = await client().jsonGet("https://api.test/a");
    expect(f.contentType).toBe("");
  });

  it("defaults url to '' when the response omits url", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => "{}",
    });
    const f = await client().jsonGet("https://api.test/a");
    expect(f.url).toBe("");
  });
});

describe("native GET caching", () => {
  it("caches an ok response and serves the second call from cache", async () => {
    fetchMock.mockResolvedValueOnce(resp({ text: "one" }));
    const c = client();
    const a = await c.jsonGet("https://api.test/c", { cacheTtl: 10_000 });
    const b = await c.jsonGet("https://api.test/c", { cacheTtl: 10_000 });
    expect(a.text).toBe("one");
    expect(b.text).toBe("one");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(resp({ status: 500, text: "err" }));
    fetchMock.mockResolvedValueOnce(resp({ text: "ok" }));
    const c = client();
    const a = await c.jsonGet("https://api.test/d", { cacheTtl: 10_000 });
    const b = await c.jsonGet("https://api.test/d", { cacheTtl: 10_000 });
    expect(a.ok).toBe(false);
    expect(b.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("HEAD", () => {
  it("issues a HEAD request and returns {status, ok}", async () => {
    fetchMock.mockResolvedValueOnce(resp({ status: 200, text: "" }));
    const r = await client().head("https://api.test/h");
    expect(r).toEqual({ status: 200, ok: true });
    expect(fetchMock.mock.calls[0]![1].method).toBe("HEAD");
  });
});

describe("legislationGet (impit)", () => {
  const URL = "https://www.legislation.gov.uk/ukpga/2006/46/section/47";

  it("returns a Fetched on a clean 200 XML response", async () => {
    impit.responses.push(resp({ contentType: "application/xml", text: "<Legislation/>", url: URL }));
    const f = await client().legislationGet(URL);
    expect(f).toMatchObject({ status: 200, ok: true, text: "<Legislation/>" });
    expect(impit.calls[0]!.init.headers.Accept).toContain("xml");
  });

  it("caches an ok legislation response", async () => {
    impit.responses.push(resp({ contentType: "application/xml", text: "<L/>" }));
    const c = client();
    await c.legislationGet(URL, { cacheTtl: 10_000 });
    await c.legislationGet(URL, { cacheTtl: 10_000 });
    expect(impit.calls).toHaveLength(1);
  });

  it("does not cache a non-ok legislation response", async () => {
    impit.responses.push(resp({ status: 500, contentType: "application/xml", text: "<x/>" }));
    impit.responses.push(resp({ contentType: "application/xml", text: "<ok/>" }));
    const c = client();
    const a = await c.legislationGet(URL, { cacheTtl: 10_000 });
    const b = await c.legislationGet(URL, { cacheTtl: 10_000 });
    expect(a.ok).toBe(false);
    expect(b.text).toBe("<ok/>");
  });

  it("polls on a 202 async-render then returns the rendered body", async () => {
    vi.useFakeTimers();
    impit.responses.push(resp({ status: 202, contentType: "text/html", text: "<html>rendering</html>" }));
    impit.responses.push(resp({ status: 200, contentType: "application/xml", text: "<done/>" }));
    const p = client().legislationGet(URL);
    await vi.runAllTimersAsync();
    const f = await p;
    expect(f.status).toBe(200);
    expect(f.text).toBe("<done/>");
    expect(impit.calls.length).toBe(2);
  });

  it("throws LegislationUpstreamError if still 202 after exhausting polls", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 4; i++) {
      impit.responses.push(resp({ status: 202, contentType: "text/html", text: "<html/>" }));
    }
    const assertion = expect(client().legislationGet(URL)).rejects.toThrow(/still rendering/);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("detects an AWS WAF challenge and throws", async () => {
    impit.responses.push(
      resp({ status: 200, contentType: "text/html", text: "<html>challenge-container</html>" }),
    );
    await expect(client().legislationGet(URL)).rejects.toThrow(LegislationUpstreamError);
  });

  it("treats an empty body as an upstream error", async () => {
    impit.responses.push(resp({ status: 200, contentType: "application/xml", text: "   " }));
    await expect(client().legislationGet(URL)).rejects.toThrow(/empty response/);
  });
});

describe("legislationGetHtml (impit)", () => {
  it("returns HTML on success", async () => {
    impit.responses.push(resp({ status: 200, contentType: "text/html", text: "<html><body>ok</body></html>" }));
    const f = await client().legislationGetHtml("https://www.legislation.gov.uk/x");
    expect(f.text).toContain("ok");
    expect(impit.calls[0]!.init.headers.Accept).toContain("html");
  });

  it("still applies WAF detection on the HTML path", async () => {
    impit.responses.push(resp({ status: 200, contentType: "text/html", text: "AwsWafIntegration blob" }));
    await expect(client().legislationGetHtml("https://www.legislation.gov.uk/x")).rejects.toThrow(
      LegislationUpstreamError,
    );
  });
});
