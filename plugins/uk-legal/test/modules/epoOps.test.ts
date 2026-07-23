import { describe, it, expect, vi, afterEach } from "vitest";
import { registerEpoOps } from "../../src/modules/epoOps/index.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";
import { asArray, txt, parseSearchResults, parseBiblio } from "../../src/modules/epoOps/parsers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// A fake fetch Response for the OPS OAuth token endpoint.
function tokenResp(over: Partial<{ ok: boolean; status: number; body: unknown }> = {}) {
  const { ok = true, status = 200, body = { access_token: "tok-123" } } = over;
  return { ok, status, json: async () => body } as any;
}

// --- Fixtures ---------------------------------------------------------------

// biblio-search with publication-reference as an ARRAY (two hits).
const SEARCH_ARRAY = {
  "ops:world-patent-data": {
    "ops:biblio-search": {
      "@total-result-count": "2",
      "ops:search-result": {
        "ops:publication-reference": [
          {
            "document-id": [
              { "@document-id-type": "docdb", country: { $: "EP" }, "doc-number": { $: "1000000" }, kind: { $: "A1" } },
              { "@document-id-type": "epodoc", "doc-number": { $: "EP1000000" } },
            ],
          },
          {
            "document-id": {
              "@document-id-type": "docdb",
              country: { $: "GB" },
              "doc-number": { $: "2500000" },
              kind: { $: "A" },
            },
          },
        ],
      },
    },
  },
};

// biblio-search with publication-reference as a SINGLE OBJECT (one hit), and a
// document-id with no docdb entry so the first is used.
const SEARCH_SINGLE = {
  "ops:world-patent-data": {
    "ops:biblio-search": {
      "@total-result-count": "1",
      "ops:search-result": {
        "ops:publication-reference": {
          "document-id": { "@document-id-type": "epodoc", country: { $: "GB" }, "doc-number": { $: "2500001" }, kind: { $: "B" } },
        },
      },
    },
  },
};

// biblio with everything as ARRAYS: invention-title incl. @lang:"en",
// applicants/inventors as arrays.
const BIBLIO_ARRAY = {
  "ops:world-patent-data": {
    "exchange-documents": {
      "exchange-document": [
        {
          "bibliographic-data": {
            "invention-title": [
              { "@lang": "de", $: "Ein Ding" },
              { "@lang": "en", $: "A Widget" },
            ],
            "publication-reference": {
              "document-id": [
                { "@document-id-type": "docdb", date: { $: "20200115" } },
                { "@document-id-type": "epodoc", date: { $: "20200116" } },
              ],
            },
            parties: {
              applicants: {
                applicant: [
                  { "applicant-name": { name: { $: "Acme Corp" } } },
                  { "applicant-name": { name: { $: "Acme Corp" } } }, // duplicate → deduped
                  { "applicant-name": { name: { $: "Beta Ltd" } } },
                ],
              },
              inventors: {
                inventor: [
                  { "inventor-name": { name: { $: "Jane Doe" } } },
                  { "inventor-name": { name: { $: "John Roe" } } },
                ],
              },
            },
            "classifications-ipcr": {
              "classification-ipcr": [{ text: { $: "H04L 12/00" } }, { text: { $: "G06F 15/00" } }],
            },
          },
        },
      ],
    },
  },
};

// biblio with everything as SINGLE OBJECTS: no @lang, single applicant/inventor.
const BIBLIO_SINGLE = {
  "ops:world-patent-data": {
    "exchange-documents": {
      "exchange-document": {
        "bibliographic-data": {
          "invention-title": { $: "Lone Title" },
          "publication-reference": {
            "document-id": { "@document-id-type": "epodoc", date: { $: "20211231" } },
          },
          parties: {
            applicants: { applicant: { "applicant-name": { name: { $: "Solo Inc" } } } },
            inventors: { inventor: { "inventor-name": { name: { $: "Sam Smith" } } } },
          },
          "classifications-ipcr": { "classification-ipcr": { text: { $: "A61K 9/00" } } },
        },
      },
    },
  },
};

// --------------------------------------------------------------------- helpers
describe("epoOps/parsers asArray", () => {
  it("returns [] for null/undefined", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
  });

  it("wraps a single object/scalar", () => {
    expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asArray("x")).toEqual(["x"]);
  });

  it("returns an existing array unchanged", () => {
    const arr = [1, 2, 3];
    expect(asArray(arr)).toBe(arr);
  });
});

describe("epoOps/parsers txt", () => {
  it("returns null for null/undefined", () => {
    expect(txt(null)).toBeNull();
    expect(txt(undefined)).toBeNull();
  });

  it("unwraps a { $: value } node", () => {
    expect(txt({ $: "hello" })).toBe("hello");
  });

  it("returns a bare string as-is", () => {
    expect(txt("plain")).toBe("plain");
  });

  it("returns null for an object without a $ key or a non-object/non-string", () => {
    expect(txt({ nope: 1 })).toBeNull();
    expect(txt(42 as any)).toBeNull();
  });
});

