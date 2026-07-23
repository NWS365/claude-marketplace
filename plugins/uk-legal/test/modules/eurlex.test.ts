import { describe, it, expect, vi } from "vitest";
import { registerEurlex } from "../../src/modules/eurlex/index.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";
import {
  sparqlLiteral,
  eurlexUrl,
  parseSearchResults,
  parseDocument,
} from "../../src/modules/eurlex/parsers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Wrap SPARQL bindings in the application/sparql-results+json envelope.
function sparqlBody(bindings: unknown[]): string {
  return JSON.stringify({ results: { bindings } });
}

// Recover the SPARQL text from a request URL. URLSearchParams encodes spaces as
// '+' (form-encoding), which decodeURIComponent does not undo, so restore them.
function decodedQuery(url: string): string {
  return decodeURIComponent(url.replace(/\+/g, " "));
}

// --------------------------------------------------------------- sparqlLiteral
describe("eurlex/parsers sparqlLiteral", () => {
  it("backslash-escapes double quotes", () => {
    expect(sparqlLiteral('a "quoted" phrase')).toBe('a \\"quoted\\" phrase');
  });

  it("backslash-escapes backslashes (before quotes, so no double-escaping)", () => {
    expect(sparqlLiteral("a\\b")).toBe("a\\\\b");
    expect(sparqlLiteral('a\\"b')).toBe('a\\\\\\"b');
  });

  it("leaves an ordinary string untouched", () => {
    expect(sparqlLiteral("data protection")).toBe("data protection");
  });
});

// -------------------------------------------------------------------- eurlexUrl
describe("eurlex/parsers eurlexUrl", () => {
  it("builds the EUR-Lex content URL from a CELEX id", () => {
    expect(eurlexUrl("32016R0679")).toBe(
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679"
    );
  });
});

// ------------------------------------------------------------ parseSearchResults
describe("eurlex/parsers parseSearchResults", () => {
  it("returns an empty result set for a null body", () => {
    expect(parseSearchResults("gdpr", null)).toEqual({ query: "gdpr", total: 0, results: [] });
  });

  it("shapes each binding and builds the EUR-Lex URL", () => {
    const out = parseSearchResults("gdpr", {
      results: {
        bindings: [
          { celex: { value: "32016R0679" }, title: { value: "GDPR" }, date: { value: "2016-04-27" } },
        ],
      },
    });
    expect(out).toEqual({
      query: "gdpr",
      total: 1,
      results: [
        {
          celex: "32016R0679",
          title: "GDPR",
          date: "2016-04-27",
          eurlex_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
        },
      ],
    });
  });

  it("maps an absent optional var to null (date missing from a binding)", () => {
    const out = parseSearchResults("gdpr", {
      results: { bindings: [{ celex: { value: "32016R0679" }, title: { value: "GDPR" } }] },
    });
    expect(out.results[0]!.date).toBeNull();
    expect(out.results[0]!.celex).toBe("32016R0679");
  });

  it("builds a URL from an empty CELEX when celex is absent", () => {
    const out = parseSearchResults("x", { results: { bindings: [{ title: { value: "Untitled" } }] } });
    expect(out.results[0]!.celex).toBeNull();
    expect(out.results[0]!.eurlex_url).toBe(
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:"
    );
  });

  it("ignores a non-array bindings field", () => {
    expect(parseSearchResults("x", { results: { bindings: 42 } })).toEqual({
      query: "x",
      total: 0,
      results: [],
    });
  });
});

// ----------------------------------------------------------------- parseDocument
describe("eurlex/parsers parseDocument", () => {
  it("takes the title from the first binding, the first non-null date, and distinct types", () => {
    const out = parseDocument("32016R0679", {
      results: {
        bindings: [
          { title: { value: "GDPR" }, type: { value: "REG" } },
          { title: { value: "GDPR" }, date: { value: "2016-04-27" }, type: { value: "REG" } },
          { title: { value: "GDPR" }, date: { value: "2016-05-04" }, type: { value: "LEGACT" } },
        ],
      },
    });
    expect(out).toEqual({
      celex: "32016R0679",
      title: "GDPR",
      date: "2016-04-27",
      types: ["REG", "LEGACT"],
      eurlex_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
    });
  });

  it("returns null fields and empty types (but a URL) when there are no bindings", () => {
    expect(parseDocument("32016R0679", { results: { bindings: [] } })).toEqual({
      celex: "32016R0679",
      title: null,
      date: null,
      types: [],
      eurlex_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
    });
  });

  it("treats a null body the same as empty bindings", () => {
    const out = parseDocument("32016R0679", null);
    expect(out.title).toBeNull();
    expect(out.date).toBeNull();
    expect(out.types).toEqual([]);
  });

  it("leaves types empty when no binding carries a type", () => {
    const out = parseDocument("32016R0679", {
      results: { bindings: [{ title: { value: "GDPR" } }] },
    });
    expect(out.title).toBe("GDPR");
    expect(out.types).toEqual([]);
    expect(out.date).toBeNull();
  });
});

