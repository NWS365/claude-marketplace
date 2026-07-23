/**
 * Tool registrations for the eurlex module.
 *
 * Exposed tool names: eurlex_search, eurlex_get_document.
 * Backing service: the European Union's public CELLAR SPARQL endpoint
 * (publications.europa.eu), which is keyless and returns EU legal instruments
 * keyed by their CELEX identifier.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { jsonResult, toolErrorFromException } from "../../shared/envelope.js";
import { assertOk, jsonOf } from "../../shared/http.js";
import { READ_ONLY_OPEN, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import { sparqlLiteral, parseSearchResults, parseDocument } from "./parsers.js";

const SPARQL_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql";
const SPARQL_RESULTS_FORMAT = "application/sparql-results+json";

// --- Tool description strings shown to the model ---

const SEARCH_DESC = `Searches EU legal instruments by words in their English title, returning each match's CELEX identifier — the EU's canonical document number, e.g. 32016R0679 for the GDPR.

Each hit carries the CELEX id, the title, the document date, and a link to the EUR-Lex page. Feed a CELEX id into eurlex_get_document to resolve its type, or into a general web read to fetch the full text.

This is a primary source: the results come straight from the EU's official CELLAR knowledge base over its public SPARQL endpoint. Treat it as authoritative and do not top up these results with a general web search, which tends to surface stale copies or third-party summaries.

Why this matters for England & Wales: a large body of EU law was carried onto the domestic statute book at the end of the Brexit transition period and now has effect as retained (now "assimilated") EU law. The EUR-Lex text is the original instrument. It is NOT the current in-force UK position: since IP completion day the assimilated version may have been amended, revoked, or restated by UK instruments. Always verify status before relying on it — chain to the UK legislation tools (e.g. legislation_search / legislation_get) to find and read the assimilated GB version and confirm what remains in force.`;

const GET_DOCUMENT_DESC = `Resolves a single EU legal instrument by its CELEX identifier — the EU's canonical document number, e.g. 32016R0679 for the GDPR.

Returns the English title, the document date, the instrument's CELLAR resource type(s), and a link to the EUR-Lex page. A valid CELEX may have no English expression in CELLAR; in that case the title, date, and types come back empty but the EUR-Lex URL is still provided so you can open the document there.

This is a primary source: the record comes straight from the EU's official CELLAR knowledge base over its public SPARQL endpoint. Treat it as authoritative and do not supplement it with a general web search, which tends to surface stale copies or third-party summaries.

Why this matters for England & Wales: much EU law was carried onto the domestic statute book at the end of the Brexit transition period and now has effect as retained (now "assimilated") EU law. The EUR-Lex text is the original instrument, NOT the current in-force UK position — since IP completion day the assimilated version may have been amended, revoked, or restated by UK instruments. Always verify status before relying on it — chain to the UK legislation tools (e.g. legislation_search / legislation_get) to find and read the assimilated GB version and confirm what remains in force.`;

export function registerEurlexTools(server: McpServer, deps: Deps): void {
  // -------------------------------------------------------------------------
  // eurlex_search — CONTAINS() title search over CELLAR, ordered newest first.
  // -------------------------------------------------------------------------
  server.registerTool(
    "eurlex_search",
    {
      title: "Search EU Legislation (EUR-Lex)",
      description: SEARCH_DESC,
      inputSchema: {
        query: z
          .string()
          .min(2)
          .max(200)
          .describe(
            "Words to match within the English title of an EU instrument, e.g. 'data protection', 'market abuse', 'medical devices'. Matched case-insensitively as a substring."
          ),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(50)
          .default(10)
          .describe("Upper bound on how many instruments come back (1–50); forwarded as the SPARQL LIMIT."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search EU Legislation (EUR-Lex)"),
    },
    async (args) => {
      const attempted = `eurlex_search(query='${args.query}')`;
      try {
        const queryLc = sparqlLiteral(args.query.toLowerCase());
        const sparql = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?title ?date WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ?exp cdm:expression_belongs_to_work ?work ;
       cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
       cdm:expression_title ?title .
  OPTIONAL { ?work cdm:work_date_document ?date . }
  FILTER(CONTAINS(LCASE(STR(?title)), "${queryLc}"))
}
ORDER BY DESC(?date)
LIMIT ${args.limit}`;

        const qs = new URLSearchParams();
        qs.append("query", sparql);
        qs.append("format", SPARQL_RESULTS_FORMAT);
        const url = `${SPARQL_ENDPOINT}?${qs.toString()}`;
        const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.DAY }));
        const data = jsonOf(f);
        return jsonResult(parseSearchResults(args.query, data));
      } catch (err) {
        return toolErrorFromException(err, attempted);
      }
    }
  );

  // -------------------------------------------------------------------------
  // eurlex_get_document — resolve one CELEX id to its title, date, and types.
  // -------------------------------------------------------------------------
  server.registerTool(
    "eurlex_get_document",
    {
      title: "Get EU Legislation Document (EUR-Lex)",
      description: GET_DOCUMENT_DESC,
      inputSchema: {
        celex: z
          .string()
          .min(3)
          .max(40)
          .describe(
            "A CELEX identifier — the EU's canonical document number, e.g. '32016R0679' (GDPR) or '32014L0065' (MiFID II)."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Get EU Legislation Document (EUR-Lex)"),
    },
    async (args) => {
      const attempted = `eurlex_get_document(celex='${args.celex}')`;
      try {
        const celexLiteral = sparqlLiteral(args.celex);
        const sparql = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?title ?date ?type WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  FILTER(STR(?celex) = "${celexLiteral}")
  ?exp cdm:expression_belongs_to_work ?work ;
       cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
       cdm:expression_title ?title .
  OPTIONAL { ?work cdm:work_date_document ?date . }
  OPTIONAL { ?work cdm:work_has_resource_type ?type . }
}
LIMIT 20`;

        const qs = new URLSearchParams();
        qs.append("query", sparql);
        qs.append("format", SPARQL_RESULTS_FORMAT);
        const url = `${SPARQL_ENDPOINT}?${qs.toString()}`;
        const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.DAY }));
        const data = jsonOf(f);
        return jsonResult(parseDocument(args.celex, data));
      } catch (err) {
        return toolErrorFromException(err, attempted);
      }
    }
  );
}