// --------------------------------------------------------- parseSearchResults
describe("epoOps/parsers parseSearchResults", () => {
  it("shapes an array of publication-references, picking the docdb document-id", () => {
    const out = parseSearchResults("graphene", SEARCH_ARRAY, 10);
    expect(out).toEqual({
      query: "graphene",
      total: 2,
      results: [
        { country: "EP", doc_number: "1000000", kind: "A1", publication_number: "EP1000000A1" },
        { country: "GB", doc_number: "2500000", kind: "A", publication_number: "GB2500000A" },
      ],
    });
  });

  it("handles a single publication-reference object and falls back to the first document-id", () => {
    const out = parseSearchResults("widget", SEARCH_SINGLE, 10);
    expect(out.total).toBe(1);
    expect(out.results).toEqual([
      { country: "GB", doc_number: "2500001", kind: "B", publication_number: "GB2500001B" },
    ]);
  });

  it("slices results to the limit", () => {
    const out = parseSearchResults("graphene", SEARCH_ARRAY, 1);
    expect(out.total).toBe(2);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.publication_number).toBe("EP1000000A1");
  });

  it("returns total 0 and empty results for a missing/empty body", () => {
    expect(parseSearchResults("x", null, 10)).toEqual({ query: "x", total: 0, results: [] });
    expect(parseSearchResults("x", {}, 10)).toEqual({ query: "x", total: 0, results: [] });
  });

  it("skips null parts when assembling the publication number", () => {
    const raw = {
      "ops:world-patent-data": {
        "ops:biblio-search": {
          "@total-result-count": "1",
          "ops:search-result": {
            "ops:publication-reference": { "document-id": { country: { $: "GB" }, "doc-number": { $: "999" } } },
          },
        },
      },
    };
    const out = parseSearchResults("x", raw, 10);
    expect(out.results[0]).toEqual({ country: "GB", doc_number: "999", kind: null, publication_number: "GB999" });
  });
});

// ----------------------------------------------------------------- parseBiblio
describe("epoOps/parsers parseBiblio", () => {
  it("prefers the English title and shapes arrays (with dedupe)", () => {
    const out = parseBiblio("EP1000000", BIBLIO_ARRAY);
    expect(out).toEqual({
      publication_number: "EP1000000",
      title: "A Widget",
      applicants: ["Acme Corp", "Beta Ltd"],
      inventors: ["Jane Doe", "John Roe"],
      ipc_classes: ["H04L 12/00", "G06F 15/00"],
      publication_date: "20200115",
    });
  });

  it("handles single-object shapes for title, parties, ipc and date", () => {
    const out = parseBiblio("GB2500000", BIBLIO_SINGLE);
    expect(out).toEqual({
      publication_number: "GB2500000",
      title: "Lone Title",
      applicants: ["Solo Inc"],
      inventors: ["Sam Smith"],
      ipc_classes: ["A61K 9/00"],
      publication_date: "20211231",
    });
  });

  it("returns nulls/[] for an entirely missing body", () => {
    expect(parseBiblio("EP1", null)).toEqual({
      publication_number: "EP1",
      title: null,
      applicants: [],
      inventors: [],
      ipc_classes: [],
      publication_date: null,
    });
    expect(parseBiblio("EP1", {})).toEqual({
      publication_number: "EP1",
      title: null,
      applicants: [],
      inventors: [],
      ipc_classes: [],
      publication_date: null,
    });
  });
});