// ---------------------------------------------------------------- eurlex_search
describe("eurlex_search", () => {
  it("queries CELLAR and shapes the results (happy path)", async () => {
    const jsonGet = vi.fn(async () =>
      fetched(
        sparqlBody([
          { celex: { value: "32016R0679" }, title: { value: "GDPR" }, date: { value: "2016-04-27" } },
        ]),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerEurlex, { jsonGet });
    const out = resultJson(await callTool(reg, "eurlex_search", { query: "Data Protection", limit: 10 }));
    expect(out).toMatchObject({ query: "Data Protection", total: 1 });
    expect(out.results[0]).toEqual({
      celex: "32016R0679",
      title: "GDPR",
      date: "2016-04-27",
      eurlex_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
    });

    // The request URL targets the CELLAR SPARQL endpoint with the JSON result format,
    // and the FILTER embeds the lower-cased query.
    const url = (jsonGet.mock.calls[0]! as [string, any])[0] as string;
    expect(url).toContain("publications.europa.eu/webapi/rdf/sparql");
    expect(url).toContain("format=application");
    // The SPARQL is URL-encoded; the lower-cased query appears inside it.
    expect(decodedQuery(url)).toContain('CONTAINS(LCASE(STR(?title)), "data protection")');
    expect(decodedQuery(url)).toContain("LIMIT 10");
  });

  it("escapes a quote in the query before embedding it in the SPARQL", async () => {
    const jsonGet = vi.fn(async () => fetched(sparqlBody([]), { contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    await callTool(reg, "eurlex_search", { query: 'say "hi"', limit: 5 });
    const url = (jsonGet.mock.calls[0]! as [string, any])[0] as string;
    expect(decodedQuery(url)).toContain('"say \\"hi\\""');
  });

  it("returns an empty result set when CELLAR has no matches", async () => {
    const jsonGet = vi.fn(async () => fetched(sparqlBody([]), { contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    const out = resultJson(await callTool(reg, "eurlex_search", { query: "obscure topic", limit: 5 }));
    expect(out).toEqual({ query: "obscure topic", total: 0, results: [] });
  });

  it("surfaces an upstream 500 as a structured unknown error", async () => {
    const jsonGet = vi.fn(async () => fetched("boom", { status: 500, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    const r = await callTool(reg, "eurlex_search", { query: "data", limit: 10 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({
      error_category: "unknown",
      is_retryable: false,
      attempted: "eurlex_search(query='data')",
    });
  });

  it("surfaces an upstream 429 as a retryable transient error", async () => {
    const jsonGet = vi.fn(async () => fetched("slow down", { status: 429, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    const r = await callTool(reg, "eurlex_search", { query: "data", limit: 10 });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});

// ---------------------------------------------------------- eurlex_get_document
describe("eurlex_get_document", () => {
  it("resolves a CELEX id to its title, date, and types (happy path)", async () => {
    const jsonGet = vi.fn(async () =>
      fetched(
        sparqlBody([
          { title: { value: "GDPR" }, date: { value: "2016-04-27" }, type: { value: "REG" } },
        ]),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerEurlex, { jsonGet });
    const out = resultJson(await callTool(reg, "eurlex_get_document", { celex: "32016R0679" }));
    expect(out).toEqual({
      celex: "32016R0679",
      title: "GDPR",
      date: "2016-04-27",
      types: ["REG"],
      eurlex_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
    });

    // The request URL targets the CELLAR SPARQL endpoint and the FILTER embeds the CELEX.
    const url = (jsonGet.mock.calls[0]! as [string, any])[0] as string;
    expect(url).toContain("publications.europa.eu/webapi/rdf/sparql");
    expect(url).toContain("format=application");
    expect(decodedQuery(url)).toContain('FILTER(STR(?celex) = "32016R0679")');
  });

  it("returns the constructed URL and null fields when there are no bindings", async () => {
    const jsonGet = vi.fn(async () => fetched(sparqlBody([]), { contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    const out = resultJson(await callTool(reg, "eurlex_get_document", { celex: "32099X9999" }));
    expect(out).toEqual({
      celex: "32099X9999",
      title: null,
      date: null,
      types: [],
      eurlex_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32099X9999",
    });
  });

  it("surfaces an upstream 500 as a structured unknown error", async () => {
    const jsonGet = vi.fn(async () => fetched("boom", { status: 500, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    const r = await callTool(reg, "eurlex_get_document", { celex: "32016R0679" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({
      error_category: "unknown",
      is_retryable: false,
      attempted: "eurlex_get_document(celex='32016R0679')",
    });
  });

  it("surfaces an upstream 429 as a retryable transient error", async () => {
    const jsonGet = vi.fn(async () => fetched("slow down", { status: 429, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerEurlex, { jsonGet });
    const r = await callTool(reg, "eurlex_get_document", { celex: "32016R0679" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});

// --------------------------------------------------------------- registration
describe("eurlex registration", () => {
  it("registers exactly the two EUR-Lex tools and no resources/prompts", () => {
    const reg = registerModule(registerEurlex);
    expect([...reg.tools.keys()].sort()).toEqual(["eurlex_get_document", "eurlex_search"]);
    expect(reg.resources).toHaveLength(0);
    expect(reg.prompts.size).toBe(0);
  });
});
