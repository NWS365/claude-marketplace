/**
 * Stateless helpers for the eurlex module.
 *
 * Nothing here touches the network: the handlers in tools.ts do the fetching
 * against the CELLAR SPARQL endpoint, and these functions turn the raw
 * `application/sparql-results+json` payloads into the snake_case wire objects
 * defined in models.ts.
 */
import type { EurlexSearchItem, EurlexSearchResult, EurlexDocument } from "./models.js";

/** Base of a EUR-Lex human-readable document page, keyed by CELEX id. */
const EURLEX_CONTENT_BASE = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:";

/** Build the canonical EUR-Lex web URL for a CELEX identifier. */
export function eurlexUrl(celex: string): string {
  return `${EURLEX_CONTENT_BASE}${celex}`;
}

/**
 * Escape a string for embedding inside a SPARQL double-quoted string literal.
 *
 * Backslash and double-quote are the two characters that would otherwise
 * terminate or corrupt the literal, so both are backslash-escaped. Backslashes
 * are handled first to avoid double-escaping the ones this function inserts.
 */
export function sparqlLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** The shape of one SPARQL result binding: each selected var maps to `{ value }`. */
type Binding = Record<string, { value?: string } | undefined>;

/** Read the string `.value` for a bound variable, or null when the var is absent. */
function bindingValue(binding: Binding, key: string): string | null {
  return binding[key]?.value ?? null;
}

/** Pull the `results.bindings` array out of a raw SPARQL JSON payload. */
function bindingsOf(raw: unknown): Binding[] {
  const data = (raw ?? {}) as { results?: { bindings?: unknown } };
  const bindings = data.results?.bindings;
  return Array.isArray(bindings) ? (bindings as Binding[]) : [];
}

/** Convert a CELLAR SPARQL search payload into a EurlexSearchResult. */
export function parseSearchResults(query: string, raw: unknown): EurlexSearchResult {
  const results: EurlexSearchItem[] = bindingsOf(raw).map((b) => {
    const celex = bindingValue(b, "celex");
    return {
      celex,
      title: bindingValue(b, "title"),
      date: bindingValue(b, "date"),
      eurlex_url: eurlexUrl(celex ?? ""),
    };
  });
  return { query, total: results.length, results };
}

/**
 * Convert a CELLAR SPARQL document payload into a EurlexDocument.
 *
 * The title is taken from the first binding, the date from the first binding
 * that carries one, and the types are the distinct non-null `?type` values
 * across all bindings. When there are no bindings — a valid CELEX may lack an
 * English expression — title/date are null and types is empty, but the EUR-Lex
 * URL is still constructed from the supplied CELEX.
 */
export function parseDocument(celex: string, raw: unknown): EurlexDocument {
  const bindings = bindingsOf(raw);
  const first = bindings[0];
  const title = first ? bindingValue(first, "title") : null;

  let date: string | null = null;
  for (const b of bindings) {
    const d = bindingValue(b, "date");
    if (d !== null) {
      date = d;
      break;
    }
  }

  const types: string[] = [];
  for (const b of bindings) {
    const t = bindingValue(b, "type");
    if (t !== null && !types.includes(t)) types.push(t);
  }

  return { celex, title, date, types, eurlex_url: eurlexUrl(celex) };
}