// -------------------------------------------------------- epo_ops_search_patents
describe("epo_ops_search_patents", () => {
  it("returns a configuration error when OPS credentials are unset", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "");
    const reg = registerModule(registerEpoOps);
    const r = await callTool(reg, "epo_ops_search_patents", { query: "graphene" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({
      error_category: "configuration",
      is_retryable: false,
      attempted: "epo_ops_search_patents(query='graphene')",
    });
    expect(resultJson(r).description).toMatch(/EPO_OPS_CONSUMER_KEY/);
  });

  it("mints a token then searches (default base, plain text wrapped as CQL)", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubEnv("EPO_OPS_API_BASE", "");
    const fetchMock = vi.fn(async () => tokenResp());
    vi.stubGlobal("fetch", fetchMock);

    const jsonGet = vi.fn(async () => fetched(JSON.stringify(SEARCH_ARRAY), { contentType: "application/json" }));
    const reg = registerModule(registerEpoOps, { jsonGet });

    const out = resultJson(await callTool(reg, "epo_ops_search_patents", { query: "graphene battery", limit: 10 }));
    expect(out.total).toBe(2);
    expect(out.results[0].publication_number).toBe("EP1000000A1");

    // Token POST hit the default base + Basic auth header.
    const [tokenUrl, tokenOpts] = fetchMock.mock.calls[0]! as [string, any];
    expect(tokenUrl).toBe("https://ops.epo.org/3.2/auth/accesstoken");
    expect(tokenOpts.headers.Authorization).toBe("Basic " + Buffer.from("ck:cs").toString("base64"));

    // Data GET carried the bearer token and the CQL-wrapped query.
    const [dataUrl, dataOpts] = jsonGet.mock.calls[0]! as [string, any];
    expect(dataUrl).toBe(
      `https://ops.epo.org/3.2/rest-services/published-data/search?q=${encodeURIComponent('txt="graphene battery"')}`
    );
    expect(dataOpts.headers.Authorization).toBe("Bearer tok-123");
  });

  it("passes a CQL query (containing '=') through unwrapped", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp()));
    const jsonGet = vi.fn(async () => fetched(JSON.stringify(SEARCH_SINGLE), { contentType: "application/json" }));
    const reg = registerModule(registerEpoOps, { jsonGet });

    await callTool(reg, "epo_ops_search_patents", { query: 'pa="acme"', limit: 5 });
    const dataUrl = (jsonGet.mock.calls[0]! as [string, any])[0] as string;
    expect(dataUrl).toBe(
      `https://ops.epo.org/3.2/rest-services/published-data/search?q=${encodeURIComponent('pa="acme"')}`
    );
  });

  it("surfaces a token-endpoint 500 as an unknown error and never calls jsonGet", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp({ ok: false, status: 500 })));
    const jsonGet = vi.fn();
    const reg = registerModule(registerEpoOps, { jsonGet });
    const r = await callTool(reg, "epo_ops_search_patents", { query: "graphene" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false });
    expect(jsonGet).not.toHaveBeenCalled();
  });

  it("classifies a 429 token failure as a retryable transient error", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp({ ok: false, status: 429 })));
    const reg = registerModule(registerEpoOps, { jsonGet: vi.fn() });
    const r = await callTool(reg, "epo_ops_search_patents", { query: "graphene" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});

// ------------------------------------------------------------ epo_ops_get_patent
describe("epo_ops_get_patent", () => {
  it("returns a configuration error when OPS credentials are unset", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "");
    const reg = registerModule(registerEpoOps);
    const r = await callTool(reg, "epo_ops_get_patent", { publication_number: "EP1000000" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({
      error_category: "configuration",
      is_retryable: false,
      attempted: "epo_ops_get_patent(publication_number='EP1000000')",
    });
  });

  it("mints a token then fetches biblio (default base, bearer + data URL)", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubEnv("EPO_OPS_API_BASE", "");
    const fetchMock = vi.fn(async () => tokenResp());
    vi.stubGlobal("fetch", fetchMock);
    const jsonGet = vi.fn(async () => fetched(JSON.stringify(BIBLIO_ARRAY), { contentType: "application/json" }));
    const reg = registerModule(registerEpoOps, { jsonGet });

    const out = resultJson(await callTool(reg, "epo_ops_get_patent", { publication_number: "EP1000000" }));
    expect(out).toMatchObject({ publication_number: "EP1000000", title: "A Widget", publication_date: "20200115" });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://ops.epo.org/3.2/auth/accesstoken");
    const [dataUrl, dataOpts] = jsonGet.mock.calls[0]! as [string, any];
    expect(dataUrl).toBe(
      "https://ops.epo.org/3.2/rest-services/published-data/publication/epodoc/EP1000000/biblio"
    );
    expect(dataOpts.headers.Authorization).toBe("Bearer tok-123");
  });

  it("uses the EPO_OPS_API_BASE override", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubEnv("EPO_OPS_API_BASE", "https://ops.example/3.2");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp()));
    const jsonGet = vi.fn(async () => fetched(JSON.stringify(BIBLIO_SINGLE), { contentType: "application/json" }));
    const reg = registerModule(registerEpoOps, { jsonGet });

    await callTool(reg, "epo_ops_get_patent", { publication_number: "GB2500000" });
    expect(jsonGet.mock.calls[0]![0]).toBe(
      "https://ops.example/3.2/rest-services/published-data/publication/epodoc/GB2500000/biblio"
    );
  });

  it("surfaces a biblio 404 as not_found", async () => {
    vi.stubEnv("EPO_OPS_CONSUMER_KEY", "ck");
    vi.stubEnv("EPO_OPS_CONSUMER_SECRET", "cs");
    vi.stubGlobal("fetch", vi.fn(async () => tokenResp()));
    const jsonGet = vi.fn(async () => fetched("not found", { status: 404, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerEpoOps, { jsonGet });
    const r = await callTool(reg, "epo_ops_get_patent", { publication_number: "EP0000000" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "not_found", is_retryable: false });
  });
});

// --------------------------------------------------------------- registration
describe("epoOps registration", () => {
  it("registers exactly the two EPO OPS tools and no resources/prompts", () => {
    const reg = registerModule(registerEpoOps);
    expect([...reg.tools.keys()].sort()).toEqual(["epo_ops_get_patent", "epo_ops_search_patents"]);
    expect(reg.resources).toHaveLength(0);
    expect(reg.prompts.size).toBe(0);
  });
});
